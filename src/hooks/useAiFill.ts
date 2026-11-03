import { useState, useRef, useEffect, useCallback } from 'react';
import type { CreationDraftOwner, CreationDraftOperation } from './creationDraftOwner';
import type { PlayerProfile } from '../storage/db';
import type { WorldBookEntry } from '../worldbook/index';
import type { WorldDef } from '../data/worldLoader';
import type { ApiConfig } from '../api/types';
import { requestStreamWithRetry } from '../api/client';
import { buildCharacterFillPrompt } from '../utils/prompts';
import { buildSpecialConfig } from '../modules/normalizeModule';

interface UseAiFillOptions {
  draftOwner: CreationDraftOwner;
  apiConfig: ApiConfig | null;
  selectedWorld: string;
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  navigate: (screen: any) => void;
  showAlert: (msg: string, opts?: any) => Promise<void>;
}

export function useAiFill({
  apiConfig, allWorlds, worldEntry, selectedWorld: viewWorld, draftOwner, navigate, showAlert,
}: UseAiFillOptions) {
  const [isFilling, setIsFilling] = useState(false);
  const [fillElapsed, setFillElapsed] = useState(0);
  const operationRef = useRef<CreationDraftOperation | null>(null);
  const [fillText, setFillText] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAiFill = async () => {
    if (!apiConfig) { await showAlert('请先配置API'); navigate('settings'); return; }
    if (!draftOwner.getSnapshot().profile.name.trim()) { await showAlert('请至少填写角色姓名'); return; }

    const operation = draftOwner.beginOperation('fill');
    operationRef.current = operation;
    const personalInfo = operation.inputs.profile, selectedWorld = operation.inputs.selectedWorld;
    const config = structuredClone(apiConfig);
    setFillText('');
    setIsFilling(true);
    setFillElapsed(0);
    operation.signal.addEventListener('abort', () => {
      if (operationRef.current !== operation) return;
      setIsFilling(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }, { once: true });
    const startTime = Date.now();
    const timer = setInterval(() => { if (operation.isCurrent()) setFillElapsed(Math.floor((Date.now() - startTime) / 1000)); }, 1000);
    timerRef.current = timer;

    const worldData = allWorlds.find(w => w.id === selectedWorld);
    const worldSetting = (selectedWorld === viewWorld ? worldEntry?.content : undefined) || worldData?.description || '自由穿越模式';
    const hasProfessionSystem = Boolean(worldData?.modules?.some(module => module.moduleId === 'profession' && module.enabled));

    // 提取世界的数值属性模块配置（用于生成角色初始属性）
    const statMod = worldData?.modules?.find(m => m.moduleId === 'stat' && m.enabled);
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

    const systemPrompt = buildCharacterFillPrompt({
      worldSetting,
      playerName: personalInfo.name,
      playerGender: personalInfo.gender || '',
      playerAge: personalInfo.age || '',
      playerBackground: personalInfo.background || '',
      statModule,
      hasProfessionSystem,
    });

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: '请根据我的基础信息和世界设定，补全我的角色信息。' },
    ];

    const hardTimeout = setTimeout(() => {
      if (!operation.isCurrent()) return;
      draftOwner.cancelOperation('fill');
      // Report the timeout while this request still owns the action. A late rejection
      // after further player edits must never open a dialog for an abandoned request.
      void showAlert('AI 补全超时（60秒），请检查网络或 API 配置后重试', { title: '超时' });
    }, 60_000);
    try {
      const result = await requestStreamWithRetry(config, messages, {
        signal: operation.signal,
        onDelta: (_delta, accumulated) => { if (operation.isCurrent()) setFillText(accumulated); },
        maxTokens: 4096,
      });

      if (!operation.isCurrent()) return;
      const text = result.text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI 返回格式异常');

      const data = JSON.parse(jsonMatch[0]);

      // 处理技能
      const filledSkills: PlayerProfile['initialSkills'] = {};
      if (Array.isArray(data.skills)) {
        for (const s of data.skills) {
          if (s.name) filledSkills[s.name] = {
            品质: s.quality || '普通', 描述: s.desc || '', 类型: s.type || '',
          };
        }
      }

      // 处理物品
      const filledItems: PlayerProfile['initialItems'] = {};
      if (Array.isArray(data.items)) {
        for (const it of data.items) {
          if (it.name) filledItems[it.name] = {
            数量: it.quantity || 1, 类型: it.type || '', 品质: it.quality || '普通', 备注: it.note || '',
          };
        }
      }

      // 处理初始属性
      const moduleInitData: Record<string, unknown> = { ...(personalInfo.moduleInitData || {}) };
      if (data.initialStats && statModule) {
        const stats: Record<string, unknown> = {};
        if (data.initialStats.attrA != null) stats['attrA'] = { current: Number(data.initialStats.attrA) };
        if (data.initialStats.attrB != null) stats['attrB'] = { current: Number(data.initialStats.attrB) };
        for (let i = 1; i <= 6; i++) {
          const key = `dim${i}`;
          if (data.initialStats[key] != null) stats[key] = { value: Number(data.initialStats[key]) };
        }
        if (Array.isArray(data.initialStats.special)) {
          stats['special'] = data.initialStats.special.map((s: any) => ({
            id: s.id, value: Number(s.value),
          }));
        }
        moduleInitData['数值属性'] = stats;
      }

      // 更新玩家信息（不含NPC）
      const prev = personalInfo;
      operation.commit({ profile: {
        ...prev,
        age: data.age || prev.age,
        personality: data.personality || prev.personality,
        appearance: data.appearance || prev.appearance,
        background: data.background || prev.background,
        career: hasProfessionSystem ? prev.career : (data.career || prev.career),
        socialClass: data.socialClass || prev.socialClass,
        organization: data.organization || prev.organization,
        specialIdentity: data.specialIdentity || prev.specialIdentity,
        initialSkills: hasProfessionSystem ? {} : { ...prev.initialSkills, ...filledSkills },
        initialItems: { ...prev.initialItems, ...filledItems },
        moduleInitData,
      } });

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (!operation.isCurrent()) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[AI补全] 失败:', err);
      await showAlert(`AI补全失败: ${errMsg}`, { title: '补全失败' });
    } finally {
      clearTimeout(hardTimeout);
      clearInterval(timer);
      if (operationRef.current === operation) {
        operation.finish(); operationRef.current = null;
        setIsFilling(false); timerRef.current = null;
      }
    }
  };

  const cancelFill = useCallback(() => {
    draftOwner.cancelOperation('fill');
    operationRef.current = null;
    setIsFilling(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [draftOwner]);
  useEffect(() => cancelFill, [cancelFill]);

  return { isFilling, fillElapsed, fillText, handleAiFill, cancelFill, cleanup: cancelFill };
}
