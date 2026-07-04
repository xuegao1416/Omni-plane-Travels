import { useState, useRef, useEffect } from 'react';
import type { CustomNpc } from '../storage/db';
import type { WorldBookEntry } from '../worldbook/index';
import type { WorldDef } from '../data/worldLoader';
import type { ApiConfig } from '../api/types';
import { requestStreamWithRetry } from '../api/client';
import { v4 as uuid } from 'uuid';
import { buildNpcCreatePrompt } from '../utils/prompts';
import { buildSpecialConfig } from '../modules/normalizeModule';

interface UseNpcCreateOptions {
  apiConfig: ApiConfig | null;
  playerName: string;
  playerGender: string;
  playerAge: string;
  playerBackground: string;
  selectedWorld: string;
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  showAlert: (msg: string, opts?: any) => Promise<void>;
}

export function useNpcCreate({
  apiConfig, playerName, playerGender, playerAge, playerBackground,
  selectedWorld, allWorlds, worldEntry, showAlert,
}: UseNpcCreateOptions) {
  const [isCreating, setIsCreating] = useState(false);
  const [createElapsed, setCreateElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createNpc = async (): Promise<CustomNpc | null> => {
    if (!apiConfig) {
      await showAlert('请先配置API');
      return null;
    }
    if (!playerName.trim()) {
      await showAlert('请先填写角色姓名');
      return null;
    }

    setIsCreating(true);
    setCreateElapsed(0);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const startTime = Date.now();
    timerRef.current = setInterval(() => setCreateElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);

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

    const systemPrompt = buildNpcCreatePrompt({
      worldSetting,
      playerName,
      playerGender,
      playerAge,
      playerBackground,
      statModule,
      hasProgression,
    });

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: '请生成一个与玩家角色有关联的NPC。' },
    ];

    try {
      // 45秒硬超时（NPC生成比玩家补全简单一些）
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

      const n = JSON.parse(jsonMatch[0]);

      // 构建 NPC 对象
      const npc: CustomNpc = {
        id: uuid(),
        name: n.name || '未命名',
        gender: n.gender || '',
        age: n.age || '',
        race: n.race || '',
        relationshipType: n.relationship || '',
        occupation: n.occupation || '',
        socialStatus: n.socialStatus || '',
        personality: n.personality || '',
        hiddenPersonality: n.hiddenPersonality || '',
        currentThought: n.currentThought || '',
        appearance: n.appearance || '',
        currentOutfit: n.currentOutfit || '',
        currentAction: n.currentAction || '',
        currentLocation: n.currentLocation || '',
        currentState: n.currentState || '',
        shortTermGoal: n.shortTermGoal || '',
        longTermGoal: n.longTermGoal || '',
        background: n.background || '',
        chronicles: [],
        skillsList: n.skillsList && typeof n.skillsList === 'object' ? n.skillsList : {},
        itemsList: n.itemsList && typeof n.itemsList === 'object' ? n.itemsList : {},
      };

      // NPC 属性（写入 survivalStats，与玩家生存状态结构一致）
      if (n.survivalStats && typeof n.survivalStats === 'object' && statModule) {
        npc.survivalStats = {};
        if (n.survivalStats.血量 != null) npc.survivalStats['血量'] = Number(n.survivalStats.血量);
        if (n.survivalStats.体力值 != null) npc.survivalStats['体力值'] = Number(n.survivalStats.体力值);
        for (let i = 1; i <= 6; i++) {
          const key = `dim${i}`;
          if (n.survivalStats[key] != null) npc.survivalStats[key] = Number(n.survivalStats[key]);
        }
      }

      // NPC 段位
      if (n.tierIndex != null && hasProgression) {
        npc.tierIndex = Number(n.tierIndex);
      }

      return npc;

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (timedOut) {
          await showAlert('NPC 创建超时（45秒），请检查网络或 API 配置后重试', { title: '超时' });
        }
        return null;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[NPC创建] 失败:', err);
      await showAlert(`NPC创建失败: ${errMsg}`, { title: '创建失败' });
      return null;
    } finally {
      setIsCreating(false);
      abortRef.current = null;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  const cancelCreate = () => { abortRef.current?.abort(); };

  // 卸载时清理：取消进行中的请求和定时器
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, []);

  return { isCreating, createElapsed, createNpc, cancelCreate };
}
