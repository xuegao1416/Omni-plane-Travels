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
  const data = JSON.parse(extractJSON(raw));

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

/** 提取 JSON */
export function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlockMatch ? codeBlockMatch[1].trim() : (text.match(/(\{[\s\S]*\})/)?.[1]?.trim() ?? text.trim());
  return raw.replace(/[""]/g, '"').replace(/['']/g, "'");
}
