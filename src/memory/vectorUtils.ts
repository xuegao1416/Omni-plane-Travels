// ============================================================
// 向量计算工具
// 移植自 yijiekkk useMemorySystem.js 中的向量相关函数
// ============================================================

import type {
  VectorFact,
  VectorFactType,
  VectorMemoryItem,
} from './types';

// ─── 余弦相似度 ───

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  const len = Math.min(vecA.length, vecB.length);
  if (len === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ─── 向量事实类型归一化 ───

const VALID_VECTOR_FACT_TYPES: ReadonlySet<string> = new Set([
  'task', 'character', 'relationship', 'location', 'faction',
  'event', 'clue', 'item', 'ability', 'status', 'rule', 'world', 'other',
]);

export function normalizeVectorFactType(value: unknown): VectorFactType {
  const text = String(value ?? '').trim().toLowerCase();
  if (VALID_VECTOR_FACT_TYPES.has(text)) return text as VectorFactType;

  // 常见映射
  const map: Record<string, VectorFactType> = {
    'npc': 'character',
    'person': 'character',
    '人物': 'character',
    '角色': 'character',
    'place': 'location',
    '地点': 'location',
    '场所': 'location',
    'org': 'faction',
    'organization': 'faction',
    '势力': 'faction',
    '组织': 'faction',
    'thing': 'item',
    '物品': 'item',
    '装备': 'item',
    'skill': 'ability',
    '技能': 'ability',
    '能力': 'ability',
    'quest': 'task',
    '任务': 'task',
    '委托': 'task',
    'mission': 'task',
    'relation': 'relationship',
    '关系': 'relationship',
    '线索': 'clue',
    '情报': 'clue',
    'secret': 'clue',
    '状态': 'status',
    'buff': 'status',
    'debuff': 'status',
    '规则': 'rule',
    '禁令': 'rule',
    '世界': 'world',
    'world_event': 'world',
  };

  return map[text] || 'other';
}

export function normalizeVectorTypeList(
  value: unknown,
  { fallback = [], limit = 4, exclude = [] }: { fallback?: VectorFactType[]; limit?: number; exclude?: VectorFactType[] } = {},
): VectorFactType[] {
  const sources = Array.isArray(value) ? value : (value != null ? [value] : []);
  const excludeSet = new Set(exclude.map(s => s.toLowerCase()));
  const result: VectorFactType[] = [];
  const seen = new Set<string>();

  for (const item of sources) {
    if (result.length >= limit) break;
    const normalized = normalizeVectorFactType(item);
    const key = normalized.toLowerCase();
    if (key === 'other' || seen.has(key) || excludeSet.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result.length > 0 ? result : fallback;
}

export function normalizeVectorEntityField(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0 && item.length <= 80);
  return result.length > 0 ? result : fallback;
}

export function buildVectorFallbackEntitySlots(
  primaryType: VectorFactType,
  entities: string[],
): {
  characters: string[];
  locations: string[];
  factions: string[];
  items: string[];
  abilities: string[];
  events: string[];
  rules: string[];
} {
  const safeEntities = Array.isArray(entities) ? entities.filter(Boolean) : [];

  const result = {
    characters: [] as string[],
    locations: [] as string[],
    factions: [] as string[],
    items: [] as string[],
    abilities: [] as string[],
    events: [] as string[],
    rules: [] as string[],
  };

  // 根据主类型分配实体到对应槽位
  for (const entity of safeEntities) {
    const name = String(entity).trim();
    if (!name) continue;

    switch (primaryType) {
      case 'character':
      case 'relationship':
        result.characters.push(name);
        break;
      case 'location':
        result.locations.push(name);
        break;
      case 'faction':
        result.factions.push(name);
        break;
      case 'item':
        result.items.push(name);
        break;
      case 'ability':
        result.abilities.push(name);
        break;
      case 'event':
        result.events.push(name);
        break;
      case 'rule':
        result.rules.push(name);
        break;
      default:
        // 对于其他类型，尝试推断
        result.characters.push(name);
    }
  }

  return result;
}

export function collectVectorSlotEntities(slots: {
  characters?: string[];
  locations?: string[];
  factions?: string[];
  items?: string[];
  abilities?: string[];
  events?: string[];
  rules?: string[];
}): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const key of ['characters', 'locations', 'factions', 'items', 'abilities', 'events', 'rules'] as const) {
    const arr = slots[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const name = String(item).trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }

  return result;
}

export function normalizeVectorFactImportance(value: unknown, fallback = 3): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(5, Math.round(num)));
}

export function normalizeVectorFactTimeScope(value: unknown): 'short' | 'mid' | 'long' {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'short' || text === 'mid' || text === 'long') return text;
  return 'mid';
}

export function normalizeVectorFactState(value: unknown): 'active' | 'resolved' | 'expired' | 'unknown' {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'active' || text === 'resolved' || text === 'expired' || text === 'unknown') return text;
  return 'unknown';
}

// ─── 向量事实归一化 ───

export function normalizeVectorFact(item: unknown): VectorFact | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const raw = item as Record<string, unknown>;
  const fact = String(raw.fact ?? raw.content ?? raw.text ?? raw.title ?? '').trim();
  if (!fact || fact.length < 4) return null;

  const primaryType = normalizeVectorFactType(raw.primaryType ?? raw.type);
  const entities = normalizeVectorEntityField(raw.entities, []);

  // 如果没有实体槽位数据，从 entities 推断
  const slots = buildVectorFallbackEntitySlots(primaryType, entities);

  return {
    fact,
    title: String(raw.title ?? '').trim() || undefined,
    summary: String(raw.summary ?? '').trim() || undefined,
    keywords: normalizeVectorEntityField(raw.keywords, []),
    entities,
    primaryType,
    secondaryTypes: normalizeVectorTypeList(raw.secondaryTypes, { fallback: [], limit: 4, exclude: [primaryType] }),
    characters: normalizeVectorEntityField(raw.characters, slots.characters),
    locations: normalizeVectorEntityField(raw.locations, slots.locations),
    factions: normalizeVectorEntityField(raw.factions, slots.factions),
    items: normalizeVectorEntityField(raw.items, slots.items),
    abilities: normalizeVectorEntityField(raw.abilities, slots.abilities),
    events: normalizeVectorEntityField(raw.events, slots.events),
    rules: normalizeVectorEntityField(raw.rules, slots.rules),
    timeMarkers: normalizeVectorEntityField(raw.timeMarkers, []),
    importance: normalizeVectorFactImportance(raw.importance),
    timeScope: normalizeVectorFactTimeScope(raw.timeScope),
    state: normalizeVectorFactState(raw.state),
    sourceStartIndex: Number.isFinite(Number(raw.sourceStartIndex)) ? Math.floor(Number(raw.sourceStartIndex)) : null,
    sourceEndIndex: Number.isFinite(Number(raw.sourceEndIndex)) ? Math.floor(Number(raw.sourceEndIndex)) : null,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Math.floor(Number(raw.createdAt)) : Date.now(),
  };
}

export function normalizeVectorMemoryItem(item: unknown, index = 0): VectorMemoryItem | null {
  const fact = normalizeVectorFact(item);
  if (!fact) return null;

  const raw = (item && typeof item === 'object') ? item as Record<string, unknown> : {};

  return {
    ...fact,
    id: String(raw.id ?? `vec_${index}_${Date.now()}`),
    searchText: String(raw.searchText ?? '').trim() || undefined,
    embeddingTimestamp: Number.isFinite(Number(raw.embeddingTimestamp))
      ? Math.floor(Number(raw.embeddingTimestamp))
      : undefined,
  };
}

// ─── 向量事实数组解析 ───

export function resolveVectorFactArrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;

  const candidateKeys = ['facts', 'data', 'result', 'results', 'items', 'memories', 'entries'];
  for (const key of candidateKeys) {
    const val = (payload as Record<string, unknown>)[key];
    if (Array.isArray(val)) return val;
  }

  // 兼容单条事实对象
  const p = payload as Record<string, unknown>;
  if (p.fact || p.content) return [payload];

  return [];
}
