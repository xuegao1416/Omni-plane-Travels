// ============================================================
// 动态选项生成器 — 根据游戏状态 + 配置指令，调用 AI 生成选择卡选项
//
// 设计原则：
//   1. 不阻塞引擎 tick（卡片弹出时按需调用）
//   2. 轻量 prompt（只传状态摘要，不传全量 GameState）
//   3. 结构化输出 + 严格校验
//   4. 3 秒超时降级到 fallbackChoices
//   5. LRU 缓存（同一配置 + 同一状态哈希 → 缓存命中，60秒过期）
// ============================================================

import type { ChoiceOption, DynamicChoiceConfig, DynamicChoicePromptInput } from './schema';
import type { GameState } from '../schema/variables';
import { requestCompletion } from '../api/client';
import type { ApiConfig, Message } from '../api/types';
import { getRecentDecisionNotes } from './playerDecisionLog';

// ─── 常量 ───

const CACHE_MAX = 32;
const CACHE_TTL_MS = 60_000; // 60秒过期
const TIMEOUT_MS = 3_000;    // 3秒超时
const MAX_TOKENS = 400;

// ─── LRU 缓存 ───

const cache = new Map<string, { choices: ChoiceOption[]; ts: number }>();

function buildCacheKey(instruction: string, stats: Record<string, number>, resources: Record<string, number>): string {
  // 只用 instruction + 数值状态做 key（数值变化 → 重新生成）
  const statsStr = Object.entries(stats).sort().map(([k, v]) => `${k}:${v}`).join(',');
  const resStr = Object.entries(resources).sort().map(([k, v]) => `${k}:${v}`).join(',');
  return `${instruction}::${statsStr}::${resStr}`;
}

function getCached(key: string): ChoiceOption[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.choices;
}

function setCache(key: string, choices: ChoiceOption[]): void {
  // LRU 淘汰：删除最老的条目
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { choices, ts: Date.now() });
}

/** 清空缓存（测试 / 新存档隔离用） */
export function clearDynamicChoiceCache(): void {
  cache.clear();
}

// ─── Prompt 构建 ───

/** 从 GameState 提取玩家属性摘要 */
function extractPlayerStats(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  const stats = state?.玩家?.生存状态;
  if (stats && typeof stats === 'object') {
    for (const [k, v] of Object.entries(stats)) {
      if (typeof v === 'number') out[k] = v;
    }
  }
  return out;
}

/** 从 GameState 提取玩家资源摘要 */
function extractPlayerResources(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  const player = state?.玩家;
  if (!player) return out;

  // 生存资源
  if (player.生存资源) {
    for (const [k, v] of Object.entries(player.生存资源)) {
      if (v && typeof v === 'object' && typeof (v as { 数量?: number }).数量 === 'number') {
        out[`生存资源.${k}`] = (v as { 数量: number }).数量;
      }
    }
  }

  // 经营资产
  if (player.经营资产 && typeof player.经营资产.资金 === 'number') {
    out['经营资产.资金'] = player.经营资产.资金;
  }

  // 货币资源
  if (player.货币资源?.主货币 && typeof player.货币资源.主货币.数量 === 'number') {
    out['货币资源.主货币'] = player.货币资源.主货币.数量;
  }

  return out;
}

/** 格式化属性为可读文本 */
function formatStats(stats: Record<string, number>): string {
  const entries = Object.entries(stats);
  if (entries.length === 0) return '暂无属性数据';
  return entries.map(([k, v]) => `${k}: ${v}`).join('、');
}

/** 格式化资源为可读文本 */
function formatResources(resources: Record<string, number>): string {
  const entries = Object.entries(resources);
  if (entries.length === 0) return '暂无资源数据';
  return entries.map(([k, v]) => `${k}: ${v}`).join('、');
}

/** 构建动态选项生成的 prompt */
export function buildDynamicChoicePrompt(input: DynamicChoicePromptInput): string {
  const [min, max] = input.config.countRange ?? [2, 4];
  const tpl = input.config.optionTemplate ?? {};

  const parts: string[] = [
    `你是一个互动叙事游戏的选项生成器。根据当前场景和玩家状态，生成有意义的选择。`,
    ``,
    `## 当前场景`,
    input.narrativeText || '（无场景描述）',
    ``,
    `## 玩家状态`,
    `属性：${formatStats(input.playerStats)}`,
    `资源：${formatResources(input.playerResources)}`,
  ];

  if (input.recentDecisions.length > 0) {
    parts.push(``, `## 最近决策`, input.recentDecisions.join('；'));
  }

  if (input.gameTime) {
    parts.push(``, `## 游戏时间`, input.gameTime);
  }

  parts.push(
    ``,
    `## 生成指令`,
    input.config.instruction,
    ``,
    `## 输出要求`,
    `- 生成 ${min} 到 ${max} 个选项`,
    `- 每个选项必须有 "label"（选项标题，15字以内，简洁有力）`,
  );

  if (tpl.aiNoteRequired !== false) {
    parts.push(`- 每个选项必须有 "aiNote"（给AI的决策上下文，30字以内，描述玩家做了什么）`);
  }

  if (tpl.effectRequired) {
    parts.push(`- 每个选项必须有 "effect"（数值效果对象，如 {"statId": "生命", "delta": -10} 或 {"resourcePath": "生存资源.体力", "delta": -5}）`);
  }

  parts.push(
    `- 选项应基于当前玩家状态动态生成：状态不同，选项内容不同`,
    `- 选项应有差异化：有的冒险、有的保守、有的中庸`,
    `- 直接输出 JSON 数组，不要包裹在 \`\`\`json 中，不要输出任何其他文字`,
    ``,
    `输出格式：`,
    tpl.effectRequired
      ? `[{"label":"...","aiNote":"...","effect":{"statId":"...","delta":0}}]`
      : `[{"label":"...","aiNote":"..."}]`,
  );

  return parts.join('\n');
}

// ─── 响应解析 ───

/** 从 AI 响应中解析选项列表 */
export function parseDynamicChoices(raw: string, config: DynamicChoiceConfig): ChoiceOption[] {
  if (!raw || typeof raw !== 'string') return [];

  let jsonStr = raw.trim();

  // 尝试从 ```json...``` 中提取
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 尝试从 [...] 数组中提取
  const arrayMatch = jsonStr.match(/(\[[\s\S]*\])/);
  if (arrayMatch) {
    jsonStr = arrayMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    const options: ChoiceOption[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;

      // label 必须存在且为字符串
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      if (!label) continue;

      const option: ChoiceOption = { label };

      // 可选：aiNote
      if (typeof o.aiNote === 'string' && o.aiNote.trim()) {
        option.aiNote = o.aiNote.trim();
      }

      // 可选：effect
      if (o.effect && typeof o.effect === 'object') {
        const eff = o.effect as Record<string, unknown>;
        const delta = typeof eff.delta === 'number' ? eff.delta : Number(eff.delta);
        if (!isNaN(delta)) {
          option.effect = {
            delta,
            ...(typeof eff.statId === 'string' && eff.statId.trim() ? { statId: eff.statId.trim() } : {}),
            ...(typeof eff.resourcePath === 'string' && eff.resourcePath.trim() ? { resourcePath: eff.resourcePath.trim() } : {}),
          };
        }
      }

      options.push(option);
    }

    return options;
  } catch {
    return [];
  }
}

// ─── 主函数 ───

/**
 * 从 GameState 构建 DynamicChoicePromptInput
 */
export function buildPromptInput(
  config: DynamicChoiceConfig,
  gameState: GameState,
  narrativeText: string,
  worldContext?: { worldName?: string; gameTime?: string },
): DynamicChoicePromptInput {
  return {
    worldName: worldContext?.worldName,
    narrativeText,
    config,
    playerStats: extractPlayerStats(gameState),
    playerResources: extractPlayerResources(gameState),
    recentDecisions: getRecentDecisionNotes(),
    gameTime: worldContext?.gameTime,
  };
}

/**
 * 生成动态选项 — 主入口
 *
 * @param config 动态选项配置
 * @param gameState 当前游戏状态
 * @param narrativeText 卡片叙事文本（场景描述）
 * @param apiConfig API 配置（用于调用 AI）
 * @param worldContext 世界上下文（名称、时间等）
 * @param signal AbortSignal（用于取消）
 * @returns 选项列表（失败时返回 fallbackChoices）
 */
export async function generateDynamicChoices(
  config: DynamicChoiceConfig,
  gameState: GameState,
  narrativeText: string,
  apiConfig: ApiConfig,
  worldContext?: { worldName?: string; gameTime?: string },
  signal?: AbortSignal,
): Promise<ChoiceOption[]> {
  // 1. 构建输入
  const input = buildPromptInput(config, gameState, narrativeText, worldContext);

  // 2. 检查缓存
  const cacheKey = buildCacheKey(config.instruction, input.playerStats, input.playerResources);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[DynamicChoice] 缓存命中，跳过 AI 调用');
    return cached;
  }

  // 3. 构建 prompt
  const prompt = buildDynamicChoicePrompt(input);
  const messages: Message[] = [{ role: 'user', content: prompt }];

  // 4. 调用 AI（带超时）
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);

  // 合并外部 signal 和超时 signal
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const result = await requestCompletion(apiConfig, messages, {
      maxTokens: MAX_TOKENS,
      signal: combinedSignal,
    });

    clearTimeout(timeoutId);

    // 5. 解析响应
    const choices = parseDynamicChoices(result.text, config);

    if (choices.length === 0) {
      console.warn('[DynamicChoice] AI 返回的选项为空或解析失败，使用兜底选项');
      return config.fallbackChoices ?? [];
    }

    // 6. 写入缓存
    setCache(cacheKey, choices);

    console.log(`[DynamicChoice] 成功生成 ${choices.length} 个选项`);
    return choices;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[DynamicChoice] 请求超时（3秒），使用兜底选项');
    } else {
      console.warn('[DynamicChoice] AI 调用失败:', err);
    }

    return config.fallbackChoices ?? [];
  }
}
