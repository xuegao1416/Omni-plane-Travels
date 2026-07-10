// 经营资产独立提取 — 从叙事中提取经营资产变更
// 通过 VARIABLE_UPDATE_ENDED 事件触发，fire-and-forget 模式

import type { VariableManager } from './variableManager';
import type { ApiConfig } from '../api/types';
import { callAuxiliaryApi } from '../api/auxiliaryApi';
import { buildBusinessExtractionPrompt } from '../modules/prompts/business';
import { findWorldDef } from '../data/worldLoader';
import { loadPresets } from '../components/settings/apiPresetUtils';
import { STORAGE_KEYS } from '../config/storageKeys';

/**
 * 从叙事文本中独立提取经营资产变更
 * 在 VARIABLE_UPDATE_ENDED 事件后以 fire-and-forget 方式调用
 */
export async function runBusinessExtraction(params: {
  varMgr: VariableManager;
  selectedWorld: string;
  userText: string;
  aiContentText: string;
  mainApiConfig: ApiConfig;
}): Promise<void> {
  const { varMgr, selectedWorld, userText, aiContentText, mainApiConfig } = params;

  // API 配置：优先变量提取专用预设 > 主API
  let effectiveConfig: ApiConfig = mainApiConfig;
  try {
    const varPresetId = localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET);
    if (varPresetId) {
      const presets = loadPresets();
      const preset = presets.find(p => p.id === varPresetId);
      if (preset) effectiveConfig = { ...preset.config };
    }
  } catch { /* fallback */ }

  // 获取当前经营状态
  const state = varMgr.getState();
  const currentBusiness = state.玩家?.经营资产 as Record<string, unknown> | undefined;

  // 获取经营环境配置
  const worldDef = findWorldDef(selectedWorld);
  const businessModule = worldDef?.modules?.find(m => m.moduleId === 'business' && m.enabled);
  const environment = businessModule?.moduleConfig as { description?: string; cycleName?: string } | undefined;

  // 构建提示词
  const prompt = buildBusinessExtractionPrompt({
    currentBusiness,
    environment,
    userText,
    aiContent: aiContentText,
  });

  try {
    const messages: { role: string; content: string }[] = [
      { role: 'user', content: userText },
      { role: 'assistant', content: aiContentText },
    ];

    const result = await callAuxiliaryApi(effectiveConfig, messages, prompt);
    console.log('[经营提取] API 返回:', result ? result.slice(0, 300) : 'null');

    if (result) {
      let jsonContent = result;
      const tagMatch = result.match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i);
      if (tagMatch) jsonContent = tagMatch[1].trim();

      if (jsonContent && jsonContent !== '{}') {
        console.log('[经营提取] 应用 JSON:', jsonContent.slice(0, 300));
        const applied = varMgr.applyUpdateVariable(jsonContent);
        console.log('[经营提取] applyUpdateVariable 结果:', applied);
        if (!applied) {
          console.warn('[经营提取] applyUpdateVariable 失败，内容前200字:', jsonContent.slice(0, 200));
        }
      } else {
        console.log('[经营提取] 无变更（空 JSON）');
      }
    } else {
      console.log('[经营提取] API 返回 null');
    }
  } catch (err) {
    console.warn('[经营提取] API 调用失败（不影响主流程）:', (err as Error).message || err);
  }
}
