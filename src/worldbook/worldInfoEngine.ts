// ═══════════════════════════════════════════════════════════════
//  世界书扫描引擎
//  对齐 SillyTavern (public/scripts/world-info.js) 的核心行为
// ═══════════════════════════════════════════════════════════════

/** 选择逻辑枚举 */
export const world_info_logic = {
  AND_ANY: 0,   // 次级关键词命中任意一个
  NOT_ALL: 1,   // 次级关键词不能全部命中
  NOT_ANY: 2,   // 次级关键词不能命中任意一个
  AND_ALL: 3,   // 次级关键词必须全部命中
} as const;

/** 插入位置枚举 */
export const world_info_position = {
  before: 0,    // Before Char Def
  after: 1,     // After Char Def
  ANTop: 2,     // Author's Note Top
  ANBottom: 3,  // Author's Note Bottom
  atDepth: 4,   // At Depth
  EMTop: 5,     // EM Top
  EMBottom: 6,  // EM Bottom
} as const;

const WI_DEFAULT_SCAN_DEPTH = 4;
const WI_MAX_RECURSION_STEPS = 10;

// ─── 工具函数 ─────────────────────────────────────────

function toFiniteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getSendPositionRank(entry: WorldInfoEntry): number {
  const position = toFiniteNumber(entry?.position ?? entry?.insertion_position, world_info_position.before);
  if (position === world_info_position.before) return 0;
  if (position === world_info_position.atDepth) return 2;
  return 1;
}

/**
 * 按发送顺序排序世界书条目。
 * Before Char 先发，非 depth 的 After 次之，At Depth 插入聊天历史内。
 */
export function compareWorldInfoEntriesBySendOrder(a: WorldInfoEntry, b: WorldInfoEntry): number {
  const rankA = getSendPositionRank(a);
  const rankB = getSendPositionRank(b);
  const rankDiff = rankA - rankB;
  if (rankDiff !== 0) return rankDiff;

  if (rankA === 2) {
    const depthDiff = toFiniteNumber(a?.depth, 4) - toFiniteNumber(b?.depth, 4);
    if (depthDiff !== 0) return depthDiff;
  }

  const orderDiff = toFiniteNumber(a?.order, 100) - toFiniteNumber(b?.order, 100);
  if (orderDiff !== 0) return orderDiff;

  const nameA = String(a?.comment || a?.name || a?.uid || a?.id || '');
  const nameB = String(b?.comment || b?.name || b?.uid || b?.id || '');
  return nameA.localeCompare(nameB, 'zh-Hans');
}

function escapeRegex(s: string): string {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 世界书条目类型 ─────────────────────────────────────

/** 世界书条目（兼容 SillyTavern 字段） */
export interface WorldInfoEntry {
  id?: number;
  uid?: string;
  name?: string;
  comment?: string;
  content: string;

  // 启用/禁用
  enabled?: boolean;
  disable?: boolean;
  constant?: boolean;
  selective?: boolean;

  // 关键词（多别名兼容）
  key?: string[];
  keys?: string[];
  keywords?: string[];
  keysStr?: string;
  keysecondary?: string[];
  secondary_keys?: string[];
  secondaryKeys?: string[];
  secondaryKeysStr?: string;
  exclude_key?: string[];
  excludeKeys?: string[];
  exclude_keys?: string[];
  excludeKeysStr?: string;

  // 选择逻辑
  selectiveLogic?: number;

  // 匹配选项
  scanDepth?: number;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;

  // 概率
  probability?: number;
  useProbability?: boolean;

  // 递归控制
  excludeRecursion?: boolean;
  preventRecursion?: boolean;

  // 分组互斥
  group?: string;
  useGroupScoring?: boolean;
  groupWeight?: number;

  // 插入位置
  position?: number;
  insertion_position?: number;
  order?: number;
  depth?: number;
  insertionOrder?: number;
}

/** 聊天消息（扫描用） */
interface ScanMessage {
  role?: string;
  content?: string;
}

/** 世界书包 */
interface WorldInfoPack {
  entries: WorldInfoEntry[];
  settings?: Record<string, unknown>;
}

/** 运行时选项 */
export interface WorldInfoScanOptions {
  surroundingNpcNames?: string[];
  scanDepth?: number;
  maxRecursion?: number;
  /** NPC 世界书去重回调（可选注入，避免硬依赖 npcWorldbook） */
  suppressCharacterEntry?: (entry: WorldInfoEntry, surroundingNpcNames: string[]) => boolean;
}

// ─── 关键词读取 ─────────────────────────────────────────

/** 把 entry 上的关键词字段（兼容多别名）规整成数组。 */
export function readEntryKeyList(entry: WorldInfoEntry, primaryKey = 'key'): string[] {
  if (!entry) return [];
  const aliasMap: Record<string, string[]> = {
    key: ['key', 'keys', 'keywords', 'keysStr'],
    keysecondary: ['keysecondary', 'secondary_keys', 'secondaryKeys', 'secondaryKeysStr'],
    exclude_key: ['exclude_key', 'excludeKeys', 'exclude_keys', 'excludeKeysStr'],
  };
  const aliases = aliasMap[primaryKey] || [primaryKey];
  for (const name of aliases) {
    const value = (entry as unknown as Record<string, unknown>)[name];
    if (Array.isArray(value)) {
      const arr = value.map((v) => String(v ?? '').trim()).filter(Boolean);
      if (arr.length > 0) return arr;
    } else if (typeof value === 'string' && value.trim()) {
      const arr = value
        .split(/\r?\n|[,，|｜]/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (arr.length > 0) return arr;
    }
  }
  return [];
}

// ─── 关键词匹配 ─────────────────────────────────────────

/**
 * 单条关键词匹配。
 *  - 正则：/pattern/flags
 *  - 全词匹配（matchWholeWords）：ASCII 词字符两侧才算"词内"，对中文兼容
 *  - 大小写敏感（caseSensitive）：默认 false
 */
export function matchWorldInfoKey(text: string, key: string, entry: WorldInfoEntry): boolean {
  if (!key) return false;
  const rawKey = String(key);

  // 正则关键词
  const regexMatch = rawKey.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    try {
      const regex = new RegExp(regexMatch[1], regexMatch[2]);
      return regex.test(text || '');
    } catch {
      console.warn('[WorldInfo] 无法解析正则关键词:', rawKey);
      return false;
    }
  }

  let haystack = text || '';
  let needle = rawKey.trim();
  if (!needle) return false;

  if (!entry?.caseSensitive) {
    haystack = haystack.toLowerCase();
    needle = needle.toLowerCase();
  }

  if (entry?.matchWholeWords) {
    try {
      const escaped = escapeRegex(needle);
      const regex = new RegExp(
        `(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`,
        entry?.caseSensitive ? '' : 'i'
      );
      return regex.test(text || '');
    } catch {
      return haystack.includes(needle);
    }
  }

  return haystack.includes(needle);
}

// ─── 扫描器 ─────────────────────────────────────────

/**
 * 单轮扫描器内部状态。
 * chatHistory[0] 是最早的消息；this.history[0] 是最新的（倒序方便 slice 取最近 N 条）。
 */
class WIScanner {
  history: ScanMessage[];
  activatedUids: Set<string>;
  recurseBuffer: string[];

  constructor(chatHistory: ScanMessage[]) {
    this.history = Array.isArray(chatHistory) ? [...chatHistory].reverse() : [];
    this.activatedUids = new Set();
    this.recurseBuffer = [];
  }

  /** 取最近 depth 条聊天的合并文本 + 递归缓冲 + globalScanData。 */
  buildScanText(depth: number, globalScanData = ''): string {
    const safeDepth = Math.max(0, Number(depth) || 0);
    const slice = safeDepth > 0 ? this.history.slice(0, safeDepth) : this.history;
    const parts = slice.map((m) => (m && typeof m.content === 'string' ? m.content : ''));
    if (this.recurseBuffer.length > 0) parts.push(...this.recurseBuffer);
    if (globalScanData) parts.push(String(globalScanData));
    return parts.join('\n');
  }

  /** 取条目专属扫描文本：优先用 entry.scanDepth，否则用全局深度。 */
  buildScanTextForEntry(entry: WorldInfoEntry, defaultDepth: number, globalScanData: string): string {
    const entryDepth = entry?.scanDepth;
    const depth = entryDepth !== null && entryDepth !== undefined
      ? Math.max(0, Number(entryDepth) || 0)
      : defaultDepth;
    return this.buildScanText(depth, globalScanData);
  }

  /** 检查单个条目是否应当激活。 */
  checkEntry(entry: WorldInfoEntry, scanText: string): boolean {
    // 1. 排除关键词：命中即否决
    const excludeKeys = readEntryKeyList(entry, 'exclude_key');
    for (const k of excludeKeys) {
      if (matchWorldInfoKey(scanText, k, entry)) return false;
    }

    // 2. 主关键词
    const primaryKeys = readEntryKeyList(entry, 'key');
    let primaryMatched = false;

    if (primaryKeys.length === 0) {
      // 没有主关键词：直接视为常驻模式
      primaryMatched = true;
    } else {
      // 关键有主关键词时，一律走"关键词模式"匹配，
      // 即使 constant=true 也强制要求扫描文本里命中关键词。
      for (const k of primaryKeys) {
        if (matchWorldInfoKey(scanText, k, entry)) {
          primaryMatched = true;
          break;
        }
      }
      if (!primaryMatched) return false;
    }

    // 3. 次级关键词 + selectiveLogic
    if (entry.selective === true) {
      const secondary = readEntryKeyList(entry, 'keysecondary');
      if (secondary.length > 0) {
        const logic = Number.isFinite(entry.selectiveLogic) ? entry.selectiveLogic! : world_info_logic.AND_ANY;
        let matchCount = 0;
        for (const k of secondary) {
          if (matchWorldInfoKey(scanText, k, entry)) matchCount += 1;
        }
        const hasAny = matchCount > 0;
        const hasAll = matchCount === secondary.length;
        switch (logic) {
          case world_info_logic.AND_ANY:
            if (!hasAny) return false;
            break;
          case world_info_logic.AND_ALL:
            if (!hasAll) return false;
            break;
          case world_info_logic.NOT_ALL:
            if (hasAll) return false;
            break;
          case world_info_logic.NOT_ANY:
            if (hasAny) return false;
            break;
          default:
            if (!hasAny) return false;
        }
      }
    }

    // 4. 概率（仅当 useProbability 显式为 true 时才启用概率门控）
    if (entry.useProbability === true) {
      const prob = Number.isFinite(entry.probability) ? entry.probability! : 100;
      if (prob < 100 && Math.random() * 100 > prob) return false;
    }

    return true;
  }
}

// ─── 分组互斥 ─────────────────────────────────────────

function getEntryUid(entry: WorldInfoEntry, fallbackIndex: number): string {
  return String(entry?.uid || entry?.id || `__idx_${fallbackIndex}`);
}

/**
 * 在一组激活条目中按分组互斥规则做剔除：同一 group 内只保留 1 条。
 *  - 如果有任意条目设置了 useGroupScoring=true，则按 groupWeight*Math.random() 加权抽签
 *  - 否则取 order 最大的那条
 */
function resolveGroupExclusions(entries: WorldInfoEntry[]): WorldInfoEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const grouped = new Map<string, WorldInfoEntry[]>();
  const ungrouped: WorldInfoEntry[] = [];
  for (const entry of entries) {
    const groupName = String(entry?.group || '').trim();
    if (!groupName) {
      ungrouped.push(entry);
      continue;
    }
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName)!.push(entry);
  }

  const winners: WorldInfoEntry[] = [];
  for (const [, members] of grouped) {
    if (members.length === 1) {
      winners.push(members[0]);
      continue;
    }
    const useScoring = members.some((m) => m?.useGroupScoring === true);
    if (useScoring) {
      let bestScore = -Infinity;
      let chosen = members[0];
      for (const m of members) {
        const w = Number.isFinite(m?.groupWeight) ? Math.max(0, m.groupWeight!) : 100;
        const score = w * Math.random();
        if (score > bestScore) {
          bestScore = score;
          chosen = m;
        }
      }
      winners.push(chosen);
    } else {
      const sorted = [...members].sort((a, b) => (Number(b?.order) || 0) - (Number(a?.order) || 0));
      winners.push(sorted[0]);
    }
  }

  return [...ungrouped, ...winners];
}

// ─── 主扫描入口 ─────────────────────────────────────────

/**
 * 主扫描入口。
 *
 * @param chatHistory 完整聊天历史（按时间正序）
 * @param worldInfoPack 世界书包
 * @param globalScanData 额外扫描文本（一般是当前用户输入）
 * @param runtimeOptions 运行期选项
 * @returns 已激活的条目列表（按发送顺序排列）
 */
export function scanWorldInfo(
  chatHistory: ScanMessage[],
  worldInfoPack: WorldInfoPack,
  globalScanData = '',
  runtimeOptions: WorldInfoScanOptions = {},
): WorldInfoEntry[] {
  const entries = Array.isArray(worldInfoPack?.entries) ? worldInfoPack.entries : [];
  if (entries.length === 0) return [];

  const safeRuntime = runtimeOptions && typeof runtimeOptions === 'object' && !Array.isArray(runtimeOptions)
    ? runtimeOptions
    : {};
  const surroundingNpcNames = Array.isArray(safeRuntime.surroundingNpcNames)
    ? safeRuntime.surroundingNpcNames
    : [];
  const defaultScanDepth = Number.isFinite(Number(safeRuntime.scanDepth))
    ? Math.max(0, Number(safeRuntime.scanDepth))
    : WI_DEFAULT_SCAN_DEPTH;
  const maxRecursion = Number.isFinite(Number(safeRuntime.maxRecursion))
    ? Math.max(1, Number(safeRuntime.maxRecursion))
    : WI_MAX_RECURSION_STEPS;

  const scanner = new WIScanner(chatHistory);
  const allActivated: WorldInfoEntry[] = [];
  let pass = 0;
  let hasNew = true;

  while (hasNew && pass < maxRecursion) {
    pass += 1;
    hasNew = false;
    const passActivated: WorldInfoEntry[] = [];

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      // 启用状态
      if (entry.disable === true || entry.enabled === false) continue;
      // 已激活
      const uid = getEntryUid(entry, i);
      if (scanner.activatedUids.has(uid)) continue;
      // 第二轮起跳过 excludeRecursion 条目
      if (pass > 1 && entry.excludeRecursion === true) continue;
      // 人物书自动抑制（不在场角色不注入其专属条目）
      if (safeRuntime.suppressCharacterEntry && safeRuntime.suppressCharacterEntry(entry, surroundingNpcNames)) continue;

      const scanText = scanner.buildScanTextForEntry(entry, defaultScanDepth, globalScanData);
      if (!scanner.checkEntry(entry, scanText)) continue;

      passActivated.push(entry);
    }

    if (passActivated.length === 0) break;

    // 分组互斥
    const winners = resolveGroupExclusions(passActivated);
    let shouldPreventRecursion = false;

    for (const entry of winners) {
      const uid = getEntryUid(entry, entries.indexOf(entry));
      if (scanner.activatedUids.has(uid)) continue;
      scanner.activatedUids.add(uid);
      allActivated.push(entry);

      // 递归注入：把内容加入下一轮扫描文本
      if (entry.excludeRecursion !== true) {
        if (typeof entry.content === 'string' && entry.content.trim()) {
          scanner.recurseBuffer.push(entry.content);
        }
      }

      // 处理递归控制逻辑
      if (entry.preventRecursion === true) {
        shouldPreventRecursion = true;
      } else if (entry.excludeRecursion !== true) {
        hasNew = true;
      }
    }

    // 如果当前轮有条目阻止递归，立即终止下一轮的触发
    if (shouldPreventRecursion) {
      hasNew = false;
    }
  }

  // 按发送顺序排序
  allActivated.sort(compareWorldInfoEntriesBySendOrder);
  return allActivated;
}
