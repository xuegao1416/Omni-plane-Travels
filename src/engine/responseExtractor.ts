// 响应解析器 — 从原始 API 响应中提取纯正文
// 设计原则：显示层全靠正则脚本，这里只提供 API 上下文用的纯正文提取

/**
 * 从原始响应中提取纯正文（剥掉所有标签）
 * 用途：发给 AI API、变量提取、记忆系统
 */
export function extractContentForPrompt(rawText: string): string {
  if (!rawText) return '';

  // 优先提取 <contenttext> 标签内的内容
  const contentMatch = rawText.match(/<contenttext>([\s\S]*?)<\/contenttext>/i);
  if (contentMatch) {
    return stripInnerTags(contentMatch[1]).trim();
  }

  // 兜底：剥掉所有已知标签，剩余当正文
  return stripAllTags(rawText).trim();
}

// ── 内部工具函数 ──

/** 剥掉 contenttext 内部的子标签 */
function stripInnerTags(text: string): string {
  return text
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '')
    .replace(/<Auto>[\s\S]*?<\/Auto>/gi, '')
    .replace(/<safe>[\s\S]*?<\/safe>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<analysis_block>[\s\S]*?<\/analysis_block>/gi, '')
    .replace(/<image_think[^>]*>[\s\S]*?<\/image_think>/gi, '')
    .replace(/<image[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/<imgthink[^>]*>[\s\S]*?<\/imgthink>/gi, '')
    .replace(/<\/?(?:UpdateVariable|variable|action_options|options|details|summary|Auto|safe|StatusPlaceHolderImpl|thinking|analysis_block|contenttext|image|image_think|imgthink|br|hr)[^>]*\/?>/gi, '');
}

/** 剥掉所有已知标签（兜底用） */
function stripAllTags(text: string): string {
  return text
    .replace(/<contenttext>[\s\S]*?<\/contenttext>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<(?:action_)?options>[\s\S]*?<\/(?:action_)?options>/gi, '')
    .replace(/<(?:Update)?[Vv]ariable>[\s\S]*?<\/(?:Update)?[Vv]ariable>/gi, '')
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '')
    .replace(/<Auto>[\s\S]*?<\/Auto>/gi, '')
    .replace(/<safe>[\s\S]*?<\/safe>/gi, '')
    .replace(/<analysis_block>[\s\S]*?<\/analysis_block>/gi, '')
    .replace(/<image_think[^>]*>[\s\S]*?<\/image_think>/gi, '')
    .replace(/<image[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/<imgthink[^>]*>[\s\S]*?<\/imgthink>/gi, '')
    .replace(/<thinking>[\s\S]*?(?=<\/?(?:contenttext|action_?options|Update|variable|summary|Auto|safe)|$)/gi, '')
    .replace(/<\/?(?:UpdateVariable|variable|action_options|options|details|summary|Auto|safe|StatusPlaceHolderImpl|thinking|analysis_block|contenttext|image|image_think|imgthink|br|hr)[^>]*\/?>/gi, '');
}

// ── 类型定义（供 pipelineExecutor / variableExtraction 使用） ──

export interface ParsedResponse {
  content: string;
  thinking: string;
  actionOptions?: unknown[];
  summary?: string | null;
}
