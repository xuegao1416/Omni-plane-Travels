// 正则脚本引擎 
// 负责用可配置的正则脚本对文本进行替换处理

// ============ ReDoS 防护 ============

/** 检查正则模式是否可能包含 ReDoS 风险（嵌套量词、回溯炸弹） */
function hasReDoSRisk(pattern: string): boolean {
  // 检测嵌套量词：(a+)+  (a*)+  (a+)*  (a*)*  (a{m,n}){p,q}
  const NESTED_QUANTIFIERS = /(\+|\*|\{[^}]+\})\)?(\+|\*|\{[^}]+\})/;
  if (NESTED_QUANTIFIERS.test(pattern)) return true;

  // 检测过度回溯：连续的可选字符组 (a|a)*  (a|b)*a
  const BACKTRACK_BOMB = /\([^)]*\|[^)]*\)[*+]\w*[*+]/;
  if (BACKTRACK_BOMB.test(pattern)) return true;

  return false;
}

// ============ 类型定义 ============

/** 正则脚本（兼容 SillyTavern 格式） */
export interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;       // 正则模式，可以是 /pattern/flags 或裸模式
  replaceString: string;   // 替换字符串，支持 $1..$N
  placement: number[];     // [1]=Input, [2]=Output, [3]=Slash
  disabled: boolean;
  markdownOnly: boolean;   // 仅在显示渲染时执行
  promptOnly: boolean;     // 仅在发送 API 时执行
  minDepth?: number | null;
  maxDepth?: number | null;
}

// ============ 内部辅助函数 ============

function parseRegexBool(value: unknown): boolean {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return Boolean(value);
}

function normalizeRegexPlacement(placement: number[] | number | string | null | undefined): number[] {
  const source = Array.isArray(placement) ? placement : (placement == null ? [] : [placement]);
  const result: number[] = [];
  for (const item of source) {
    const raw = typeof item === 'string' ? item.trim() : item;
    if (raw === 0 || raw === '0' || raw === 1 || raw === '1' || raw === 'Input') result.push(1);
    else if (raw === 2 || raw === '2' || raw === 'Output') result.push(2);
    else if (raw === 3 || raw === '3' || raw === 'Slash') result.push(3);
  }
  return result;
}

function parseRegexDepthLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function isRegexDepthAllowed(depth: number | null | undefined, script: RegexScript): boolean {
  const minDepth = parseRegexDepthLimit(script.minDepth);
  const maxDepth = parseRegexDepthLimit(script.maxDepth);
  const hasDepthLimit = minDepth !== null || maxDepth !== null;

  if (depth === null || depth === undefined) {
    return !hasDepthLimit;
  }

  if (minDepth !== null && depth < minDepth) return false;
  if (maxDepth !== null && depth >= maxDepth) return false;

  return true;
}

// ============ 核心函数 ============

/**
 * 对文本执行一组正则脚本替换
 * @param text - 原始文本
 * @param scripts - 正则脚本数组
 * @param placement - 当前处理通道：1=Input, 2=Output, 3=Slash；undefined=显示渲染
 * @param depth - 消息深度（用于 minDepth/maxDepth 过滤）
 */
export function processRegexScripts(
  text: string,
  scripts: RegexScript[],
  placement?: number | string,
  depth: number | null = null,
): string {
  if (!text || !scripts || scripts.length === 0) return text;

  let processedText = text;
  const normPlacements = placement !== undefined ? normalizeRegexPlacement(placement) : [];
  const isPromptGen = placement !== undefined; // placement 有值 → 发送 API
  const isMarkdownGen = placement === undefined; // placement 无值 → 前端显示

  for (const script of scripts) {
    // 0. 检查深度限制
    if (!isRegexDepthAllowed(depth, script)) continue;

    // 1. 检查 disabled
    if (parseRegexBool(script.disabled)) continue;

    // 2. 检查 markdownOnly / promptOnly
    const isMarkdownOnly = parseRegexBool(script.markdownOnly);
    const isPromptOnly = parseRegexBool(script.promptOnly);

    if (
      // 两个都没勾：两边都执行
      (!isMarkdownOnly && !isPromptOnly) ||
      // 两个都勾：两边都执行
      (isMarkdownOnly && isPromptOnly) ||
      // 仅 markdown：只在显示渲染时
      (isMarkdownOnly && !isPromptOnly && isMarkdownGen) ||
      // 仅 prompt：只在发送 API 时
      (isPromptOnly && !isMarkdownOnly && isPromptGen)
    ) {
      // 通过，继续执行
    } else {
      continue;
    }

    // 3. 检查 placement 匹配（仅在 placement 有值时）
    if (placement !== undefined && normPlacements.length > 0) {
      const scriptPlacements = normalizeRegexPlacement(script.placement);
      if (scriptPlacements.length > 0) {
        const hasMatch = normPlacements.some(p => scriptPlacements.includes(p));
        if (!hasMatch) continue;
      }
    }

    // 4. 编译正则并执行替换（含 ReDoS 防护）
    try {
      let replacement = script.replaceString || '';
      // 处理转义字符
      replacement = replacement.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

      let pattern = script.findRegex;
      if (!pattern) continue;

      let flags = 'g';
      const match = pattern.match(/^\/(.+)\/([a-z]*)$/);
      if (match) {
        pattern = match[1];
        flags = match[2] || 'g';
      }

      // ReDoS 防护：检测嵌套量词（如 (a+)+、(a*)*）
      if (/\([^)]*[+*][^)]*\)[+*?]/.test(pattern)) {
        console.warn(`[RegexScript] 跳过高风险正则 "${script.scriptName}": 检测到嵌套量词`);
        continue;
      }

      // 确保 g 标志，清理非法字符
      flags = flags.replace(/[^gimsuyv]/gi, '');
      if (!flags.includes('g')) flags += 'g';

      // ReDoS 防护：检测危险模式
      if (hasReDoSRisk(pattern)) {
        console.warn(`[Regex] 跳过可能包含 ReDoS 风险的正则: ${script.scriptName}`);
        continue;
      }

      const re = new RegExp(pattern, flags);
      processedText = processedText.replace(re, replacement);
    } catch (e) {
      console.warn(`Regex script error [${script.scriptName}]:`, e);
    }
  }

  return processedText;
}

/**
 * 合并多来源正则脚本（预设脚本 + 全局脚本）
 */
export function resolveRegexScripts(
  presetScripts: RegexScript[] = [],
  globalScripts: RegexScript[] = [],
): RegexScript[] {
  return [...globalScripts, ...presetScripts];
}
