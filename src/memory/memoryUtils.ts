// ============================================================
// 记忆系统纯工具函数
// 移植自 yijiekkk/src/composables/useMemorySystem.js
// 适配 TypeScript + React 19 项目结构
// 只包含无副作用的纯函数，不依赖 store / hook
// ============================================================

import type {
  SceneAnchor,
  NarrativeMemoryRuntime,
  DebugLog,
  NarrativeEventCard,
  NarrativeEntityCard,
  NarrativeThread,
} from './types';

// ============================================================
//  玩家名 / 占位符替换
// ============================================================

/**
 * 判断给定字符串是否是可用的玩家名候选
 * 排除空字符串、纯占位符、明显不是名字的值
 */
export function isUsableMemoryPlayerNameCandidate(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 1 || trimmed.length > 30) return false;

  // 排除常见占位符
  const lower = trimmed.toLowerCase();
  const placeholders = [
    'player', 'user', 'unknown', 'unnamed', '未命名', '玩家',
    '主角', '你', 'you', 'null', 'undefined', 'none', 'n/a',
    'default', 'test', 'placeholder',
  ];
  if (placeholders.includes(lower)) return false;

  // 排除纯数字 / 纯符号
  if (/^\d+$/.test(trimmed)) return false;
  if (/^[^a-zA-Z一-鿿぀-ヿ]+$/.test(trimmed)) return false;

  return true;
}

/**
 * 从运行时快照中获取当前玩家名字
 * 返回经过验证的玩家名，若不可用则返回空字符串
 */
export function getCurrentMemoryPlayerName(
  runtime: NarrativeMemoryRuntime | null | undefined,
): string {
  // 优先从 sceneAnchor 的 presentEntities 推断
  if (!runtime?.sceneAnchor) return '';
  return ''; // 实际名字由 store 层传入
}

/**
 * 获取当前运行时的位置标签
 */
export function getCurrentMemoryRuntimeLocationLabel(
  runtime: NarrativeMemoryRuntime | null | undefined,
): string {
  if (!runtime?.sceneAnchor?.locationLabel) return '';
  return runtime.sceneAnchor.locationLabel.trim();
}

/**
 * 获取当前运行时的在场实体列表
 */
export function getCurrentMemoryRuntimePresentEntities(
  runtime: NarrativeMemoryRuntime | null | undefined,
): string[] {
  if (!runtime?.sceneAnchor?.presentEntities) return [];
  return runtime.sceneAnchor.presentEntities.filter(
    (e) => typeof e === 'string' && e.trim().length > 0,
  );
}

// ============================================================
//  叙事文本占位符 & 玩家名替换
// ============================================================

/** 通用玩家名占位符列表 */
const PLAYER_PLACEHOLDER_PATTERNS = [
  /\{\{玩家名字\}\}/g,
  /\{\{playerName\}\}/g,
  /\{\{player_name\}\}/g,
  /\{\{主角\}\}/g,
  /\{\{角色名\}\}/g,
  /\{\{charName\}\}/g,
];

/**
 * 将叙事文本中的 {{玩家名字}} 等占位符替换为实际玩家名
 */
export function replaceNarrativePlayerPlaceholders(text: string, playerName: string): string {
  if (!text || !playerName) return text;
  let result = text;
  for (const pattern of PLAYER_PLACEHOLDER_PATTERNS) {
    result = result.replace(pattern, playerName);
  }
  return result;
}

/**
 * 判断一个名字是否是叙事文本中的通用玩家名称（模糊匹配）
 */
export function isNarrativeGenericPlayerName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const lower = name.trim().toLowerCase();
  const genericNames = [
    '你', 'you', '主角', 'player', '冒险者', '旅行者',
    '年轻人', '陌生人', '来访者', '旅者', '探索者',
    'hero', 'adventurer', 'traveler', 'stranger', 'protagonist',
  ];
  return genericNames.includes(lower);
}

/**
 * 判断一个名字看起来像是叙事描述性名称（如"黑衣人"、"蒙面女子"）
 * 而非正式的角色名称
 */
export function looksLikeNarrativeDescriptorName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;

  // 含有描述性后缀词
  const descriptorSuffixes = [
    '人', '者', '女子', '男子', '少年', '少女', '老人',
    '青年', '女子', '男子', '人影', '身影', '来者',
    '客', '使', '兵', '卫', '官',
  ];

  // 含有颜色 / 形容词前缀
  const descriptorPrefixes = [
    '黑衣', '白衣', '红衣', '紫衣', '青衣', '蒙面',
    '戴面具', '戴斗笠', '穿', '身着', '手持',
  ];

  for (const suffix of descriptorSuffixes) {
    if (trimmed.endsWith(suffix) && trimmed.length <= 6) return true;
  }

  for (const prefix of descriptorPrefixes) {
    if (trimmed.startsWith(prefix)) return true;
  }

  return false;
}

/**
 * 替换叙事文本中对玩家的指代词
 * 将"你"等指代替换为实际玩家名（在特定上下文中）
 */
export function replaceNarrativePlayerReferences(text: string, playerName: string): string {
  if (!text || !playerName) return text;

  // 仅在明确的指代模式中替换，避免误替换
  let result = text;

  // 替换 "你" 为玩家名（只替换作为主语/宾语的"你"）
  // 匹配：句首的"你"、标点后的"你"、引号后的"你"
  result = result.replace(
    /(^|[。！？；\n]|[""'']|(?:，|,)\s*)(你)/gm,
    `$1${playerName}`,
  );

  return result;
}

/**
 * 归一化叙事文本中的玩家相关文本
 * 综合执行占位符替换和指代替换
 */
export function normalizeNarrativePlayerText(text: string, playerName: string): string {
  if (!text) return text;
  let result = replaceNarrativePlayerPlaceholders(text, playerName);
  if (playerName && !isNarrativeGenericPlayerName(playerName)) {
    result = replaceNarrativePlayerReferences(result, playerName);
  }
  return result;
}

/**
 * 批量归一化文本数组中的玩家相关文本
 */
export function normalizeNarrativePlayerTextArray(
  texts: string[],
  playerName: string,
): string[] {
  if (!Array.isArray(texts)) return [];
  return texts.map((t) => normalizeNarrativePlayerText(t, playerName));
}

/**
 * 通用提示词变量替换
 * 将 {{key}} 占位符替换为对应的值
 */
export function replacePromptVariables(
  template: string,
  variables: Record<string, string>,
): string {
  if (!template || !variables) return template;
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\{\\{${escaped}\\}\\}`, 'g');
    result = result.replace(pattern, value ?? '');
  }
  return result;
}

/**
 * 归一化叙事实体标签
 * 去除多余空白、引号等标记
 */
export function normalizeNarrativeEntityLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label
    .trim()
    .replace(/^[""'']+|[""'']+$/g, '') // 去除首尾引号
    .replace(/\s+/g, ' ') // 合并连续空白
    .trim();
}

// ============================================================
//  克隆 / 范围 / 引用工具
// ============================================================

/**
 * 深克隆运行时快照值
 * 使用 structuredClone（若可用），否则退化为 JSON 克隆
 */
export function cloneRuntimeSnapshotValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  // 退化方案：JSON 序列化 / 反序列化
  return JSON.parse(JSON.stringify(value));
}

/**
 * 格式化叙事存储范围
 * 例如: "[1, 150)" → "第 1 到 150 条"
 */
export function formatNarrativeStorageRange(
  startIndex: number | null | undefined,
  endIndex: number | null | undefined,
): string {
  if (startIndex == null && endIndex == null) return '未知范围';
  const s = startIndex ?? 0;
  const e = endIndex ?? '?';
  return `第 ${s + 1} 到 ${e} 条`;
}

/**
 * 归一化叙事存储引用 ID 列表
 * 去重、去空、去无效
 */
export function normalizeNarrativeStorageReferenceIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of ids) {
    const str = String(item ?? '').trim();
    if (str && str.length > 0 && !seen.has(str)) {
      seen.add(str);
      result.push(str);
    }
  }
  return result;
}

/**
 * 构建叙事存储引用文本
 * 将 ID 列表转为可读的引用格式
 */
export function buildNarrativeStorageReferenceText(
  ids: string[],
  labelMap?: Record<string, string>,
): string {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  const labels = ids.map((id) => {
    const label = labelMap?.[id];
    return label ? label : id;
  });
  return labels.join('、');
}

// ============================================================
//  Token 估算 / 调试日志
// ============================================================

/**
 * 粗略估算文本 token 数
 * 中文约 1.5 字符/token，英文约 4 字符/token
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const len = text.length;
  // 统计中文字符数
  const cjkCount = (text.match(/[一-鿿぀-ヿ＀-￯]/g) || []).length;
  const nonCjkCount = len - cjkCount;

  // CJK: ~1.5 字符/token → 每字符 ≈ 0.67 token
  // 非CJK: ~4 字符/token → 每字符 ≈ 0.25 token
  const tokens = Math.ceil(cjkCount * 0.67 + nonCjkCount * 0.25);
  return Math.max(1, tokens);
}

/**
 * 向调试日志数组追加一条日志
 * 受 maxLogs 配置限制，超出时移除最旧的
 */
export function appendNarrativeDebugLog(
  logs: DebugLog[],
  entry: DebugLog,
  maxLogs = 200,
): DebugLog[] {
  const timestampedEntry: DebugLog = {
    ...entry,
    timestamp: entry.timestamp ?? Date.now(),
  };
  const result = [...logs, timestampedEntry];
  // 限制最大数量
  while (result.length > maxLogs) {
    result.shift();
  }
  return result;
}

// ============================================================
//  格式化工具（场景锚点 / 列表）
// ============================================================

/**
 * 格式化场景锚点为可读的文本块
 */
export function formatSceneAnchorBlock(anchor: SceneAnchor | null | undefined): string {
  if (!anchor) return '（无场景信息）';

  const parts: string[] = [];

  if (anchor.timeLabel) parts.push(`时间: ${anchor.timeLabel}`);
  if (anchor.locationLabel) parts.push(`地点: ${anchor.locationLabel}`);
  if (anchor.presentEntities?.length) {
    parts.push(`在场: ${anchor.presentEntities.join('、')}`);
  }
  if (anchor.immediateGoal) parts.push(`目标: ${anchor.immediateGoal}`);
  if (anchor.immediateRisk) parts.push(`风险: ${anchor.immediateRisk}`);
  if (anchor.conversationFocus) parts.push(`焦点: ${anchor.conversationFocus}`);
  if (anchor.recentChange) parts.push(`变化: ${anchor.recentChange}`);
  if (anchor.confidence != null) {
    parts.push(`置信度: ${(anchor.confidence * 100).toFixed(0)}%`);
  }

  return parts.length > 0 ? parts.join('\n') : '（场景信息为空）';
}

/**
 * 格式化字符串列表为带标记的文本段
 */
export function formatListSection(
  title: string,
  items: string[],
  bullet = '- ',
): string {
  if (!items || items.length === 0) return '';
  const lines = items.map((item) => `${bullet}${item}`);
  return `【${title}】\n${lines.join('\n')}`;
}

// ============================================================
//  叙事文本归一化 / 搜索
// ============================================================

/**
 * 归一化叙事文本
 * 统一空白字符、去除控制字符、trim
 */
export function normalizeNarrativeText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[ --]/g, '') // 去控制字符
    .replace(/\r\n?/g, '\n') // 统一换行
    .replace(/[ \t]+/g, ' ') // 合并空格
    .replace(/\n{3,}/g, '\n\n') // 限制连续空行
    .trim();
}

/**
 * 归一化用于搜索的文本
 * 去除标点、统一大小写、去除多余空白
 */
export function normalizeNarrativeSearchText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[　-〿＀-￯]/g, (ch) => {
      // 全角转半角（标点部分）
      const code = ch.charCodeAt(0);
      if (code >= 0xff01 && code <= 0xff5e) {
        return String.fromCharCode(code - 0xfee0);
      }
      return ' ';
    })
    .replace(/[^\w一-鿿぀-ゟ゠-ヿ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 构建叙事记忆的稳定 ID
 * 基于内容生成确定性的标识符
 */
export function buildNarrativeStableId(prefix: string, ...parts: string[]): string {
  const joined = parts.filter(Boolean).join('::');
  if (!joined) return `${prefix}_${Date.now()}`;

  // 简单哈希：将字符串转为数字指纹
  let hash = 0;
  for (let i = 0; i < joined.length; i++) {
    const ch = joined.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  const hashStr = Math.abs(hash).toString(36);
  return `${prefix}_${hashStr}`;
}

/**
 * 合并两个字符串数组，去重保持顺序
 */
export function mergeStringArrays(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of [...(a || []), ...(b || [])]) {
    const trimmed = String(item).trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * 数值钳制
 */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * 解析叙事来源范围
 */
export function resolveNarrativeSourceRange(
  items: Array<{ sourceStartIndex?: number | null; sourceEndIndex?: number | null }>,
): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;

  for (const item of items) {
    if (item.sourceStartIndex != null && item.sourceStartIndex < start) {
      start = item.sourceStartIndex;
    }
    if (item.sourceEndIndex != null && item.sourceEndIndex > end) {
      end = item.sourceEndIndex;
    }
  }

  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = start;

  return { start, end };
}

// ============================================================
//  场景补丁规则块
// ============================================================

/**
 * 构建叙事写入场景补丁的规则文本块
 * 用于注入到提示词中，告诉 LLM 如何输出 scenePatch
 */
export function buildNarrativeIngestScenePatchRulesBlock(): string {
  return [
    '■ scenePatch 规则',
    '1. 只填写本批剧情中明确变化的字段；没有变化的留空。',
    '2. timeLabel / locationLabel：仅在时间或地点确实发生变化时填写。',
    '3. presentEntities：列出当前场景中明确出场的实体全名。',
    '4. immediateGoal / immediateRisk / conversationFocus / recentChange：',
    '   始终输出，即使只是确认"无变化"也要显式写出。',
    '5. confidence：0-1 的浮点数，反映你对当前场景判断的整体置信度。',
  ].join('\n');
}

/**
 * 比较两个字符串数组是否等价（忽略顺序和重复）
 */
export function areNarrativeStringArraysEquivalent(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) {
    // 长度不同也可能等价（有重复元素），用 Set 比较
    const setA = new Set(a.map((s) => s.trim().toLowerCase()));
    const setB = new Set(b.map((s) => s.trim().toLowerCase()));
    if (setA.size !== setB.size) return false;
    for (const item of setA) {
      if (!setB.has(item)) return false;
    }
    return true;
  }

  // 长度相同时快速比较
  const setA = new Set(a.map((s) => s.trim().toLowerCase()));
  const setB = new Set(b.map((s) => s.trim().toLowerCase()));
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

// ============================================================
//  安全类型守卫
// ============================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// ============================================================
//  运行时快照归一化工具
// ============================================================

/**
 * 安全地从任意值中提取字符串数组
 */
export function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? '').trim())
    .filter((s) => s.length > 0);
}

/**
 * 安全地从任意值中提取数字，带默认值
 */
export function safeNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * 安全地从任意值中提取字符串，带默认值
 */
export function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

// ============================================================
//  运行时数据排序 / 过滤工具
// ============================================================

/** 可排序卡片的通用接口 */
interface SortableCard {
  importance?: number;
  priority?: number;
  createdAt?: number;
  updatedAt?: number;
  status?: string;
}

/**
 * 按优先级和重要性排序卡片
 * status 为 active/open 的排在前面
 */
export function sortCardsByPriority<T extends SortableCard>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    // active 类状态优先
    const aActive = isActiveLikeStatus(a.status);
    const bActive = isActiveLikeStatus(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;

    // 然后按 priority / importance 降序
    const aPriority = a.priority ?? a.importance ?? 0;
    const bPriority = b.priority ?? b.importance ?? 0;
    if (aPriority !== bPriority) return bPriority - aPriority;

    // 最后按更新时间降序
    const aTime = a.updatedAt ?? a.createdAt ?? 0;
    const bTime = b.updatedAt ?? b.createdAt ?? 0;
    return bTime - aTime;
  });
}

function isActiveLikeStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'active' || s === 'hot' || s === 'open';
}

/**
 * 按状态过滤实体卡片
 */
export function filterEntityCardsByStatus(
  cards: NarrativeEntityCard[],
  statuses: string[],
): NarrativeEntityCard[] {
  if (!statuses.length) return cards;
  const statusSet = new Set(statuses.map((s) => s.toLowerCase()));
  return cards.filter((card) => {
    return card.currentStatus?.some((s) => statusSet.has(s.toLowerCase()));
  });
}

/**
 * 按实体引用过滤事件卡片
 */
export function filterEventCardsByEntityRef(
  cards: NarrativeEventCard[],
  entityName: string,
): NarrativeEventCard[] {
  if (!entityName) return cards;
  const lower = entityName.toLowerCase();
  return cards.filter((card) =>
    card.entityRefs?.some((ref) => ref.toLowerCase() === lower),
  );
}

/**
 * 按实体引用过滤线程
 */
export function filterThreadsByEntity(
  threads: NarrativeThread[],
  entityName: string,
): NarrativeThread[] {
  if (!entityName) return threads;
  const lower = entityName.toLowerCase();
  return threads.filter((t) =>
    t.relatedEntities?.some((e) => e.toLowerCase() === lower),
  );
}

// ============================================================
//  ID 生成
// ============================================================

let _idCounter = 0;

/**
 * 生成唯一 ID（带前缀）
 * 格式: prefix_timestamp_counter_random
 */
export function generateMemoryId(prefix: string): string {
  _idCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}_${_idCounter}_${rand}`;
}
