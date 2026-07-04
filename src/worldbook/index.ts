// ═══════════════════════════════════════════════════════════════
//  世界书管理器 v2 — 支持 SillyTavern 级别的扫描引擎
// ═══════════════════════════════════════════════════════════════

import {
  scanWorldInfo,
  compareWorldInfoEntriesBySendOrder,
  world_info_position,
  type WorldInfoEntry,
  type WorldInfoScanOptions,
} from './worldInfoEngine';
import {
  shouldSuppressCharacterWorldBookEntry,
} from './npcWorldbook';

// ─── 公共转换：WorldBookEntryDef → WorldBookEntry ─────────────────

import type { WorldBookEntryDef } from '../data/worlds-schema';

// ─── 条目类型 ─────────────────────────

export interface WorldBookEntry {
  id: number;
  comment: string;
  content: string;
  constant: boolean;
  enabled: boolean;
  selective: boolean;
  keys: string[];
  secondaryKeys: string[];
  position: 'before_char' | 'after_char';
  insertionOrder: number;

  // ── v2 新增字段 ──
  /** 唯一标识（回退到 id） */
  uid?: string;
  /** 排除关键词 */
  excludeKeys?: string[];
  /** 选择逻辑: 0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL */
  selectiveLogic?: number;
  /** 扫描深度（只扫最近 N 条消息） */
  scanDepth?: number;
  /** 大小写敏感 */
  caseSensitive?: boolean;
  /** 全词匹配 */
  matchWholeWords?: boolean;
  /** 概率触发 0~100 */
  probability?: number;
  /** 是否启用概率 */
  useProbability?: boolean;
  /** 排除递归（不参与链式触发） */
  excludeRecursion?: boolean;
  /** 阻止递归（激活后终止下一轮扫描） */
  preventRecursion?: boolean;
  /** 分组名（同组互斥） */
  group?: string;
  /** 使用分组评分 */
  useGroupScoring?: boolean;
  /** 分组权重 */
  groupWeight?: number;
  /** 排序权重 */
  order?: number;
  /** atDepth 的深度值 */
  depth?: number;
  /** 条目分类 (来自 WorldBookEntryDef) */
  entryType?: string;
  /** 结构化元数据 (来自 WorldBookEntryDef) */
  meta?: Record<string, unknown>;
}

// ─── 扫描注入结果 ─────────────────────────────────────

export interface ScanInjectionResult {
  /** Before Char Def 区块 */
  beforeChar: string;
  /** After Char Def 区块 */
  afterChar: string;
  /** At Depth 条目列表（按 depth 排序） */
  atDepthEntries: Array<{ depth: number; content: string }>;
  /** 所有激活的条目（按发送顺序） */
  activatedEntries: WorldBookEntry[];
}

/**
 * 将 WorldBookEntryDef[] 转换为 WorldBookEntry[]
 * ⚠️ 这是唯一合法的转换点，engine 注入和编辑器保存都必须通过这个函数
 * 所有字段映射集中管理，新增字段只改这里
 */
export function convertWorldBookDefsToEntries(defs: WorldBookEntryDef[]): WorldBookEntry[] {
  return defs.map((e, idx) => ({
    id: -(idx + 1),
    comment: e.comment,
    content: e.content,
    constant: e.constant,
    enabled: !e.disable,
    selective: (e.key?.length ?? 0) > 0,
    keys: e.key ?? [],
    secondaryKeys: e.keysecondary ?? [],
    excludeKeys: e.exclude_key ?? [],
    position: (e.position ?? 'after_char') as 'before_char' | 'after_char',
    insertionOrder: e.order ?? 0,
    order: e.order,
    depth: e.depth,
    probability: e.probability,
    useProbability: e.useProbability,
    excludeRecursion: e.excludeRecursion,
    preventRecursion: e.preventRecursion,
    group: e.group,
    useGroupScoring: e.useGroupScoring,
    groupWeight: e.groupWeight,
    selectiveLogic: e.selectiveLogic,
    scanDepth: e.scanDepth,
    caseSensitive: e.caseSensitive,
    matchWholeWords: e.matchWholeWords,
    entryType: e.entryType,
    meta: e.meta as Record<string, unknown> | undefined,
  }));
}

// ─── WorldBookManager 接口 ─────────────────────────────

export interface WorldBookManager {
  entries: WorldBookEntry[];
  getConstantEntries(): WorldBookEntry[];
  getActiveEntries(userInput: string): WorldBookEntry[];
  getEnabledEntries(): WorldBookEntry[];
  toggleEntry(id: number): void;
  enableEntry(id: number): void;
  disableEntry(id: number): void;
  enableEntriesByPrefix(prefix: string): void;
  disableEntriesByPrefix(prefix: string): void;
  enableOnlyEntry(prefix: string, targetId: number): void;
  getEntriesByPrefix(prefix: string): WorldBookEntry[];
  addEntries(newEntries: WorldBookEntry[]): void;
  /** 返回当前所有条目（实时快照，非初始数组） */
  getAllEntries(): WorldBookEntry[];
  /** 替换所有 non‑constant 条目，保留 constant 条目不变（游戏内编辑用） */
  replaceNonConstantEntries(newEntries: WorldBookEntry[]): void;
  /** 清除所有世界专属条目（负 ID），保留 card.json 通用条目（正 ID） */
  clearWorldEntries(): void;

  /**
   * v2 扫描注入（使用 SillyTavern 级别的扫描引擎）
   * 支持：正则关键词、选择逻辑、排除关键词、递归扫描、分组互斥、概率触发
   */
  scanAndBuildInjection(
    chatHistory: Array<{ role?: string; content?: string }>,
    userText: string,
    options?: WorldInfoScanOptions,
  ): ScanInjectionResult;
}

// ─── 解析 ─────────────────────────────────────────

export function parseWorldBook(cardData: any): WorldBookEntry[] {
  const book = cardData?.data?.character_book;
  if (!book?.entries) return [];

  return book.entries.map((entry: any) => ({
    id: entry.id,
    comment: entry.comment || '',
    content: entry.content || '',
    constant: entry.constant ?? false,
    enabled: entry.enabled ?? true,
    selective: entry.selective ?? false,
    keys: entry.keys || [],
    secondaryKeys: entry.secondary_keys || [],
    position: (entry.position || 'after_char') as 'before_char' | 'after_char',
    insertionOrder: entry.insertion_order ?? 0,
    // v2 新增
    uid: entry.uid,
    excludeKeys: entry.exclude_key || entry.excludeKeys || [],
    selectiveLogic: entry.selectiveLogic,
    scanDepth: entry.scanDepth,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    probability: entry.probability,
    useProbability: entry.useProbability,
    excludeRecursion: entry.excludeRecursion,
    preventRecursion: entry.preventRecursion,
    group: entry.group,
    useGroupScoring: entry.useGroupScoring,
    groupWeight: entry.groupWeight,
    order: entry.order,
    depth: entry.depth,
  }));
}

// ─── WorldBookEntry → WorldInfoEntry 转换 ─────────────────

function toWorldInfoEntry(entry: WorldBookEntry): WorldInfoEntry {
  return {
    id: entry.id,
    uid: entry.uid ?? String(entry.id),
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    enabled: entry.enabled,
    selective: entry.selective,
    keys: entry.keys,
    key: entry.keys, // 别名
    keysecondary: entry.secondaryKeys,
    secondary_keys: entry.secondaryKeys,
    exclude_key: entry.excludeKeys ?? [],
    selectiveLogic: entry.selectiveLogic,
    scanDepth: entry.scanDepth,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    probability: entry.probability,
    useProbability: entry.useProbability,
    excludeRecursion: entry.excludeRecursion,
    preventRecursion: entry.preventRecursion,
    group: entry.group,
    useGroupScoring: entry.useGroupScoring,
    groupWeight: entry.groupWeight,
    order: entry.order ?? entry.insertionOrder,
    depth: entry.depth,
    // position 映射: 'before_char' → 0, 'after_char' → 1
    position: entry.position === 'before_char' ? 0 : 1,
  };
}

// ─── 创建管理器 ─────────────────────────────────────────

export function createWorldBookManager(initialEntries: WorldBookEntry[]): WorldBookManager {
  let entries = [...initialEntries];

  return {
    entries,

    getConstantEntries() {
      return entries
        .filter(e => e.constant && e.enabled)
        .sort((a, b) => a.insertionOrder - b.insertionOrder);
    },

    getActiveEntries(userInput: string) {
      const lowerInput = userInput.toLowerCase();
      return entries
        .filter(e => {
          if (!e.enabled) return false;
          if (e.constant) return false;
          if (e.selective) {
            const allKeys = [...e.keys, ...e.secondaryKeys];
            if (allKeys.length === 0) return false;
            return allKeys.some(key => lowerInput.includes(key.toLowerCase()));
          }
          return true;
        })
        .sort((a, b) => a.insertionOrder - b.insertionOrder);
    },

    getEnabledEntries() {
      return entries.filter(e => e.enabled);
    },

    toggleEntry(id: number) {
      entries = entries.map(e =>
        e.id === id ? { ...e, enabled: !e.enabled } : e
      );
    },

    enableEntry(id: number) {
      entries = entries.map(e => e.id === id ? { ...e, enabled: true } : e);
    },

    disableEntry(id: number) {
      entries = entries.map(e => e.id === id ? { ...e, enabled: false } : e);
    },

    enableEntriesByPrefix(prefix: string) {
      entries = entries.map(e =>
        e.comment.includes(prefix) ? { ...e, enabled: true } : e
      );
    },

    disableEntriesByPrefix(prefix: string) {
      entries = entries.map(e =>
        e.comment.includes(prefix) ? { ...e, enabled: false } : e
      );
    },

    enableOnlyEntry(prefix: string, targetId: number) {
      entries = entries.map(e => {
        if (!e.comment.includes(prefix)) return e;
        return { ...e, enabled: e.id === targetId };
      });
    },

    getEntriesByPrefix(prefix: string) {
      return entries.filter(e => e.comment.includes(prefix));
    },

    addEntries(newEntries: WorldBookEntry[]) {
      const minId = entries.length > 0 ? Math.min(...entries.map(e => e.id)) : 0;
      let nextId = Math.min(minId, 0) - 1;
      const existingIds = new Set(entries.map(e => e.id));
      const toAdd = newEntries
        .map(e => ({
          ...e,
          id: e.id < 0 ? e.id : nextId--,
        }))
        .filter(e => !existingIds.has(e.id)); // 去重：相同 ID 不重复添加
      entries = [...entries, ...toAdd];
    },

    getAllEntries(): WorldBookEntry[] {
      return [...entries];
    },

    replaceNonConstantEntries(newEntries: WorldBookEntry[]): void {
      const constantOnes = entries.filter(e => e.constant);
      entries = [...constantOnes, ...newEntries];
    },

    clearWorldEntries(): void {
      // 保留 card.json 通用条目（正 ID），清除世界专属条目（负 ID）
      entries = entries.filter(e => e.id >= 0);
    },

    // ── v2 扫描注入 ──
    scanAndBuildInjection(
      chatHistory: Array<{ role?: string; content?: string }>,
      userText: string,
      options: WorldInfoScanOptions = {},
    ): ScanInjectionResult {
      // 将 WorldBookEntry 转换为 WorldInfoEntry
      const infoEntries = entries
        .filter(e => e.enabled)
        .map(toWorldInfoEntry);

      // 注入 NPC 去重回调（如果用户没提供的话）
      const mergedOptions: WorldInfoScanOptions = {
        ...options,
        suppressCharacterEntry: options.suppressCharacterEntry
          ?? shouldSuppressCharacterWorldBookEntry,
      };

      // 执行扫描
      const activated = scanWorldInfo(
        chatHistory,
        { entries: infoEntries },
        userText,
        mergedOptions,
      );

      // 按 position 分组
      const beforeParts: string[] = [];
      const afterParts: string[] = [];
      const atDepthEntries: Array<{ depth: number; content: string }> = [];

      for (const entry of activated) {
        const pos = entry.position ?? 1;
        if (pos === world_info_position.before) {
          beforeParts.push(entry.content);
        } else if (pos === world_info_position.atDepth) {
          atDepthEntries.push({
            depth: Number(entry.depth) || 4,
            content: entry.content,
          });
        } else {
          afterParts.push(entry.content);
        }
      }

      // atDepth 按 depth 排序（浅的先插入）
      atDepthEntries.sort((a, b) => a.depth - b.depth);

      return {
        beforeChar: beforeParts.join('\n\n'),
        afterChar: afterParts.join('\n\n'),
        atDepthEntries,
        activatedEntries: activated as unknown as WorldBookEntry[],
      };
    },
  };
}
