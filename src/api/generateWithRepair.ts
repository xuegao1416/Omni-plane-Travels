/**
 * 生成 → 校验 → 修复：AI 生成内容（事件合集、模块初始数据、天赋树等）的统一流程。
 *
 * 1. 请求一次，解析；格式坏了（不是 JSON、缺字段）就把解析错误交回去重写一次。
 * 2. 解析成功后按当前世界的目录校验；有错误就把问题逐条交回去修一次（默认一次）。
 * 3. 修复版错误不比原版多才采用；修复请求本身失败时保留原版。
 * 取消（AbortError）一律直接抛出。
 */
import type { Message } from './types';

export interface RepairableIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface GenerateWithRepairOptions<T, I extends RepairableIssue> {
  messages: Message[];
  /** 发出一次请求，返回模型原文。 */
  request: (messages: Message[]) => Promise<string>;
  /** 解析原文；格式不对时抛错（错误信息会交给模型）。 */
  parse: (text: string) => T;
  /** 按目录校验；返回问题列表。 */
  validate: (value: T) => I[];
  /** 校验错误 → 修复请求文字。 */
  repairPrompt: (issues: readonly I[]) => string;
  /** 解析错误 → 修复请求文字。 */
  formatRepairPrompt?: (error: string) => string;
  /** 最多修复几次（默认 1）。 */
  maxRepairs?: number;
  onRepair?: (info: { attempt: number; reason: 'format' | 'validation'; detail: string }) => void;
}

export interface GenerateWithRepairResult<T, I> {
  value: T;
  issues: I[];
  text: string;
  /** 采用的是修复后的版本。 */
  repaired: boolean;
  /** 一共发了几次请求。 */
  requests: number;
}

export class GenerationFormatError extends Error {
  constructor(message: string, readonly text: string) {
    super(message);
    this.name = 'GenerationFormatError';
  }
}

export function countErrors(issues: readonly RepairableIssue[]): number {
  return issues.filter(issue => issue.level === 'error').length;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_FORMAT_REPAIR = (error: string) =>
  `上一份输出无法解析：${error}\n请按要求重新输出完整、合法的 JSON，不要任何解释文字。`;

/** 从模型原文里取出第一个 { 到最后一个 } 之间的 JSON。 */
export function parseJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('没有找到 JSON 对象');
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    throw new Error(`JSON 语法错误：${message(error)}`);
  }
}

export async function generateWithRepair<T, I extends RepairableIssue>(options: GenerateWithRepairOptions<T, I>): Promise<GenerateWithRepairResult<T, I>> {
  const maxRepairs = Math.max(0, options.maxRepairs ?? 1);
  const formatPrompt = options.formatRepairPrompt ?? DEFAULT_FORMAT_REPAIR;
  let requests = 0;
  const ask = async (messages: Message[]) => { requests += 1; return options.request(messages); };

  let text = await ask(options.messages);
  let repairsLeft = maxRepairs;
  let value: T;
  for (;;) {
    try {
      value = options.parse(text);
      break;
    } catch (error) {
      if (isAbort(error)) throw error;
      if (repairsLeft <= 0) throw new GenerationFormatError(`AI 返回的内容无法解析：${message(error)}`, text);
      repairsLeft -= 1;
      options.onRepair?.({ attempt: maxRepairs - repairsLeft, reason: 'format', detail: message(error) });
      text = await ask([...options.messages, { role: 'assistant', content: text }, { role: 'user', content: formatPrompt(message(error)) }]);
    }
  }

  let best = { value, issues: options.validate(value), text, repaired: false };
  while (repairsLeft > 0 && countErrors(best.issues) > 0) {
    repairsLeft -= 1;
    options.onRepair?.({ attempt: maxRepairs - repairsLeft, reason: 'validation', detail: `${countErrors(best.issues)} 处问题` });
    let candidateText: string;
    try {
      candidateText = await ask([...options.messages, { role: 'assistant', content: best.text }, { role: 'user', content: options.repairPrompt(best.issues) }]);
    } catch (error) {
      if (isAbort(error)) throw error;
      break;
    }
    let candidate: T;
    try {
      candidate = options.parse(candidateText);
    } catch (error) {
      if (isAbort(error)) throw error;
      continue;
    }
    const issues = options.validate(candidate);
    if (countErrors(issues) <= countErrors(best.issues)) best = { value: candidate, issues, text: candidateText, repaired: true };
  }
  return { ...best, requests };
}
