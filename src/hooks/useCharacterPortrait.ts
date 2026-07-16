// 角色画像生成 Hook — 根据 NPC 数据生成画像并设置为头像
import { useCallback } from 'react';
import { useImageGen } from './useImageGen';
import { getGenerationConfigError } from '@/api/imageGen';
import { useConfigStore } from '@/stores/configStore';
import { requestCompletionStream } from '@/api/client';
import type { NPCData } from '@/schema/variables';

// ─── LLM 翻译 Prompt ───

const PORTRAIT_SYSTEM_PROMPT = `你是动漫图像提示词专家。将中文角色信息转为英文 booru 标签。

规则：
- 输出格式：逗号+空格分隔的英文标签，如 "1girl, long silver hair, golden eyes"
- 开头必含：masterpiece, best quality, very aesthetic, amazing quality, highres, absurdres, extremely detailed, solo
- 之后依次：主体(1girl/1boy) → 构图 → 头发 → 眼睛 → 表情 → 种族特征 → 服装(颜色+材质+款式拆分) → 饰品 → 背景 → 光照
- 非人特征：elf ears / demon horns / tail / wings 等
- 光照：cinematic lighting / volumetric lighting / bokeh
- 信息不全时根据性别/种族/职业合理推断，不留空
- 只输出标签，不解释、不换行、不加引号、不加 markdown
- 总量 50-100 个标签`;

const QUALITY_TAGS = 'masterpiece, best quality, very aesthetic, amazing quality, highres, absurdres, extremely detailed, solo';

// ─── 从 NPC 数据构建中文角色描述 ───

/** 判断值是否为无意义的占位符 */
function isPlaceholder(val: unknown): boolean {
  if (val == null) return true;
  const s = String(val).trim();
  return !s || s === '未知' || s === '无' || s === '暂无' || s === '没有' || s === '不详';
}

function addLine(lines: string[], label: string, val: unknown) {
  if (!isPlaceholder(val)) lines.push(`${label}：${val}`);
}

function buildCharacterDescription(npc: NPCData): string {
  const lines: string[] = [];
  const pi = npc.个人信息 || {};

  addLine(lines, '姓名', npc.姓名);
  addLine(lines, '性别', npc.性别);
  addLine(lines, '种族', npc.种族);
  addLine(lines, '种族描述', npc.种族描述);
  addLine(lines, '年龄', npc.年龄);
  addLine(lines, '职业', npc.社会身份?.职业);
  addLine(lines, '性格', npc.性格);
  addLine(lines, '外在性格', pi.表性格);
  addLine(lines, '外貌', pi.外貌);
  addLine(lines, '穿着', pi.当前穿着);
  addLine(lines, '状态', pi.当前状态);
  addLine(lines, '位置', pi.当前位置);
  addLine(lines, '背景', npc.背景);

  const ext = npc as any;
  addLine(lines, '形象', ext.形象);
  addLine(lines, '身份', ext.身份);

  // 装备
  if (npc.装备列表 && typeof npc.装备列表 === 'object') {
    const equips = Object.values(npc.装备列表).filter(v => !isPlaceholder(v));
    if (equips.length) lines.push(`装备：${equips.join('、')}`);
  }

  return lines.join('\n');
}

// ─── 导出函数 ───

/** 本地降级：从 NPC 数据直接拼基础英文标签（LLM 失败时用） */
export function buildPortraitPrompt(npc: NPCData): string {
  const parts: string[] = ['masterpiece, best quality, portrait'];
  const gender = npc.性别 || '';
  if (gender.includes('女')) parts.push('1girl');
  else if (gender.includes('男')) parts.push('1boy');
  else parts.push('1person');

  const pi = npc.个人信息 || {};
  if (pi.外貌) parts.push(pi.外貌);
  if (pi.当前穿着) parts.push(pi.当前穿着);
  if (npc.社会身份?.职业) parts.push(npc.社会身份.职业);
  parts.push('anime style, detailed face, upper body');
  return parts.join(', ');
}

/** 调用 LLM 将中文角色描述翻译为英文 booru 标签 */
export async function translatePromptWithLLM(npc: NPCData): Promise<string> {
  const apiConfig = useConfigStore.getState().apiConfig;
  if (!apiConfig) throw new Error('未配置 API');

  const charDesc = buildCharacterDescription(npc);

  const result = await requestCompletionStream(
    apiConfig,
    [
      { role: 'system', content: PORTRAIT_SYSTEM_PROMPT },
      { role: 'user', content: charDesc },
    ],
    { temperature: 0.3, maxTokens: 1000, onDelta: () => {} },
  );

  let text = result.text.trim();
  if (!text) throw new Error('LLM 返回为空');

  // 去掉 markdown 代码块包裹、引号、换行
  text = text.replace(/^```(?:json|text)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  text = text.replace(/\n/g, ', ').replace(/\s+/g, ' ').trim();

  // 兜底：缺少质量标签则自动补
  const lower = text.toLowerCase();
  if (!lower.includes('masterpiece') || !lower.includes('best quality')) {
    text = `${QUALITY_TAGS}, ${text}`;
  }

  return text;
}

// ─── Hook ───

export function useCharacterPortrait() {
  const { config, generateAndSave, getImageUrl } = useImageGen();

  const generatePortrait = useCallback(async (
    npc: NPCData,
    onProgress?: (status: string) => void,
    promptOverride?: string,
  ): Promise<{ url: string; blobKey: string } | null> => {
    const configError = getGenerationConfigError(config);
    if (configError) {
      onProgress?.(`配置错误: ${configError}`);
      return null;
    }

    const npcName = npc.姓名 || '未知';
    onProgress?.(`正在为 ${npcName} 生成画像...`);

    const prompt = promptOverride?.trim() || buildPortraitPrompt(npc);

    try {
      const result = await generateAndSave(
        prompt,
        { category: 'character', characterName: npcName },
        (s) => onProgress?.(s === 'generating' ? '生成中...' : s),
      );

      if (result?.imageBlobKey) {
        const url = await getImageUrl(result);
        if (url) {
          onProgress?.('画像生成成功');
          return { url, blobKey: result.imageBlobKey };
        }
      }

      onProgress?.('生成完成但未返回图片');
      return null;
    } catch (e) {
      onProgress?.(`生成失败: ${(e as Error).message}`);
      return null;
    }
  }, [config, generateAndSave, getImageUrl]);

  return { generatePortrait };
}
