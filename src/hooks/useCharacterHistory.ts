import { useState, useRef, useCallback, useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { CreationDraftOwner, CreationDraftOperation } from './creationDraftOwner';
import type { PlayerProfile } from '../storage/db';
import type { WorldBookEntry } from '../worldbook/index';
import type { WorldDef } from '../data/worldLoader';
import type { ApiConfig } from '../api/types';
import type { HistoryPreset } from '../storage/templateStore';
import { requestStreamWithRetry } from '../api/client';
import { getAgeStages, getAllSegmentIds } from '../utils/ageStages';

interface UseCharacterHistoryOptions {
  draftOwner: CreationDraftOwner;
  apiConfig: ApiConfig | null;
  selectedWorld: string;
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  navigate: (screen: any) => void;
  showAlert: (msg: string, opts?: any) => Promise<void>;
}

export function useCharacterHistory({
  apiConfig, allWorlds, worldEntry, selectedWorld: viewWorld, draftOwner, navigate, showAlert,
}: UseCharacterHistoryOptions) {
  const document = useSyncExternalStore(draftOwner.subscribe, draftOwner.getSnapshot, draftOwner.getSnapshot);
  const segments = document.segments, includeAgeStages = document.includeAgeStages;
  const setSegments: Dispatch<SetStateAction<Record<string, string>>> = useCallback(value => {
    const current = draftOwner.getSnapshot().segments;
    draftOwner.edit({ segments: typeof value === 'function' ? value(current) : value });
  }, [draftOwner]);
  const setIncludeAgeStages: Dispatch<SetStateAction<boolean>> = useCallback(value => {
    const current = draftOwner.getSnapshot().includeAgeStages;
    draftOwner.edit({ includeAgeStages: typeof value === 'function' ? value(current) : value });
  }, [draftOwner]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const operationRef = useRef<CreationDraftOperation | null>(null);
  const beginGeneration = (segmentId: string | null) => {
    const operation = draftOwner.beginOperation('history');
    operationRef.current = operation;
    setIsGenerating(true); setRegeneratingId(segmentId);
    operation.signal.addEventListener('abort', () => {
      if (operationRef.current === operation) { setIsGenerating(false); setRegeneratingId(null); }
    }, { once: true });
    return operation;
  };
  const finishGeneration = (operation: CreationDraftOperation) => {
    if (operationRef.current !== operation) return;
    operation.finish(); operationRef.current = null;
    setIsGenerating(false); setRegeneratingId(null);
  };
  const getWorldSetting = (worldId: string) => {
    const worldData = allWorlds.find(w => w.id === worldId);
    return (worldId === viewWorld ? worldEntry?.content : undefined) || worldData?.description || '自由穿越模式';
  };
  const getPlayerInfoBlock = (profile: PlayerProfile) => {
    const parts = [
      `- 姓名：${profile.name || '未设定'}`,
      `- 性别：${profile.gender || '未设定'}`,
      `- 年龄：${profile.age || '未设定'}`,
      `- 背景描述：${profile.background || '无'}`,
    ];
    if (profile.career) parts.push(`- 职业：${profile.career}`);
    if (profile.customNpcs.length > 0) parts.push(`- 关联NPC：${profile.customNpcs.map(n => `${n.name}(${n.relationshipType || '同伴'})`).join('、')}`);
    return parts.join('\n');
  };

  // ─── 解析 AI 输出为分段 ───
  const parseSegmentsFromText = (text: string, ageStr: string): Record<string, string> => {
    const ids = getAllSegmentIds(ageStr);
    const result: Record<string, string> = {};
    for (const id of ids) result[id] = '';

    const sections: { title: string; content: string }[] = [];
    const pattern = /##\s*([^\n]+)\n([\s\S]*?)(?=##\s*[^\n]+|$)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      sections.push({ title: match[1].trim(), content: match[2].trim() });
    }

    for (const sec of sections) {
      if (sec.title.includes('序章')) {
        result.prologue = sec.content;
      } else {
        const stageId = ids.find(id => id !== 'prologue' && !result[id]);
        if (stageId) result[stageId] = sec.content;
      }
    }

    if (!Object.values(result).some(v => v.trim())) {
      result.prologue = text;
    }
    return result;
  };

  // ─── 一键生成全部 ───
  const handleGenerateAll = async (drafts?: Record<string, string>) => {
    if (!apiConfig) { await showAlert('请先配置API'); navigate('settings'); return; }

    const operation = beginGeneration(null);
    const { profile: personalInfo, selectedWorld, includeAgeStages } = operation.inputs;
    const perspective = personalInfo.perspective;
    const config = structuredClone(apiConfig);
    const draftsMap = structuredClone(drafts || operation.inputs.segments);

    const ageStages = getAgeStages(personalInfo.age);
    const stagePrompts = includeAgeStages
      ? '\n\n' + ageStages.map(s => `## ${s.label}\n（${s.label}期间的关键经历：重大事件、人际关系变化、个人成长转折点，2-3段）`).join('\n\n')
      : '';

    // 草稿信息
    const draftEntries = Object.entries(draftsMap).filter(([, v]) => v.trim());
    const draftBlock = draftEntries.length > 0
      ? `\n【玩家草稿】\n${draftEntries.map(([id, text]) => {
        const label = id === 'prologue' ? '序章' : ageStages.find(s => s.id === id)?.label || id;
        return `【${label}】\n${text}`;
      }).join('\n\n')}\n\n请参考以上草稿内容，在其基础上扩展、润色、补充细节，生成完整且精彩的经历。保留草稿中的核心设定和关键事件，但用更好的叙事手法呈现。`
      : '';

    // NPC 关联信息
    const npcBlock = personalInfo.customNpcs.length > 0
      ? `\n【关联NPC】\n${personalInfo.customNpcs.map(n => `- ${n.name}：${n.relationshipType || '同伴'}，${n.personality || ''}${n.background ? '。' + n.background : ''}`).join('\n')}\n\n请在经历中自然地融入这些NPC，描写他们与角色的互动和关系发展。`
      : '';

    const perspectiveInstruction = perspective === '第一人称'
      ? '5. 叙事视角：用第一人称"我"来叙述角色的经历和感受。'
      : perspective === '第二人称'
        ? '5. 叙事视角：用第二人称"你"来叙述角色的经历。'
        : '5. 叙事视角：用第三人称叙述角色的经历，用角色姓名或"他/她"来指代角色，不要使用"你"。';

    const systemPrompt = `你是一位专业的角色背景故事撰写者，擅长为互动小说生成沉浸式的人生经历。请根据以下信息，为玩家生成完整的人生经历。

【世界设定】
${getWorldSetting(selectedWorld)}

【玩家信息】
${getPlayerInfoBlock(personalInfo)}
${npcBlock}${draftBlock}
═══════════════════════════════════════
【写作要求】

1. 格式：严格按照以下结构输出，每个段落以 ## 标题开头，段落间用空行分隔

2. 内容质量：
   - 用具体的场景和细节描写，而非概括性叙述（"show, don't tell"）
   - 每个阶段要有明确的事件、冲突或转折，不能只是流水账
   - 人物的决定和行为要与其性格、背景一致
   - 各阶段之间要有因果联系，形成连贯的人生轨迹

3. 世界融合：
   - 使用世界设定中的地名、组织、术语来增强代入感
   - 角色的经历要与世界的权力结构、社会氛围相呼应
   - 避免出现与世界设定矛盾的内容

4. 序章特别要求：
   - 这是冒险的开场白，要有画面感和氛围感
   - 描写角色当前所处的场景、感官细节、内心状态
   - 暗示即将到来的冒险或冲突，制造悬念
   - 2-3段，不少于200字
${includeAgeStages ? `
6. 人生阶段要求：
   - 每个阶段描写2-3个关键事件
   - 要有角色的成长、失去、或认知变化
   - 阶段之间要自然衔接，体现时间流逝` : ''}

${perspectiveInstruction}

═══════════════════════════════════════
【输出格式】

## 序章
（冒险开场白，描写当前场景和氛围）
${stagePrompts}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: '请为我生成完整的角色人生经历。' },
    ];

    let rawText = '';
    try {
      const result = await requestStreamWithRetry(config, messages, {
        signal: operation.signal,
        onDelta: (_delta, acc) => {
          if (!operation.isCurrent()) return;
          rawText = acc;
          const parsed = parseSegmentsFromText(acc, personalInfo.age);
          operation.commit({ segments: parsed });
        },
      });
      if (!operation.isCurrent()) return;
      const finalSegments = parseSegmentsFromText(result.text || rawText, personalInfo.age);
      operation.commit({ segments: finalSegments });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (operation.isCurrent()) await showAlert(`经历生成失败：${err instanceof Error ? err.message : String(err)}。已收到的片段仍保留，可手写或重试。`, { title: '生成失败' });
    } finally {
      finishGeneration(operation);
    }
  };

  // ─── 单段重新生成 ───
  const handleRegenerateSegment = async (segmentId: string, draft?: string) => {
    if (!apiConfig) { await showAlert('请先配置API'); navigate('settings'); return; }

    const operation = beginGeneration(segmentId);
    const { profile: personalInfo, selectedWorld, segments } = operation.inputs;
    const perspective = personalInfo.perspective;
    const config = structuredClone(apiConfig);

    const ageStages = getAgeStages(personalInfo.age);
    const allIds = getAllSegmentIds(personalInfo.age);
    const segmentNames: Record<string, string> = {
      prologue: '序章（冒险开场白，描写当前场景和氛围）',
      ...Object.fromEntries(ageStages.map(s => [s.id, s.label])),
    };

    const idx = allIds.indexOf(segmentId);
    const prevSegment = idx > 0 ? segments[allIds[idx - 1]] : '';
    const nextSegment = idx < allIds.length - 1 ? segments[allIds[idx + 1]] : '';

    let contextBlock = '';
    if (prevSegment) contextBlock += `【前一阶段内容】\n${prevSegment}\n\n`;
    if (nextSegment) contextBlock += `【后一阶段内容】\n${nextSegment}\n\n`;

    const segmentDraft = draft ?? segments[segmentId];
    const draftBlock = segmentDraft?.trim()
      ? `\n【玩家草稿】\n${segmentDraft.trim()}\n\n请参考以上草稿内容，在其基础上扩展、润色、补充细节。保留草稿中的核心设定和关键事件，但用更好的叙事手法呈现。\n`
      : '';

    const stageName = segmentNames[segmentId] || segmentId;
    const regenPerspective = perspective === '第一人称'
      ? '用第一人称"我"来叙述。'
      : perspective === '第二人称'
        ? '用第二人称"你"来叙述。'
        : '用第三人称叙述，用角色姓名或"他/她"来指代角色，不要使用"你"。';

    const systemPrompt = `你是一位专业的角色背景故事撰写者。请只为以下阶段生成内容。

【世界设定】
${getWorldSetting(selectedWorld)}

【玩家信息】
${getPlayerInfoBlock(personalInfo)}

${contextBlock}${draftBlock}
【写作要求】
- 用具体的场景和细节描写，而非概括性叙述
- 要有明确的事件、冲突或转折，不能流水账
- 使用世界设定中的地名、组织、术语增强代入感
- 与前后阶段自然衔接
- ${regenPerspective}

请只输出「${stageName}」的内容，不要输出标题标记，直接输出故事文本，2-3段。`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `请为我生成${stageName}的内容。` },
    ];

    try {
      let accumulated = '';
      const result = await requestStreamWithRetry(config, messages, {
        signal: operation.signal,
        onDelta: (_delta, acc) => {
          if (!operation.isCurrent()) return;
          accumulated = acc;
          operation.commit({ segments: { ...draftOwner.getSnapshot().segments, [segmentId]: acc } });
        },
      });
      operation.commit({ segments: { ...draftOwner.getSnapshot().segments, [segmentId]: result.text || accumulated } });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (operation.isCurrent()) await showAlert(`经历生成失败：${err instanceof Error ? err.message : String(err)}。已收到的片段仍保留，可手写或重试。`, { title: '生成失败' });
    } finally {
      finishGeneration(operation);
    }
  };

  // ─── 加载预设 ───
  const loadPreset = useCallback((preset: HistoryPreset) => {
    draftOwner.edit({ segments: { ...preset.segments }, includeAgeStages: preset.includeAgeStages });
  }, [draftOwner]);

  // ─── 拼接完整文本 ───
  const buildFullCharacterHistory = useCallback(() => {
    const current = draftOwner.getSnapshot();
    const ids = current.includeAgeStages ? getAllSegmentIds(current.profile.age) : ['prologue'];
    return ids.map(id => (current.segments[id] || '').trim()).filter(Boolean).join('\n\n');
  }, [draftOwner]);

  const cancelGeneration = useCallback(() => {
    draftOwner.cancelOperation('history');
    operationRef.current = null;
    setIsGenerating(false); setRegeneratingId(null);
  }, [draftOwner]);
  // Leaving a screen only cancels work; draft persistence belongs to the owner.
  useEffect(() => cancelGeneration, [cancelGeneration]);
  const clearCompletedDraft = () => { cancelGeneration(); draftOwner.complete(); };

  return {
    segments, setSegments,
    isGenerating, regeneratingId,
    includeAgeStages, setIncludeAgeStages,
    handleGenerateAll,
    handleRegenerateSegment,
    loadPreset,
    buildFullCharacterHistory,
    cleanup: cancelGeneration, cancelGeneration,
    clearCompletedDraft,
  };
}
