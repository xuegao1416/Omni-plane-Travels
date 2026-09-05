// ═══════════════════════════════════════════════════════════════
//  世界书导入兼容层
//  统一解析各种来源的世界书 JSON：
//  - 本应用导出格式：{ worldBookEntries: [...] }（数组）
//  - 站内通用 / SillyTavern 世界书：{ entries: { "0": {...}, "1": {...} } }（对象）
//  - 顶层键大小写不敏感（entries / ENTRIES / Entries / worldBookEntries 均可）
//  - 角色卡内嵌：{ data: { character_book: { entries } } } / { character_book: { entries } }
//  - 裸数组：[...]
// ═══════════════════════════════════════════════════════════════

import type { WorldBookEntryDef, WorldBookEntryType } from '../data/worlds-schema';

// ─── 工具函数 ─────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 键名归一化：去空白/下划线/连字符 + 转小写，用于大小写不敏感匹配 */
function normalizeKeyName(name: string): string {
  return String(name || '').replace(/[\s_-]/g, '').toLowerCase();
}

/** 顶层条目容器键（归一化后） */
const TOP_LEVEL_ENTRY_KEYS = new Set(['worldbookentries', 'entries', 'items']);

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

/** 关键词字段归一化：数组或逗号/换行分隔字符串 → string[] */
function toKeyList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\r?\n|[,，|｜]/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function toFiniteNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * SillyTavern 数值 position：0=before, 1=after, 2~6=AN/EM/atDepth。
 * 本应用只支持 before_char / after_char 两个槽位，其余统一落到 after_char。
 */
function normalizePosition(value: unknown): 'before_char' | 'after_char' {
  if (typeof value === 'string') {
    const normalized = normalizeKeyName(value);
    if (normalized === 'before_char' || normalized === 'beforechar' || normalized === 'before') {
      return 'before_char';
    }
    return 'after_char';
  }
  const numeric = toFiniteNumber(value);
  if (numeric !== undefined) return numeric === 0 ? 'before_char' : 'after_char';
  return 'after_char';
}

// ─── 单条目归一化 ─────────────────────────────────────────

function normalizeWorldBookEntry(
  item: unknown,
  index: number,
  nextUid: () => number,
): WorldBookEntryDef | null {
  // 纯字符串条目：无关键词、无触发途径 → 按常驻处理（保持旧行为：始终可见）
  if (typeof item === 'string') {
    const content = item.trim();
    if (!content) return null;
    return {
      uid: nextUid(),
      key: [],
      comment: `条目 ${index + 1}`,
      content,
      constant: true,
      order: index + 1,
      position: 'after_char',
    };
  }
  if (!isPlainObject(item)) return null;

  const content = firstText(item.content, item.text, item.body, item.description, item.desc, item.内容);
  if (!content) return null;

  const uidValue = toFiniteNumber(item.uid ?? item.id ?? item.entryId);
  const key = toKeyList(item.key ?? item.keys ?? item.keywords ?? item.keyStr ?? item.keysStr ?? item.关键词);
  const keysecondary = toKeyList(
    item.keysecondary ?? item.secondary_keys ?? item.secondaryKeys ?? item.secondaryKeysStr ?? item.secondarykeys,
  );
  const exclude_key = toKeyList(
    item.exclude_key ?? item.excludeKeys ?? item.exclude_keys ?? item.excludeKeysStr ?? item.excludekeys,
  );
  const rawComment = firstText(item.comment, item.name, item.title, item.memo, item.条目名);
  const entry: WorldBookEntryDef = {
    uid: uidValue !== undefined ? uidValue : nextUid(),
    key,
    comment: rawComment && rawComment !== '空条目' ? rawComment : `条目 ${index + 1}`,
    content,
    constant: item.constant === true,
    selectiveLogic: toFiniteNumber(item.selectiveLogic ?? item.selective_logic),
    order: toFiniteNumber(item.order ?? item.insertionOrder ?? item.insertion_order) ?? index + 1,
    position: normalizePosition(item.position ?? item.insertion_position ?? item.insertionPosition),
    disable: item.disable === true || item.enabled === false,
  };

  // 可选字段：仅在存在时写入
  if (keysecondary.length > 0) entry.keysecondary = keysecondary;
  if (exclude_key.length > 0) entry.exclude_key = exclude_key;

  const depth = toFiniteNumber(item.depth);
  if (depth !== undefined) entry.depth = depth;
  const probability = toFiniteNumber(item.probability);
  if (probability !== undefined) entry.probability = probability;
  if (item.useProbability === true) entry.useProbability = true;
  const scanDepth = toFiniteNumber(item.scanDepth);
  if (scanDepth !== undefined) entry.scanDepth = scanDepth;
  if (item.caseSensitive === true) entry.caseSensitive = true;
  if (item.matchWholeWords === true) entry.matchWholeWords = true;
  if (item.excludeRecursion === true) entry.excludeRecursion = true;
  if (item.preventRecursion === true) entry.preventRecursion = true;
  if (typeof item.group === 'string' && item.group.trim()) entry.group = item.group.trim();
  if (item.useGroupScoring === true) entry.useGroupScoring = true;
  const groupWeight = toFiniteNumber(item.groupWeight);
  if (groupWeight !== undefined) entry.groupWeight = groupWeight;

  // 本应用扩展字段：保留 entryType / meta，避免原生格式往返丢失
  if (typeof item.entryType === 'string') entry.entryType = item.entryType as WorldBookEntryType;
  if (isPlainObject(item.meta)) entry.meta = item.meta as WorldBookEntryDef['meta'];

  return entry;
}

// ─── 顶层结构探测 ─────────────────────────────────────────

export interface WorldBookImportResult {
  /** 解析并归一化后的条目列表（跳过无正文的条目） */
  entries: WorldBookEntryDef[];
  /**
   * true = 本应用导出的原生格式（顶层恰好是 worldBookEntries 数组，uid 可信，
   *        可按 uid 与现有条目做替换合并）；
   * false = 外部格式（SillyTavern / 站内通用 / 角色卡），uid 不可信，
   *         调用方应重新分配 uid 避免与现有条目冲突。
   */
  native: boolean;
}

/** 从容器对象里取出条目列表（数组或对象值均可），取不到返回 null */
function extractEntryList(container: unknown): unknown[] | null {
  if (Array.isArray(container)) return container;
  if (isPlainObject(container)) {
    const values = Object.values(container);
    // 对象值必须整体像"条目集合"（值都是对象/字符串），防止误吞无关对象
    if (values.length > 0 && values.every(v => isPlainObject(v) || typeof v === 'string')) {
      return values;
    }
  }
  return null;
}

/** 角色卡内嵌世界书：data.character_book.entries / character_book.entries / book.entries */
function extractFromCharacterBook(data: Record<string, unknown>): unknown[] | null {
  const containers: Array<Record<string, unknown> | null> = [data, isPlainObject(data.data) ? data.data : null];
  for (const container of containers) {
    if (!container) continue;
    const book = container.character_book ?? container.characterBook ?? container.worldbook ?? container.worldBook;
    if (book === undefined || book === null) continue;
    if (Array.isArray(book)) return book;
    if (isPlainObject(book)) {
      const inner = book.entries ?? book.Entries ?? book.worldBookEntries;
      const list = extractEntryList(inner);
      if (list) return list;
    }
  }
  return null;
}

/** 判断对象本身是否就是一条世界书条目（有正文的兜底路径） */
function looksLikeSingleEntry(data: Record<string, unknown>): boolean {
  return Boolean(firstText(data.content, data.text, data.body, data.description));
}

/**
 * 解析任意常见格式的世界书 JSON。
 *
 * @param data JSON.parse 的结果（数组或对象）
 * @param uidBase 外部格式条目缺 uid / uid 冲突时重新分配的起始值
 */
export function parseWorldBookImport(data: unknown, uidBase = Date.now()): WorldBookImportResult {
  const makeUidFactory = () => {
    let next = Math.max(1, Math.floor(uidBase));
    return () => next++;
  };

  let rawList: unknown[] | null = null;
  let native = false;

  if (Array.isArray(data)) {
    rawList = data;
  } else if (isPlainObject(data)) {
    // 1. 原生格式：精确匹配 worldBookEntries 数组
    if (Array.isArray(data.worldBookEntries)) {
      rawList = data.worldBookEntries;
      native = true;
    } else {
      // 2. 顶层键大小写不敏感匹配（entries / ENTRIES / Entries / worldbookEntries / items...）
      for (const [key, value] of Object.entries(data)) {
        if (!TOP_LEVEL_ENTRY_KEYS.has(normalizeKeyName(key))) continue;
        const list = extractEntryList(value);
        if (list && list.length > 0) {
          rawList = list;
          break;
        }
      }
      // 3. 角色卡内嵌世界书
      if (!rawList) rawList = extractFromCharacterBook(data);
      // 4. 兜底：对象本身是一条条目
      if (!rawList && looksLikeSingleEntry(data)) rawList = [data];
    }
  }

  if (!rawList || rawList.length === 0) return { entries: [], native: false };

  const nextUid = makeUidFactory();
  const entries: WorldBookEntryDef[] = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const normalized = normalizeWorldBookEntry(rawList[i], i, nextUid);
    if (normalized) entries.push(normalized);
  }
  return { entries, native };
}

// ─── 导入合并 ─────────────────────────────────────────

export interface WorldBookMergeResult {
  merged: WorldBookEntryDef[];
  added: number;
  replaced: number;
}

/**
 * 把解析结果合并进现有条目列表。
 * - 原生格式：按 uid 替换已有条目（支持 导出→修改→再导入 的工作流）
 * - 外部格式：uid 可能与现有条目冲突（如 SillyTavern 从 0 开始编号），
 *   统一重新分配 uid，全部作为新增
 */
export function mergeWorldBookEntries(
  prev: WorldBookEntryDef[],
  parsed: WorldBookImportResult,
): WorldBookMergeResult {
  const merged = [...prev];
  if (parsed.native) {
    const indexByUid = new Map(prev.map((entry, i) => [entry.uid, i]));
    let added = 0;
    let replaced = 0;
    for (const item of parsed.entries) {
      const existingIndex = indexByUid.get(item.uid);
      if (existingIndex !== undefined) {
        merged[existingIndex] = { ...item };
        replaced += 1;
      } else {
        merged.push({ ...item });
        added += 1;
      }
    }
    return { merged, added, replaced };
  }

  let nextUid = merged.reduce((max, entry) => Math.max(max, entry.uid), 0) + 1;
  for (const item of parsed.entries) {
    merged.push({ ...item, uid: nextUid++ });
  }
  return { merged, added: parsed.entries.length, replaced: 0 };
}
