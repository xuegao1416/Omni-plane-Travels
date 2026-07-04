/**
 * 后台世界推演 — LLM 集成层
 *
 * 职责：
 *   1. 构建推演 Prompt（支持预设系统）
 *   2. 解析 AI 返回的结构化推演结果
 *   3. 事件生成 + 暗线推进 + 切入点生成 + NPC主动交互 + 事迹操作
 */

import type {
  SimContext, SimGenerationResult, SimEvent, StoryBeat,
  StorylineUpdate, PlayerHook, EventLevel, NpcProactiveInteraction,
  ChronicleOperation, SimPreset, SimWorldContext,
} from './types';
import { EVENT_LEVELS } from './types';
import { DEFAULT_SIM_PRESET, buildPromptFromPreset } from './presets';

// ─── Prompt 构建 ───

/** 构建推演 prompt（支持传入自定义预设和世界上下文） */
export function buildSimulationPrompt(
  context: SimContext,
  preset?: SimPreset,
  worldContext?: SimWorldContext,
): string {
  const activePreset = preset ?? DEFAULT_SIM_PRESET;

  // 构建上下文变量
  const offscreenNpcText = context.offscreenNpcSummaries.length > 0
    ? context.offscreenNpcSummaries.map(npc => `
### NPC: ${npc.name} (${npc.race})
- 性格: ${npc.personality}
- 当前位置: ${npc.currentLocation}
- 当前状态: ${npc.currentStatus}
- 短期目标: ${npc.shortTermGoal}
- 长期目标: ${npc.longTermGoal}
- 最近事迹: ${npc.lastKnownChronicles.join('; ') || '无'}
- 与玩家关系: ${npc.relationship}
`).join('\n')
    : '当前没有重要角色离场。';

  const activeEventsText = context.activeEventsSummary || '当前世界暂无重大事件在推进。';

  const vars: Record<string, string> = {
    WORLD_SETTING: context.worldSetting,
    GAME_TIME: context.gameTime.current,
    CORE_CONFLICT: context.coreConflict || '未知',
    ACTIVE_EVENTS: activeEventsText,
    OFFSCREEN_NPCS: offscreenNpcText,
    REGION_STATES: Object.entries(context.regionStates)
      .map(([r, s]) => `- ${r}: ${s}`)
      .join('\n') || '暂无区域信息',
  };

  // 用预设构建 prompt
  const presetPrompt = buildPromptFromPreset(activePreset, vars);

  // 构建自适应层级描述
  const levelDescriptions = buildLevelDescriptions(worldContext);

  // 组合最终 prompt
  return `## 世界设定
${context.worldSetting}

## 当前游戏时间
${vars.GAME_TIME}

## 核心冲突
${vars.CORE_CONFLICT}

## 当前推进中的世界事件
${vars.ACTIVE_EVENTS}

## 离场角色状态
${vars.OFFSCREEN_NPCS}

## 区域状态
${vars.REGION_STATES}

${levelDescriptions}

${presetPrompt}`;
}

/**
 * 根据世界上下文构建自适应的事件层级描述
 *
 * 五层框架（mythic → civilian）是固定的功能语义，
 * 但每层具体含义由世界书条目内容决定：
 * - 修仙世界：mythic = 天道·九重天劫, political = 权力·万仙盟会
 * - 赛博朋克：mythic = 网络·赛博灵能, political = 权力·企业董事会
 * - 校园日常：mythic = 命运·规则之力, political = 权力·校方管理层
 */
function buildLevelDescriptions(worldContext?: SimWorldContext): string {
  const ctx = worldContext;
  const labels = ctx?.levelLabels ?? {
    mythic: '宏观/顶层',
    political: '权力/政治',
    factional: '组织/势力',
    economic: '经济/商业',
    civilian: '市井/个体',
  };

  let desc = '## 事件层级传导规则\n\n';
  desc += '事件应遵循从宏观到微观的级联传导。当前世界的五层架构如下：\n\n';

  desc += `1. **mythic（${labels.mythic}）**：世界级宏观力量、规则变化、超自然/科技/命运层面的异动\n`;
  desc += `2. **political（${labels.political}）**：最高权力层的决策、博弈、政策变化\n`;
  desc += `3. **factional（${labels.factional}）**：各组织/势力间的动向、冲突、结盟\n`;
  desc += `4. **economic（${labels.economic}）**：资源流动、物价波动、商业策略\n`;
  desc += `5. **civilian（${labels.civilian}）**：底层个体命运、日常百态、民生\n`;

  // 附加世界特化信息
  if (ctx) {
    const extras: string[] = [];
    if (ctx.powerSystem) {
      extras.push(`- 力量体系：${ctx.powerSystem}`);
    }
    if (ctx.socialHierarchy) {
      extras.push(`- 社会结构：${ctx.socialHierarchy}`);
    }
    const factions = Array.isArray(ctx.factions) ? ctx.factions : [];
    const coreThemes = Array.isArray(ctx.coreThemes) ? ctx.coreThemes : [];
    if (factions.length > 0) {
      extras.push(`- 已知势力：${factions.join('、')}`);
    }
    if (coreThemes.length > 0) {
      extras.push(`- 核心主题：${coreThemes.join('、')}`);
    }

    if (extras.length > 0) {
      desc += '\n### 本世界特化信息\n';
      desc += extras.join('\n') + '\n';
    }
  }

  desc += `
重要规则：
- 每个事件都应至少产生 1-2 个子事件，形成级联
- 每个层级都必须生成至少 1 个玩家切入点（playerHooks）
- 切入点应该具体、生动，让玩家有强烈的参与动机
- 层级名称请使用本世界特化的标签（如 "${labels.mythic}" 而非通用的 "顶层"）
- 角色暗线应有内在逻辑：基于性格、目标、所处环境
- 暗线推进应受世界事件影响
- 保持世界设定的内部一致性
- 不要改变已有事件的 status（除非是自然发展）`;

  return desc;
}

// ─── 响应解析 ───

/** 尝试恢复被截断的 JSON（AI 输出超过 max_tokens 时常见） */
function tryRecoverTruncatedJson(jsonText: string, originalError: unknown): Record<string, unknown> {
  // 策略1：从最后一个完整的 } 处截断
  const lastBrace = jsonText.lastIndexOf('}');
  if (lastBrace > 0) {
    try {
      const recovered = JSON.parse(jsonText.slice(0, lastBrace + 1));
      console.warn('[WorldSim] JSON 被截断，已从末尾 } 处恢复解析');
      return recovered;
    } catch { /* 继续 */ }
  }

  // 策略2：从最后一个完整行截断，然后尝试补全括号
  const lastNewline = jsonText.lastIndexOf('\n');
  if (lastNewline > 0) {
    let truncated = jsonText.slice(0, lastNewline);
    // 移除末尾不完整的行（可能是个被截断的字符串值）
    const lastCompleteNewline = truncated.lastIndexOf('\n');
    if (lastCompleteNewline > 0) {
      truncated = truncated.slice(0, lastCompleteNewline);
    }
    // 补全缺失的括号：统计未闭合的 { 和 [
    const openBraces = (truncated.match(/{/g) || []).length - (truncated.match(/}/g) || []).length;
    const openBrackets = (truncated.match(/\[/g) || []).length - (truncated.match(/]/g) || []).length;
    // 如果末尾有未闭合的字符串，先闭合
    const quoteCount = (truncated.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      truncated += '"';
    }
    // 移除末尾可能的逗号
    truncated = truncated.replace(/,\s*$/, '');
    // 补全括号
    truncated += ']'.repeat(Math.max(0, openBrackets));
    truncated += '}'.repeat(Math.max(0, openBraces));
    try {
      const recovered = JSON.parse(truncated);
      console.warn(`[WorldSim] JSON 被截断，已通过补全括号恢复解析（补了 ${openBraces} 个}、${openBrackets} 个]）`);
      return recovered;
    } catch { /* 继续 */ }
  }

  // 所有恢复策略都失败
  throw originalError;
}

export function parseSimulationResponse(rawText: string): SimGenerationResult | null {
  try {
    let jsonText = rawText.trim();

    // 处理 markdown 代码块
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // 处理 <think> 标签
    jsonText = jsonText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      // AI 返回的 JSON 可能被截断（max_tokens 不够），尝试多种策略恢复
      parsed = tryRecoverTruncatedJson(jsonText, parseErr);
    }

    const result: SimGenerationResult = {
      newEvents: [],
      updatedEvents: [],
      storylineUpdates: [],
      worldNews: '',
      playerHooks: [],
      npcInteractions: [],
    };

    // 解析事件
    if (Array.isArray(parsed.newEvents)) {
      result.newEvents = parsed.newEvents.map(
        (e: Partial<SimEvent> & Record<string, unknown>, idx: number) =>
          normalizeEvent(e, `event_gen_${Date.now()}_${idx}`, Date.now()),
      );
    }

    if (Array.isArray(parsed.updatedEvents)) {
      result.updatedEvents = parsed.updatedEvents.map(
        (e: Partial<SimEvent> & Record<string, unknown>, idx: number) =>
          normalizeEvent(e, `event_upd_${Date.now()}_${idx}`, Date.now()),
      );
    }

    // 解析暗线更新（含 chronicleOps）
    if (Array.isArray(parsed.storylineUpdates)) {
      result.storylineUpdates = parsed.storylineUpdates.map(
        (u: Partial<StorylineUpdate> & Record<string, unknown>): StorylineUpdate => ({
          npcId: String(u.npcId ?? ''),
          newBeats: Array.isArray(u.newBeats)
            ? (u.newBeats as Array<Partial<StoryBeat> & Record<string, unknown>>).map((b, bidx): StoryBeat => ({
                id: String(b.id ?? `beat_${Date.now()}_${bidx}`),
                time: String(b.time ?? ''),
                title: String(b.title ?? ''),
                narrative: String(b.narrative ?? ''),
                locationChange: b.locationChange ? String(b.locationChange) : undefined,
                relationshipDelta: typeof b.relationshipDelta === 'number' ? b.relationshipDelta : undefined,
                statusChange: b.statusChange ? String(b.statusChange) : undefined,
                merged: false,
                tick: Date.now(),
                relatedEventIds: Array.isArray(b.relatedEventIds)
                  ? b.relatedEventIds.map(String) : [],
              }))
            : [],
          summary: String(u.summary ?? ''),
          chronicleOps: Array.isArray(u.chronicleOps)
            ? (u.chronicleOps as Array<Partial<ChronicleOperation> & Record<string, unknown>>)
                .map(normalizeChronicleOp).filter(Boolean) as ChronicleOperation[]
            : undefined,
        }),
      );
    }

    // 解析 NPC 主动交互
    if (Array.isArray(parsed.npcInteractions)) {
      result.npcInteractions = parsed.npcInteractions.map(
        (i: Partial<NpcProactiveInteraction> & Record<string, unknown>, idx: number): NpcProactiveInteraction => ({
          id: String(i.id ?? `interact_${Date.now()}_${idx}`),
          npcId: String(i.npcId ?? ''),
          npcName: String(i.npcName ?? ''),
          contactReason: String(i.contactReason ?? ''),
          priority: clampPriority(Number(i.priority) ?? 50),
          innerThoughts: String(i.innerThoughts ?? ''),
          reply: String(i.reply ?? ''),
          dedupeKey: String(i.dedupeKey ?? `${i.npcId}_${i.contactReason}`),
          variableChanges: Array.isArray(i.variableChanges)
            ? i.variableChanges.map(String) : undefined,
          createdAtTick: Date.now(),
        }),
      );
    }

    // 世界新闻
    if (typeof parsed.worldNews === 'string') {
      result.worldNews = parsed.worldNews;
    }

    // 汇总所有事件的玩家切入点
    for (const evt of [...result.newEvents, ...result.updatedEvents]) {
      result.playerHooks.push(...evt.playerHooks);
    }

    return result;
  } catch (err) {
    console.error('[WorldSim] JSON 解析失败:', err);
    return null;
  }
}

// ─── 规范化 ───

/** 规范化单个事件 */
function normalizeEvent(
  raw: Partial<SimEvent> & Record<string, unknown>,
  fallbackId: string,
  tick: number,
): SimEvent {
  const level = isValidEventLevel(raw.level) ? raw.level : 'civilian';

  return {
    id: String(raw.id ?? fallbackId),
    title: String(raw.title ?? '未命名事件'),
    description: String(raw.description ?? ''),
    level,
    region: String(raw.region ?? '全局'),
    severity: clampSeverity(Number(raw.severity) || 5),
    status: (raw.status === 'brewing' || raw.status === 'active' || raw.status === 'resolved')
      ? raw.status : 'brewing',
    childEventIds: Array.isArray(raw.childEventIds) ? raw.childEventIds.map(String) : [],
    parentEventId: raw.parentEventId ? String(raw.parentEventId) : undefined,
    affectedNpcIds: Array.isArray(raw.affectedNpcIds) ? raw.affectedNpcIds.map(String) : [],
    affectedFactions: Array.isArray(raw.affectedFactions) ? raw.affectedFactions.map(String) : [],
    playerHooks: Array.isArray(raw.playerHooks)
      ? (raw.playerHooks as Array<Partial<PlayerHook> & Record<string, unknown>>).map((h): PlayerHook => ({
          title: String(h.title ?? ''),
          description: String(h.description ?? ''),
          level: isValidEventLevel(h.level) ? h.level : level,
          keyEntities: Array.isArray(h.keyEntities) ? h.keyEntities.map(String) : [],
          suggestedActions: Array.isArray(h.suggestedActions) ? h.suggestedActions.map(String) : [],
          urgency: (h.urgency === 'urgent' || h.urgency === 'near_term' || h.urgency === 'ongoing')
            ? h.urgency : 'ongoing',
        }))
      : [],
    createdAtTime: String(raw.createdAtTime ?? ''),
    startedAtTime: raw.startedAtTime ? String(raw.startedAtTime) : undefined,
    resolvedAtTime: raw.resolvedAtTime ? String(raw.resolvedAtTime) : undefined,
    createdAtTick: tick,
    batchId: `batch_${tick}`,
    lastUpdatedTick: typeof raw.lastUpdatedTick === 'number' ? raw.lastUpdatedTick : tick,
  };
}

/** 规范化事迹操作 */
function normalizeChronicleOp(
  raw: Partial<ChronicleOperation> & Record<string, unknown>,
): ChronicleOperation | null {
  const op = raw.op;
  if (op !== 'add' && op !== 'replace' && op !== 'merge' && op !== 'remove') return null;
  return {
    op,
    index: typeof raw.index === 'number' ? raw.index : undefined,
    oldValue: raw.oldValue ? String(raw.oldValue) : undefined,
    value: raw.value ? String(raw.value) : undefined,
  };
}

// ─── 工具函数 ───

function isValidEventLevel(v: unknown): v is EventLevel {
  return typeof v === 'string' && EVENT_LEVELS.includes(v as EventLevel);
}

function clampSeverity(v: number): number {
  return Math.max(0, Math.min(10, Math.round(v) || 5));
}

function clampPriority(v: number): number {
  return Math.max(0, Math.min(999, Math.round(v) || 50));
}
