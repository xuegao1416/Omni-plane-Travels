// ============================================================
// AI 返回值解析器
// 移植自 yijiekkk useMemorySystem.js 中的解析相关函数
// ============================================================

import type {
  NarrativeIngestResult,
  NarrativeSummaryResult,
  SummaryMemoryItem,
  NarrativeRetrievePlannerResult,
  NarrativeConflictJudgeResult,
  SceneAnchor,
} from './types';

// ─── 平衡括号提取（支持嵌套，避免贪婪正则匹配过长内容） ───
function extractBalancedJson(text: string, open: string, close: string): RegExpMatchArray | null {
  const startIdx = text.indexOf(open);
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const match = text.substring(startIdx, i + 1);
        return Object.assign([match], { index: startIdx, input: text }) as unknown as RegExpMatchArray;
      }
    }
  }
  return null;
}

// ─── JSON 安全解析 ───

function parseJSONSafe(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── 通用解析：从 AI 返回文本中提取 JSON ───

export function parseNarrativePayload(rawContent: string): Record<string, unknown> {
  // 直接解析
  const directParsed = parseJSONSafe(rawContent);
  if (directParsed && typeof directParsed === 'object' && !Array.isArray(directParsed)) {
    return directParsed as Record<string, unknown>;
  }

  // 代码块包裹
  const fenced = String(rawContent || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = parseJSONSafe(fenced[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }

  // JSON 对象匹配（通过括号深度提取，支持嵌套）
  const objectMatch = extractBalancedJson(String(rawContent || ''), '{', '}');
  if (objectMatch?.[0]) {
    const parsed = parseJSONSafe(objectMatch[0]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }

  return {};
}

export function parseNarrativeArrayPayload(rawContent: string): unknown[] {
  // 直接解析
  const directParsed = parseJSONSafe(rawContent);
  if (Array.isArray(directParsed)) return directParsed;

  // 代码块包裹
  const fenced = String(rawContent || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = parseJSONSafe(fenced[1]);
    if (Array.isArray(parsed)) return parsed;
  }

  // 数组匹配（通过括号深度提取，支持嵌套）
  const arrayMatch = extractBalancedJson(String(rawContent || ''), '[', ']');
  if (arrayMatch?.[0]) {
    const parsed = parseJSONSafe(arrayMatch[0]);
    if (Array.isArray(parsed)) return parsed;
  }

  // 对象中包含数组
  const obj = parseNarrativePayload(rawContent);
  const candidateKeys = ['facts', 'data', 'result', 'results', 'items', 'memories', 'entries', 'rankings'];
  for (const key of candidateKeys) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }

  return [];
}

// ─── 源范围解析 ───

export function parseNarrativeSourceRangeText(
  sourceRange: string,
  fallbackMeta: { sourceStartIndex?: number; sourceEndIndex?: number } = {},
): { sourceStartIndex?: number; sourceEndIndex?: number } {
  const text = String(sourceRange || '').trim();
  const matched = text.match(/(\d+)\s*-\s*(\d+)/);
  if (matched) {
    return {
      sourceStartIndex: Math.max(0, Math.floor(Number(matched[1]) || 0)),
      sourceEndIndex: Math.max(0, Math.floor(Number(matched[2]) || 0)),
    };
  }

  const single = text.match(/^(\d+)$/);
  if (single) {
    const index = Math.max(0, Math.floor(Number(single[1]) || 0));
    return { sourceStartIndex: index, sourceEndIndex: index };
  }

  return {
    sourceStartIndex: Number.isFinite(Number(fallbackMeta?.sourceStartIndex))
      ? Math.floor(Number(fallbackMeta.sourceStartIndex))
      : undefined,
    sourceEndIndex: Number.isFinite(Number(fallbackMeta?.sourceEndIndex))
      ? Math.floor(Number(fallbackMeta.sourceEndIndex))
      : undefined,
  };
}

// ─── 叙事写入结果解析 ───

function normalizeStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0 && item.length <= 200)
    .slice(0, limit);
}

export function parseNarrativeIngestResult(rawContent: string): NarrativeIngestResult {
  const payload = parseNarrativePayload(rawContent);

  return {
    success: true,
    sourceStartIndex: 0,
    sourceEndIndex: 0,
    appliedCount: 0,
    dropReasons: normalizeStringArray(payload.dropReasons),
    scenePatch: parseScenePatch(payload.scenePatch),
    threadUpserts: parseThreadUpserts(payload.threadUpserts).filter(Boolean) as NarrativeIngestResult['threadUpserts'],
    stateSlotUpserts: parseStateSlotUpserts(payload.stateSlotUpserts).filter(Boolean) as NarrativeIngestResult['stateSlotUpserts'],
    relationUpserts: parseRelationUpserts(payload.relationUpserts).filter(Boolean) as NarrativeIngestResult['relationUpserts'],
    relationNetworkUpserts: parseRelationNetworkUpserts(payload.relationNetworkUpserts).filter(Boolean) as NarrativeIngestResult['relationNetworkUpserts'],
    eventCandidates: parseEventCandidates(payload.eventCandidates).filter(Boolean) as NarrativeIngestResult['eventCandidates'],
    entityPatches: parseEntityPatches(payload.entityPatches).filter(Boolean) as NarrativeIngestResult['entityPatches'],
    archiveHints: parseArchiveHints(payload.archiveHints).filter(Boolean) as NarrativeIngestResult['archiveHints'],
  };
}

function parseScenePatch(value: unknown): Partial<SceneAnchor> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    timeLabel: String(raw.timeLabel ?? '').trim() || undefined,
    locationLabel: String(raw.locationLabel ?? '').trim() || undefined,
    presentEntities: normalizeStringArray(raw.presentEntities),
    immediateGoal: String(raw.immediateGoal ?? '').trim() || undefined,
    immediateRisk: String(raw.immediateRisk ?? '').trim() || undefined,
    conversationFocus: String(raw.conversationFocus ?? '').trim() || undefined,
    recentChange: String(raw.recentChange ?? '').trim() || undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
  };
}

function parseThreadUpserts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? ''),
      title: String(raw.title ?? ''),
      summary: String(raw.summary ?? raw.goal ?? ''),
      goal: String(raw.goal ?? raw.summary ?? ''),
      status: String(raw.status ?? 'open') as 'open' | 'blocked' | 'suspended' | 'resolved' | 'failed' | 'superseded',
      priority: Number(raw.priority ?? 3),
      blockingReason: String(raw.blockingReason ?? ''),
      relatedEntities: normalizeStringArray(raw.relatedEntities),
      relatedItems: normalizeStringArray(raw.relatedItems),
      relatedLocations: normalizeStringArray(raw.relatedLocations),
      deadline: String(raw.deadline ?? ''),
      sourceStartIndex: Number(raw.sourceStartIndex) || null,
      sourceEndIndex: Number(raw.sourceEndIndex) || null,
    };
  }).filter(Boolean);
}

function parseStateSlotUpserts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? ''),
      scopeType: String(raw.scopeType ?? 'player') as 'player' | 'npc' | 'location' | 'world',
      scopeId: String(raw.scopeId ?? ''),
      slotType: String(raw.slotType ?? ''),
      value: String(raw.value ?? raw.summary ?? ''),
      summary: String(raw.summary ?? raw.value ?? ''),
      status: String(raw.status ?? 'active') as 'active' | 'resolved' | 'expired',
      priority: Number(raw.priority ?? 3),
      sourceStartIndex: Number(raw.sourceStartIndex) || null,
      sourceEndIndex: Number(raw.sourceEndIndex) || null,
    };
  }).filter(Boolean);
}

function parseRelationUpserts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? ''),
      sourceEntityId: String(raw.sourceEntityId ?? ''),
      targetEntityId: String(raw.targetEntityId ?? ''),
      relationType: String(raw.relationType ?? ''),
      stance: String(raw.stance ?? ''),
      strength: Number(raw.strength ?? 0.5),
      status: String(raw.status ?? 'active') as 'active' | 'broken' | 'changed',
      summary: String(raw.summary ?? ''),
      sourceStartIndex: Number(raw.sourceStartIndex) || null,
      sourceEndIndex: Number(raw.sourceEndIndex) || null,
    };
  }).filter(Boolean);
}

function parseRelationNetworkUpserts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? ''),
      sourceEntityId: String(raw.sourceEntityId ?? ''),
      targetEntityId: String(raw.targetEntityId ?? ''),
      relationType: String(raw.relationType ?? ''),
      summary: String(raw.summary ?? ''),
      strength: Number(raw.strength ?? 0.5),
      status: String(raw.status ?? 'active') as 'active' | 'changed' | 'broken' | 'superseded',
      confidence: Number(raw.confidence ?? 0.5),
      sourceStartIndex: Number(raw.sourceStartIndex) || null,
      sourceEndIndex: Number(raw.sourceEndIndex) || null,
    };
  }).filter(Boolean);
}

function parseEventCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? ''),
      title: String(raw.title ?? ''),
      summary: String(raw.summary ?? ''),
      excerpt: String(raw.excerpt ?? ''),
      importance: Number(raw.importance ?? 3),
      status: String(raw.status ?? 'hot') as 'hot' | 'warm' | 'cold',
      entityRefs: normalizeStringArray(raw.entityRefs),
      locationRefs: normalizeStringArray(raw.locationRefs),
      threadRefs: normalizeStringArray(raw.threadRefs),
      timeLabels: normalizeStringArray(raw.timeLabels),
      sourceStartIndex: Number(raw.sourceStartIndex) || null,
      sourceEndIndex: Number(raw.sourceEndIndex) || null,
    };
  }).filter(Boolean);
}

function parseEntityPatches(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      entityType: String(raw.entityType ?? 'other') as 'character' | 'location' | 'faction' | 'item' | 'ability' | 'other',
      aliases: normalizeStringArray(raw.aliases),
      currentStatus: normalizeStringArray(raw.currentStatus),
      stableFacts: normalizeStringArray(raw.stableFacts),
      currentStance: String(raw.currentStance ?? ''),
      affiliations: normalizeStringArray(raw.affiliations),
      relatedThreads: normalizeStringArray(raw.relatedThreads),
      relatedEvents: normalizeStringArray(raw.relatedEvents),
      sourceStartIndex: Number(raw.sourceStartIndex) || null,
      sourceEndIndex: Number(raw.sourceEndIndex) || null,
    };
  }).filter(Boolean);
}

function parseArchiveHints(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw.id ?? '').trim() || undefined,
      title: String(raw.title ?? '').trim() || undefined,
      summary: String(raw.summary ?? '').trim() || undefined,
      keywords: normalizeStringArray(raw.keywords),
    };
  }).filter(Boolean);
}

// ─── 摘要结果解析 ───

interface ParsedSummaryPatchItem {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  sourceStartIndex?: number;
  sourceEndIndex?: number;
  savedAt?: number;
}

function normalizeSummaryPatchItem(item: unknown): ParsedSummaryPatchItem | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;

  const title = String(raw.title ?? raw.name ?? '').trim();
  const summary = String(raw.summary ?? raw.fact ?? raw.excerpt ?? title).trim();

  if (!title && !summary) return null;

  return {
    id: String(raw.id ?? '').trim(),
    title: title || '未命名记忆',
    summary: summary || title || '',
    keywords: normalizeStringArray(raw.keywords),
    sourceStartIndex: Number.isFinite(Number(raw.sourceStartIndex))
      ? Math.floor(Number(raw.sourceStartIndex))
      : undefined,
    sourceEndIndex: Number.isFinite(Number(raw.sourceEndIndex))
      ? Math.floor(Number(raw.sourceEndIndex))
      : undefined,
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Math.floor(Number(raw.savedAt)) : undefined,
  };
}

export function parseNarrativeSummaryResult(rawContent: string): NarrativeSummaryResult {
  const payload = parseNarrativePayload(rawContent);

  const normalize = (arr: unknown): SummaryMemoryItem[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map(item => normalizeSummaryPatchItem(item))
      .filter((item): item is ParsedSummaryPatchItem => item != null)
      .map(item => ({
        id: item.id || undefined,
        title: item.title,
        summary: item.summary,
        keywords: item.keywords,
        sourceStartIndex: item.sourceStartIndex ?? null,
        sourceEndIndex: item.sourceEndIndex ?? null,
        savedAt: item.savedAt,
      }));
  };

  return {
    otherCharacterMemories: normalize(payload.otherCharacterMemories),
    playerMemories: normalize(payload.playerMemories),
    itemMemories: normalize(payload.itemMemories),
  };
}

export function isNarrativeSummaryResultEmpty(payload: NarrativeSummaryResult): boolean {
  return (
    payload.otherCharacterMemories.length === 0 &&
    payload.playerMemories.length === 0 &&
    payload.itemMemories.length === 0
  );
}

// ─── 检索规划结果解析 ───

export function parseNarrativeRetrievePlannerResult(rawContent: string): NarrativeRetrievePlannerResult {
  const payload = parseNarrativePayload(rawContent);

  const items = Array.isArray(payload.items)
    ? payload.items
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const raw = item as Record<string, unknown>;
          const title = String(raw.title ?? '').trim();
          if (!title) return null;
          return { title, reason: String(raw.reason ?? '').trim() || undefined } as { title: string; reason?: string };
        })
        .filter((item): item is { title: string; reason?: string } => item != null)
    : [];

  return {
    items,
    retrievalKeywords: normalizeStringArray(payload.retrievalKeywords, 16),
    notes: String(payload.notes ?? '').trim() || undefined,
  };
}

// ─── 冲突裁决结果解析 ───

const VALID_CONFLICT_ACTIONS = new Set([
  'keep_both', 'update_current', 'supersede_current', 'mark_expired', 'reject_incoming',
]);

export function parseNarrativeConflictJudgeResult(rawContent: string): NarrativeConflictJudgeResult {
  const payload = parseNarrativePayload(rawContent);
  const action = String(payload.action ?? 'keep_both').trim().toLowerCase();

  return {
    action: VALID_CONFLICT_ACTIONS.has(action)
      ? action as NarrativeConflictJudgeResult['action']
      : 'keep_both',
    reason: String(payload.reason ?? '').trim(),
    confidence: typeof payload.confidence === 'number'
      ? Math.max(0, Math.min(1, payload.confidence))
      : 0.5,
  };
}

// ─── 向量查询改写结果解析 ───

export interface VectorQueryRewriteResult {
  semanticQuery: string;
  retrievalKeywords: string[];
  entityFocus: string[];
  timeFocus: string[];
  locationFocus: string[];
  intent: string;
  needHistoricalCause: boolean;
  needRelationshipFocus: boolean;
}

export function parseVectorQueryRewriteResult(rawContent: string): VectorQueryRewriteResult {
  const payload = parseNarrativePayload(rawContent);

  return {
    semanticQuery: String(payload.semanticQuery ?? '').trim(),
    retrievalKeywords: normalizeStringArray(payload.retrievalKeywords, 16),
    entityFocus: normalizeStringArray(payload.entityFocus),
    timeFocus: normalizeStringArray(payload.timeFocus),
    locationFocus: normalizeStringArray(payload.locationFocus),
    intent: String(payload.intent ?? 'unknown').trim(),
    needHistoricalCause: Boolean(payload.needHistoricalCause),
    needRelationshipFocus: Boolean(payload.needRelationshipFocus),
  };
}

// ─── 精排结果解析 ───

export interface RerankResult {
  rankings: Array<{ index: number; score: number }>;
  needVectorRecall: boolean;
  vectorRecallReason: string;
  currentSceneRelationNetwork: unknown[];
}

export function parseRerankResult(rawContent: string): RerankResult {
  // 兼容纯数组和对象两种格式
  const directParsed = parseJSONSafe(rawContent);

  if (Array.isArray(directParsed)) {
    return {
      rankings: directParsed
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const raw = item as Record<string, unknown>;
          return { index: Number(raw.index ?? 0), score: Number(raw.score ?? 0) };
        })
        .filter((item): item is { index: number; score: number } => item != null),
      needVectorRecall: true,
      vectorRecallReason: '',
      currentSceneRelationNetwork: [],
    };
  }

  const payload = parseNarrativePayload(rawContent);

  return {
    rankings: Array.isArray(payload.rankings)
      ? payload.rankings
          .map((item: unknown) => {
            if (!item || typeof item !== 'object') return null;
            const raw = item as Record<string, unknown>;
            return { index: Number(raw.index ?? 0), score: Number(raw.score ?? 0) };
          })
          .filter((item): item is { index: number; score: number } => item != null)
      : [],
    needVectorRecall: payload.needVectorRecall !== false,
    vectorRecallReason: String(payload.vectorRecallReason ?? '').trim(),
    currentSceneRelationNetwork: Array.isArray(payload.currentSceneRelationNetwork)
      ? payload.currentSceneRelationNetwork
      : [],
  };
}
