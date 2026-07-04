import { useState, useRef, useEffect } from 'react';
import type { CustomNpc } from '../storage/db';
import type { WorldBookEntry } from '../worldbook/index';
import type { WorldDef } from '../data/worldLoader';
import type { ApiConfig } from '../api/types';
import { requestStreamWithRetry } from '../api/client';
import { buildNpcFillPrompt } from '../utils/prompts';
import { buildSpecialConfig } from '../modules/normalizeModule';

interface UseNpcFillOptions {
  apiConfig: ApiConfig | null;
  npc: CustomNpc;
  playerName: string;
  playerGender: string;
  playerAge: string;
  playerBackground: string;
  selectedWorld: string;
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  setNpc: React.Dispatch<React.SetStateAction<CustomNpc>>;
}

export function useNpcFill({
  apiConfig, npc, playerName, playerGender, playerAge, playerBackground,
  selectedWorld, allWorlds, worldEntry, setNpc,
}: UseNpcFillOptions) {
  const [isFilling, setIsFilling] = useState(false);
  const [fillElapsed, setFillElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAiFill = async () => {
    if (!apiConfig) return;
    if (!npc.name.trim()) return;

    setIsFilling(true);
    setFillElapsed(0);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const startTime = Date.now();
    timerRef.current = setInterval(() => setFillElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);

    const worldData = allWorlds.find(w => w.id === selectedWorld);
    const worldSetting = worldEntry?.content || worldData?.description || '自由穿越模式';

    // 提取属性模块配置
    const statMod = worldData?.modules?.find(m => m.moduleId === 'stat' && m.enabled);
    const hasProgression = !!worldData?.modules?.some(m => m.moduleId === 'progression' && m.enabled);
    const statRaw = statMod?.moduleConfig as any;
    const statModule = statRaw ? {
      attrA: { name: statRaw.attrA?.name || '生命', max: statRaw.attrA?.max || 100 },
      attrB: { name: statRaw.attrB?.name || '能量', max: statRaw.attrB?.max || 100 },
      dim1: { name: statRaw.dim1?.name || '属性1', range: statRaw.dim1?.range || [0, 100] },
      dim2: { name: statRaw.dim2?.name || '属性2', range: statRaw.dim2?.range || [0, 100] },
      dim3: { name: statRaw.dim3?.name || '属性3', range: statRaw.dim3?.range || [0, 100] },
      dim4: { name: statRaw.dim4?.name || '属性4', range: statRaw.dim4?.range || [0, 100] },
      dim5: { name: statRaw.dim5?.name || '属性5', range: statRaw.dim5?.range || [0, 100] },
      dim6: { name: statRaw.dim6?.name || '属性6', range: statRaw.dim6?.range || [0, 100] },
      special: buildSpecialConfig(statRaw.special),
    } : undefined;

    const systemPrompt = buildNpcFillPrompt({
      worldSetting,
      playerName,
      playerGender,
      playerAge,
      playerBackground,
      npc,
      statModule,
      hasProgression,
    });

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: '请根据已知信息补全NPC的详细设定。' },
    ];

    try {
      // 45秒硬超时
      const hardTimeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 45_000);

      const result = await requestStreamWithRetry(apiConfig, messages, {
        signal: controller.signal,
        onDelta: () => {},
        maxTokens: 3000,
      });

      clearTimeout(hardTimeout);

      const text = result.text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI 返回格式异常');

      const data = JSON.parse(jsonMatch[0]);

      // 更新NPC信息
      setNpc(prev => ({
        ...prev,
        gender: data.gender || prev.gender,
        age: data.age || prev.age,
        race: data.race || prev.race,
        relationshipType: data.relationship || prev.relationshipType,
        occupation: data.occupation || prev.occupation,
        socialStatus: data.socialStatus || prev.socialStatus,
        personality: data.personality || prev.personality,
        hiddenPersonality: data.hiddenPersonality || prev.hiddenPersonality,
        currentThought: data.currentThought || prev.currentThought,
        appearance: data.appearance || prev.appearance,
        currentOutfit: data.currentOutfit || prev.currentOutfit,
        currentAction: data.currentAction || prev.currentAction,
        currentLocation: data.currentLocation || prev.currentLocation,
        currentState: data.currentState || prev.currentState,
        shortTermGoal: data.shortTermGoal || prev.shortTermGoal,
        longTermGoal: data.longTermGoal || prev.longTermGoal,
        background: data.background || prev.background,
        skillsList: data.skillsList && typeof data.skillsList === 'object' ? data.skillsList : prev.skillsList,
        itemsList: data.itemsList && typeof data.itemsList === 'object' ? data.itemsList : prev.itemsList,
      }));

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (timedOut) {
          console.warn('[NPC补全] 超时');
        }
        return;
      }
      console.error('[NPC补全] 失败:', err);
    } finally {
      setIsFilling(false);
      abortRef.current = null;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  const cancelFill = () => { abortRef.current?.abort(); };

  // 卸载时清理：取消进行中的请求和定时器
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, []);

  return { isFilling, fillElapsed, handleAiFill, cancelFill };
}
