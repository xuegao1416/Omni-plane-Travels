import type { DimensionGeneration } from '../../../worldgen/choice';
import { GUIDED_DIMENSIONS, DIMENSION_HINTS } from './dimensions';

/** 增强版选项生成（包含 worldType 和 conflict 维度） */
export async function generateGuidedOptions(
  userDesc: string,
  callAI: (messages: Array<{ role: string; content: string }>) => Promise<string>,
): Promise<Record<string, DimensionGeneration>> {
  const dimensionList = GUIDED_DIMENSIONS.map(d =>
    `- ${d.label}（${d.key}）：${DIMENSION_HINTS[d.key] || '生成4个有明显差异的选项'}`
  ).join('\n');

  const prompt = `你是一个世界构建专家。用户想要创建一个世界：
"${userDesc}"

请为以下每个维度各生成4个选项。每个选项要有明显差异，并且与用户描述的世界类型相匹配。

维度列表：
${dimensionList}

请严格按以下JSON格式返回，不要有任何其他文字：
{
  "worldType": {
    "narrative": "关于世界类型的2-3句描述",
    "choices": [
      { "id": "A", "title": "类型名", "subtitle": "一句话描述" },
      { "id": "B", "title": "类型名", "subtitle": "一句话描述" },
      { "id": "C", "title": "类型名", "subtitle": "一句话描述" },
      { "id": "D", "title": "类型名", "subtitle": "一句话描述" }
    ]
  },
  "tone": { "narrative": "...", "choices": [...] },
  "conflict": { "narrative": "...", "choices": [...] },
  "geography": { "narrative": "...", "choices": [...] },
  "factions": { "narrative": "...", "choices": [...] },
  "npcs": { "narrative": "...", "choices": [...] },
  "culture": { "narrative": "...", "choices": [...] },
  "rules": { "narrative": "...", "choices": [...] }
}`;

  const raw = await callAI([{ role: 'user', content: prompt }]);
  const extracted = extractJSON(raw);
  let data: any;
  try {
    data = JSON.parse(extracted);
  } catch (parseErr) {
    // 第1步：本地修复（补齐括号）
    console.warn('[引导选项] JSON 解析失败，尝试本地修复...');
    try {
      const repaired = repairTruncatedJSON(extracted);
      data = JSON.parse(repaired);
      console.log('[引导选项] 本地修复成功');
    } catch {
      // 第2步：本地修复失败，让 AI 补全截断的 JSON
      console.warn('[引导选项] 本地修复失败，请求 AI 补全...');
      try {
        const completionPrompt = `以下 JSON 被截断了，请补全它使其成为合法 JSON。只返回补全后的完整 JSON，不要有任何其他文字：\n\n${extracted}`;
        const completed = await callAI([{ role: 'user', content: completionPrompt }]);
        const completedExtracted = extractJSON(completed);
        data = JSON.parse(completedExtracted);
        console.log('[引导选项] AI 补全成功');
      } catch {
        console.error('[引导选项] 所有修复方式均失败，原始响应前500字:', raw.slice(0, 500));
        throw new Error(`AI 返回的 JSON 格式无效: ${parseErr instanceof Error ? parseErr.message : '未知错误'}`);
      }
    }
  }

  // 整理为标准格式
  const result: Record<string, DimensionGeneration> = {};
  for (const dim of GUIDED_DIMENSIONS) {
    const dimData = data[dim.key];
    if (dimData && Array.isArray(dimData.choices)) {
      result[dim.key] = {
        narrative: dimData.narrative || '',
        choices: dimData.choices,
      };
    } else {
      result[dim.key] = { narrative: '', choices: [] };
    }
  }
  return result;
}

/** 修复截断的 JSON：补齐未闭合的括号和引号 */
function repairTruncatedJSON(json: string): string {
  let s = json;

  // 去掉尾部逗号
  s = s.replace(/,\s*([}\]])/g, '$1');

  // 如果字符串中有未闭合的引号，截断到最后一个完整值
  let inString = false;
  let escaped = false;
  let lastValidPos = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString && (ch === '}' || ch === ']')) {
      lastValidPos = i;
    }
  }
  if (inString && lastValidPos > 0) {
    s = s.slice(0, lastValidPos + 1);
  }

  // 补齐缺失的闭合括号
  const openBrace = (s.match(/{/g) || []).length;
  const closeBrace = (s.match(/}/g) || []).length;
  const openBracket = (s.match(/\[/g) || []).length;
  const closeBracket = (s.match(/]/g) || []).length;
  s += ']'.repeat(Math.max(0, openBracket - closeBracket));
  s += '}'.repeat(Math.max(0, openBrace - closeBrace));

  // 再次去掉可能产生的尾部逗号
  s = s.replace(/,\s*([}\]])/g, '$1');

  return s;
}

/** 提取 JSON */
export function extractJSON(text: string): string {
  // 1. 先尝试提取 ```json ... ``` 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim().replace(/[""]/g, '"').replace(/['']/g, "'");
  }

  // 2. 找最外层 { ... }（非贪婪，避免匹配到 thinking 标签里的花括号）
  // 先移除可能的 thinking 标签
  const cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/gi, '');

  // 找第一个 { 到最后一个 }（在清理后的文本上）
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).replace(/[""]/g, '"').replace(/['']/g, "'");
  }

  // 3. 兜底：返回原始文本
  return text.replace(/[""]/g, '"').replace(/['']/g, "'");
}
