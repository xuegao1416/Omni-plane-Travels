// 角色画像生成 Hook — 根据 NPC 数据生成画像并设置为头像
import { useCallback } from 'react';
import { useImageGen } from './useImageGen';
import { getGenerationConfigError } from '@/api/imageGen';
import { useImageStore } from '@/stores/imageStore';
import type { NPCData } from '@/schema/variables';

/** 从 NPC 数据构建生图提示词（导出供编辑器预览用） */
export function buildPortraitPrompt(npc: NPCData, template?: string): string {
  // 如果有自定义模板，使用它
  if (template && template.trim()) {
    let result = template;
    result = result.replace(/\{\{characterToon\}\}/gi, JSON.stringify(npc, null, 2));
    return result;
  }

  // 默认模板：从 NPC 特征提取提示词
  const parts: string[] = ['masterpiece, best quality, portrait'];
  const ext = npc as any;
  const pi = npc.个人信息 || {};

  // 性别
  const gender = npc.性别 || '';
  if (gender.includes('女')) parts.push('1girl');
  else if (gender.includes('男')) parts.push('1boy');
  else parts.push('1person');

  // 外貌
  const appearance = pi.外貌 || ext.形象 || '';
  if (appearance) parts.push(appearance.slice(0, 200));

  // 年龄
  const age = npc.年龄 || '';
  if (age) parts.push(`${age}`);

  // 职业
  const occupation = npc.社会身份?.职业 || ext.身份 || '';
  if (occupation) parts.push(`${occupation}`);

  // 服装
  const outfit = pi.当前穿着 || '';
  if (outfit) parts.push(`wearing ${outfit}`);

  // 情绪/状态
  const state = pi.当前状态 || '';
  if (state) parts.push(`${state} expression`);

  // 风格
  parts.push('anime style, detailed face, upper body');

  return parts.join(', ');
}

export function useCharacterPortrait() {
  const { config, generateAndSave, getImageUrl } = useImageGen();
  const imageConfig = useImageStore((s) => s.config);

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

    const prompt = promptOverride?.trim() || buildPortraitPrompt(npc, imageConfig.characterPortraitPromptTemplate);

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
  }, [config, generateAndSave, getImageUrl, imageConfig.characterPortraitPromptTemplate]);

  return { generatePortrait };
}
