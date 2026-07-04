// 变量提取 API 客户端 - 从 AI 回复中提取变量更新

import type { ApiConfig } from './types';
import { buildEndpoint } from './client';

/**
 * 尝试从 AI 回复内容中提取变量更新 JSON
 *
 * 解析顺序：
 * 1. <UpdateVariable>...</UpdateVariable> 标签内的内容
 * 2. ```json ... ``` 代码块（AI 可能不用标签而用代码块）
 * 3. 裸 JSON 对象 { ... }（最后的兜底）
 *
 * 返回提取到的 JSON 字符串（不含标签），或 null
 */
function extractUpdateContent(content: string): string | null {
  if (!content) return null;

  // 1. 优先匹配 <UpdateVariable> 标签
  const tagMatch = content.match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i);
  if (tagMatch) {
    return tagMatch[1].trim();
  }

  // 2. 匹配 ```json ... ``` 代码块
  const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 3. 匹配裸 JSON 对象（找到第一个 { 到最后一个 }）
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = content.slice(firstBrace, lastBrace + 1).trim();
    // 快速验证：至少看起来像 JSON 对象
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // 不是合法 JSON，跳过
    }
  }

  return null;
}

// 调用变量提取 API
export async function callAuxiliaryApi(
  config: ApiConfig,
  messages: { role: string; content: string }[],
  variableUpdatePrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = buildEndpoint(config);
  const apiKey = config.apiKey;
  const model = config.model;

  // 构建完整消息列表，最后加上变量更新指令
  const fullMessages = [
    ...messages,
    { role: 'user', content: variableUpdatePrompt },
  ];

  const body = {
    model,
    messages: fullMessages,
    temperature: 0.8,
    stream: false,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    throw new Error(`辅助 API 请求失败: ${resp.status}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';

  const extracted = extractUpdateContent(content);
  if (!extracted) {
    console.warn('[变量提取] AI 回复中未找到有效的 UpdateVariable 内容，回复前200字:', content.slice(0, 200));
    return null;
  }

  return extracted;
}

// 从世界书提取变量更新规则
export function extractVariableRules(entries: { comment: string; content: string; enabled: boolean }[]): string {
  return entries
    .filter(e => e.enabled && e.comment.includes('[mvu_update]'))
    .map(e => e.content)
    .filter(Boolean)
    .join('\n\n');
}
