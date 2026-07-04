// 提示词组装器 —— 从结构化 prompts[] 构建完整的系统提示
// 替代 useGameEngine.ts 中的内联字符串拼接

import type { PresetPack, PresetPromptEntry } from '../data/builtinPresets';
import { getEnabledPrompts, filterTriggeredPrompts } from '../data/builtinPresets';
import type { MacroEngine } from './macroEngine';

/**
 * 估算文本的 token 数量（中英文混合，~2.5 字符 ≈ 1 token）
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 2.5);
}

/**
 * 将文本裁剪到指定 token 预算内，按行截断
 */
function trimToTokenBudget(text: string, tokenBudget: number): string {
  if (!text || tokenBudget <= 0) return '';
  if (estimateTokens(text) <= tokenBudget) return text;

  const lines = text.split('\n');
  const kept: string[] = [];
  let usedTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line) + 1;
    if (kept.length === 0 || usedTokens + lineTokens <= tokenBudget) {
      kept.push(line);
      usedTokens += lineTokens;
    } else {
      break;
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 组装器上下文 —— 包装所有需要注入到 prompt 的数据 */
export interface AssemblerContext {
  /** 变量快照（序列化的 GameState） */
  varSnapshot: string;
  /** 世界书注入内容 */
  wbInjection: string;
  /** 玩家档案区块 */
  playerProfileBlock: string;
  /** 角色认知防火墙标题 */
  firewallTitle: string;
  /** 角色认知防火墙内容 */
  firewallContent: string;
  /** 当前用户输入文本（用于 green 触发过滤） */
  userText: string;
  /** 当前轮次 */
  round: number;
  /** 宏引擎实例 */
  macroEngine: MacroEngine;
  /** 编译后的记忆上下文（来自记忆系统） */
  compiledMemoryContext?: string;
  /** 世界模拟简报（世界动态 + 角色暗线摘要，来自 WorldSimulationEngine） */
  simulationBrief?: string;
  /** 世界书 atDepth 条目（需要插入到聊天历史中的指定深度） */
  atDepthEntries?: Array<{ depth: number; content: string }>;
}

/**
 * 从结构化预设包组装完整的系统提示
 *
 * 组装顺序：
 * 1. 世界书注入 (wbInjection)
 * 2. 玩家档案 (playerProfileBlock)
 * 3. 角色认知防火墙 (firewall)
 * 4. 编译后的记忆上下文 (compiledMemoryContext)
 * 5. 世界模拟简报 (simulationBrief) — 后台推演引擎产出的世界动态
 * 6. 预设提示词条目（按 order 排序，过滤 enabled + 触发模式）
 *
 * 每个条目的 content 在拼接前通过 macroEngine.resolve() 解析宏
 */
export function assembleSystemPrompt(
  preset: PresetPack,
  ctx: AssemblerContext,
): string {
  // 1. 获取已启用的条目并按 order 排序
  const enabled = getEnabledPrompts(preset);

  // 2. 过滤 green 触发的条目
  const triggered = filterTriggeredPrompts(enabled, ctx.userText);

  // 3. 解析每个条目的宏并拼接
  // 对 varSnapshot 做 token budget 裁剪，防止系统提示过大撑爆上下文
  const VAR_SNAPSHOT_TOKEN_BUDGET = 1800;
  const trimmedVarSnapshot = trimToTokenBudget(ctx.varSnapshot, VAR_SNAPSHOT_TOKEN_BUDGET);

  const resolvedParts = triggered.map(entry => {
    let content = entry.content;

    // 替换 {{VAR_SNAPSHOT}} 占位符（延迟绑定）
    content = content.replace(/\{\{VAR_SNAPSHOT\}\}/gi, trimmedVarSnapshot);

    // 通过宏引擎解析其他宏
    content = ctx.macroEngine.resolve(content);

    return content;
  });

  const presetBody = resolvedParts.join('\n\n');

  // 4. 组装最终系统提示（前置部分 + 预设主体）
  const parts: string[] = [];

  if (ctx.wbInjection) {
    parts.push(ctx.wbInjection);
  }

  if (ctx.playerProfileBlock) {
    parts.push(ctx.playerProfileBlock);
  }

  if (ctx.firewallTitle && ctx.firewallContent) {
    parts.push(`${ctx.firewallTitle}\n${ctx.firewallContent}`);
  }

  // 注入记忆上下文（如果有）
  if (ctx.compiledMemoryContext) {
    parts.push(ctx.compiledMemoryContext);
  }

  // 注入世界模拟简报（世界动态 + 角色暗线摘要）
  if (ctx.simulationBrief) {
    parts.push(ctx.simulationBrief);
  }

  parts.push(presetBody);

  return parts.join('\n\n');
}

/**
 * 将 atDepth 世界书条目注入到聊天历史中。
 *
 * depth 含义：depth=2 表示"在倒数第 2 条消息之前插入"，
 * 即 AI 只能看到最近 1 条用户消息时就能看到该条目。
 *
 * @param chatHistory 原始聊天历史（不含 system message）
 * @param atDepthEntries 需要注入的 atDepth 条目
 * @returns 注入后的聊天历史
 */
export function injectAtDepthEntries<T extends { role: string; content: string }>(
  chatHistory: T[],
  atDepthEntries: Array<{ depth: number; content: string }>,
): T[] {
  if (!atDepthEntries || atDepthEntries.length === 0) return chatHistory;

  const result = [...chatHistory];
  // 按 depth 从大到小排序（深的先插，避免影响浅的插入位置）
  const sorted = [...atDepthEntries].sort((a, b) => b.depth - a.depth);

  for (const entry of sorted) {
    // depth 表示"在倒数第 N 条之前插入"
    const insertPos = Math.max(0, result.length - entry.depth);
    const depthMsg = {
      role: 'user' as const,
      content: `[世界书补充 - depth:${entry.depth}]\n${entry.content}`,
    } as T;
    result.splice(insertPos, 0, depthMsg);
  }

  return result;
}
