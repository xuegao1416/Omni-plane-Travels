import { useState, useRef, useCallback } from 'react';
import type { PlayerProfile } from '../storage/db';
import type { WorldBookEntry } from '../worldbook/index';
import type { WorldDef } from '../data/worldLoader';
import type { ApiConfig } from '../api/types';
import type { HistoryPreset } from '../storage/templateStore';
import { requestStreamWithRetry } from '../api/client';
import { getAgeStages, getAllSegmentIds } from '../utils/ageStages';

// ─── 模块级缓存：跨导航保留已生成的 segments ───
let _segmentsCache: Record<string, string> | null = null;
export function clearSegmentsCache() { _segmentsCache = null; }

interface UseCharacterHistoryOptions {
  apiConfig: ApiConfig | null;
  personalInfo: PlayerProfile;
  selectedWorld: string;
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  initialCharacterHistory?: string;
  /** 玩家选择的叙事视角 */
  perspective?: string;
  navigate: (screen: any) => void;
  showAlert: (msg: string, opts?: any) => Promise<void>;
}

export function useCharacterHistory({
  apiConfig, personalInfo, selectedWorld, allWorlds, worldEntry,
  initialCharacterHistory, perspective, navigate, showAlert,
}: UseCharacterHistoryOptions) {
  const [segments, setSegments] = useState<Record<string, string>>(() => {
    // 优先从缓存恢复（解决返回再前进丢失经历的 Bug）
    if (_segmentsCache) return { ..._segmentsCache };
    const ids = getAllSegmentIds(personalInfo.age || '');
    const initial: Record<string, string> = {};
    for (const id of ids) initial[id] = '';
    if (initialCharacterHistory) initial.prologue = initialCharacterHistory;
    return initial;
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [includeAgeStages, setIncludeAgeStages] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // segments 变化时同步到缓存
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // ─── 辅助函数 ───
  const getWorldSetting = useCallback(() => {
    const worldData = allWorlds.find(w => w.id === selectedWorld);
    return worldEntry?.content || worldData?.description || '自由穿越模式';
  }, [allWorlds, selectedWorld, worldEntry]);

  const getPlayerInfoBlock = useCallback(() => {
    const parts = [
      `- 姓名：${personalInfo.name || '未设定'}`,
      `- 性别：${personalInfo.gender || '未设定'}`,
      `- 年龄：${personalInfo.age || '未设定'}`,
      `- 背景描述：${personalInfo.background || '无'}`,
    ];
    if (personalInfo.career) parts.push(`- 职业：${personalInfo.career}`);
    if (personalInfo.customNpcs.length > 0) {
      parts.push(`- 关联NPC：${personalInfo.customNpcs.map(n => `${n.name}(${n.relationshipType || '同伴'})`).join('、')}`);
    }
    return parts.join('\n');
  }, [personalInfo]);

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

    const draftsMap = drafts || {};

    setIsGenerating(true);
    setRegeneratingId(null);
    const controller = new AbortController();
    abortRef.current = controller;

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
${getWorldSetting()}

【玩家信息】
${getPlayerInfoBlock()}
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
      const result = await requestStreamWithRetry(apiConfig, messages, {
        signal: controller.signal,
        onDelta: (_delta, acc) => {
          rawText = acc;
          const parsed = parseSegmentsFromText(acc, personalInfo.age);
          setSegments(parsed);
        },
      });
      const finalSegments = parseSegmentsFromText(result.text || rawText, personalInfo.age);
      setSegments(finalSegments);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[AI生成全部] 失败:', err);
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  // ─── 单段重新生成 ───
  const handleRegenerateSegment = async (segmentId: string, draft?: string) => {
    if (!apiConfig) { await showAlert('请先配置API'); navigate('settings'); return; }

    setIsGenerating(true);
    setRegeneratingId(segmentId);
    const controller = new AbortController();
    abortRef.current = controller;

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

    const draftBlock = draft?.trim()
      ? `\n【玩家草稿】\n${draft.trim()}\n\n请参考以上草稿内容，在其基础上扩展、润色、补充细节。保留草稿中的核心设定和关键事件，但用更好的叙事手法呈现。\n`
      : '';

    const stageName = segmentNames[segmentId] || segmentId;
    const regenPerspective = perspective === '第一人称'
      ? '用第一人称"我"来叙述。'
      : perspective === '第二人称'
        ? '用第二人称"你"来叙述。'
        : '用第三人称叙述，用角色姓名或"他/她"来指代角色，不要使用"你"。';

    const systemPrompt = `你是一位专业的角色背景故事撰写者。请只为以下阶段生成内容。

【世界设定】
${getWorldSetting()}

【玩家信息】
${getPlayerInfoBlock()}

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
      const result = await requestStreamWithRetry(apiConfig, messages, {
        signal: controller.signal,
        onDelta: (_delta, acc) => {
          accumulated = acc;
          setSegments(prev => ({ ...prev, [segmentId]: acc }));
        },
      });
      setSegments(prev => ({ ...prev, [segmentId]: result.text || accumulated }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error(`[AI生成 ${segmentId}] 失败:`, err);
    } finally {
      setIsGenerating(false);
      setRegeneratingId(null);
      abortRef.current = null;
    }
  };

  // ─── 加载预设 ───
  const loadPreset = useCallback((preset: HistoryPreset) => {
    setSegments({ ...preset.segments });
    setIncludeAgeStages(preset.includeAgeStages);
  }, []);

  // ─── 拼接完整文本 ───
  const buildFullCharacterHistory = useCallback(() => {
    const ids = includeAgeStages
      ? getAllSegmentIds(personalInfo.age)
      : ['prologue'];
    return ids.map(id => (segments[id] || '').trim()).filter(Boolean).join('\n\n');
  }, [segments, personalInfo.age, includeAgeStages]);

  // 清理（开始游戏或离开向导时调用）
  const cleanup = () => {
    abortRef.current?.abort();
    // 将当前 segments 保存到缓存，以便重新进入步骤3时恢复
    _segmentsCache = { ...segmentsRef.current };
  };

  // 开始游戏时清理缓存
  const clearCacheAndCleanup = () => {
    abortRef.current?.abort();
    _segmentsCache = null;
  };

  return {
    segments, setSegments,
    isGenerating, regeneratingId,
    includeAgeStages, setIncludeAgeStages,
    handleGenerateAll,
    handleRegenerateSegment,
    loadPreset,
    buildFullCharacterHistory,
    cleanup,
    clearCacheAndCleanup,
  };
}
