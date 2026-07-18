import type { DimensionGeneration, DimensionSelection } from '../../../worldgen/choice';
import { GUIDED_DIMENSIONS, DIMENSION_HINTS } from './dimensions';

/** 增强版选项生成（包含 worldType 和 conflict 维度） */
export async function generateGuidedOptions(
  userDesc: string,
  callAI: (messages: Array<{ role: string; content: string }>) => Promise<string>,
): Promise<Record<string, DimensionGeneration>> {
  const dimensionList = GUIDED_DIMENSIONS.map(d =>
    `- ${d.label}：${DIMENSION_HINTS[d.key] || '生成4个有明显差异的选项'}`
  ).join('\n');

  // 生成完整的 JSON 模板，消除 "..." 占位符防止 AI 偷懒
  const jsonTemplate = GUIDED_DIMENSIONS.map(d =>
    `  "${d.key}": {
    "narrative": "2-3句引导语，激发用户对该维度的想象",
    "choices": [
      { "id": "A", "title": "2-4字标题", "subtitle": "15-30字描述，具体生动、有画面感" },
      { "id": "B", "title": "2-4字标题", "subtitle": "15-30字描述" },
      { "id": "C", "title": "2-4字标题", "subtitle": "15-30字描述" },
      { "id": "D", "title": "2-4字标题", "subtitle": "15-30字描述" }
    ]
  }`
  ).join(',\n');

  const prompt = `你是一个世界构建专家，擅长根据用户描述为各种题材生成丰富多样的设定选项。

【用户描述】
「${userDesc}」

请仔细理解用户描述中的题材方向（校园、科幻、奇幻、武侠、日常、历史、悬疑等）和氛围倾向（温馨、紧张、幽默、诗意、浪漫等），然后为以下每个维度各生成4个选项。

【核心要求】
1. 紧扣用户描述：绝对不能偏离用户设想的题材和氛围。用户要温馨校园就做温馨校园，不要往黑暗修仙、末日生存、尔虞我诈的方向跑偏。
2. 选项之间要有真正差异：4个选项代表4种不同方向，能激发用户的不同想象，而非同一类东西的微调。
3. 标题2-4字，精准有力。
4. 副标题15-30字，具体生动，看完就能在脑海中产生画面。不要写空洞的概念词。
5. narrative 引导语要贴合用户描述的语境，用自然的语言启发用户思考。

【维度列表】
${dimensionList}

严格按以下JSON格式返回，不要任何额外文字（不要写注释、不要用省略号代替内容、不要省略任何维度）：

{
${jsonTemplate}
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

/** 重新生成单个维度的选项 */
export async function regenerateDimensionOptions(
  userDesc: string,
  dimKey: string,
  dimLabel: string,
  previousSelections: DimensionSelection[],
  callAI: (messages: Array<{ role: string; content: string }>) => Promise<string>,
): Promise<DimensionGeneration> {
  const hint = DIMENSION_HINTS[dimKey] || '生成4个有明显差异的选项';

  // 整理已选维度的上下文
  const selectedContext = previousSelections.length > 0
    ? '\n【已确定的维度】\n' + previousSelections.map(s => {
        const chosen = s.choices || (s.choice ? [s.choice] : []);
        const titles = chosen.map(c => c.title).join('、');
        return `- ${s.dimensionLabel}：${titles}`;
      }).join('\n')
    : '';

  const prompt = `你是一个世界构建专家，擅长根据用户描述生成丰富多样的设定选项。

【用户描述】
「${userDesc}」
${selectedContext}

当前需要为【${dimLabel}】维度重新生成4个选项。
要求：${hint}

核心要求：
1. 紧扣用户描述的题材和氛围
2. 4个选项要有真正差异，代表不同方向
3. 标题2-4字，精准有力
4. 副标题15-30字，具体生动，有画面感
${selectedContext ? '5. 与上面已确定的维度保持逻辑一致，不要冲突' : ''}

严格按以下JSON格式返回，不要任何额外文字：
{
  "narrative": "2-3句引导语，激发用户对该维度的想象",
  "choices": [
    { "id": "A", "title": "2-4字标题", "subtitle": "15-30字描述" },
    { "id": "B", "title": "2-4字标题", "subtitle": "15-30字描述" },
    { "id": "C", "title": "2-4字标题", "subtitle": "15-30字描述" },
    { "id": "D", "title": "2-4字标题", "subtitle": "15-30字描述" }
  ]
}`;

  const raw = await callAI([{ role: 'user', content: prompt }]);
  const extracted = extractJSON(raw);
  let data: any;
  try {
    data = JSON.parse(extracted);
  } catch {
    const repaired = repairTruncatedJSON(extracted);
    data = JSON.parse(repaired);
  }

  return {
    narrative: data.narrative || '',
    choices: data.choices || [],
  };
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
