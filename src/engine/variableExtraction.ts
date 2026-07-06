import type { VariableManager } from './variableManager';
import type { WorldBookManager } from '../worldbook/index';
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { ParsedResponse } from './responseExtractor';
import type { ApiConfig } from '../api/types';
import { callAuxiliaryApi, extractVariableRules } from '../api/auxiliaryApi';
import { eventBus, EVENTS } from './eventBus';
import { buildVariableExtractionPrompt } from '../utils/prompts';
import { findWorldDef } from '../data/worldLoader';
import { loadPresets } from '../components/settings/apiPresetUtils';
import { STORAGE_KEYS } from '../config/storageKeys';
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 精简 GameState 用于变量提取 API 调用
 * 移除非必要字段（memoryRuntime、portraitUrl 等），减少序列化体积
 */
function sanitizeForExtraction(state: GameState): GameState {
  const snapshot = { ...state };

  // 移除记忆系统运行态和配置（体积大，变量提取不需要）
  delete (snapshot as any).memoryRuntime;
  delete (snapshot as any).memoryConfig;

  // 精简 NPC 数据
  if (snapshot.人物档案) {
    const cleanedNpcs: Record<string, unknown> = {};
    for (const [id, npc] of Object.entries(snapshot.人物档案)) {
      const cleaned = { ...npc };
      // 移除缓存字段
      delete (cleaned as any).portraitUrl;
      delete (cleaned as any).portraitBlobKey;
      // 事迹只保留最近 10 条（完整事迹在主状态里，提取只需参考近期）
      if (Array.isArray(cleaned.人物事迹) && cleaned.人物事迹.length > 10) {
        cleaned.人物事迹 = cleaned.人物事迹.slice(-10);
      }
      cleanedNpcs[id] = cleaned;
    }
    snapshot.人物档案 = cleanedNpcs as any;
  }

  return snapshot;
}

async function callAuxiliaryApiForEngine(
  config: ApiConfig,
  worldBook: WorldBookManager | null,
  gameState: GameState,
  userMessage: string,
  aiContentText: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const variableSnapshot = JSON.stringify(sanitizeForExtraction(gameState));

  let worldBookRules = '';
  if (worldBook) {
    worldBookRules = extractVariableRules(worldBook.entries);
  }

  const messages: { role: string; content: string }[] = [
    { role: 'user', content: `[当前变量快照]: ${variableSnapshot}` },
  ];
  if (worldBookRules) {
    messages.push({ role: 'user', content: worldBookRules });
  }

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }
  messages.push({ role: 'assistant', content: aiContentText });

  // 获取成长体系配置（从世界定义读取，不存入 GameState）
  const worldDef = findWorldDef((gameState as any).selectedWorld);
  const progressionConfig = worldDef?.modules?.find(m => m.moduleId === 'progression' && m.enabled)?.moduleConfig;

  // 从世界定义的模块 moduleConfig 构建世界系统数据（用于生成模块更新规则）
  const worldSystemFromDef: Record<string, unknown> = {};
  if (worldDef?.modules) {
    const keyMap: Record<string, string> = {
      stat: '数值属性', survival: '生存资源', business: '经营资产', dice: '骰子检定', talent: '天赋体系',
    };
    for (const mod of worldDef.modules) {
      if (mod.enabled && mod.moduleConfig && keyMap[mod.moduleId]) {
        worldSystemFromDef[keyMap[mod.moduleId]] = mod.moduleConfig;
      }
    }
  }

  const variableUpdatePrompt = buildVariableExtractionPrompt(worldSystemFromDef, progressionConfig as Record<string, unknown>);

  return callAuxiliaryApi(config, messages, variableUpdatePrompt, signal);
}

export async function runVariableExtraction(params: {
  varMgr: VariableManager;
  parsed: ParsedResponse;
  round: number;
  userText: string;
  mainApiConfig: ApiConfig;
  worldBook: WorldBookManager | null;
  delayMs: number;
  maxRetries: number;
}): Promise<void> {
  const { varMgr, parsed, round, userText, mainApiConfig, worldBook, delayMs, maxRetries } = params;

  // 选择 API 配置：优先变量提取专用预设 > 主API
  let effectiveConfig: ApiConfig = mainApiConfig;
  try {
    const varPresetId = localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET);
    if (varPresetId) {
      const presets = loadPresets();
      const preset = presets.find(p => p.id === varPresetId);
      if (preset) {
        effectiveConfig = { ...preset.config };
      }
    }
  } catch { /* localStorage 不可用时 fallback */ }

  // 等待可配置的延迟（管线执行器已保证记忆任务先于此阶段完成）
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let updateText: string | null = null;

      // 始终通过独立 API 调用提取变量（正文和变量完全分离）
      if (parsed.content) {
        updateText = await callAuxiliaryApiForEngine(
          effectiveConfig,
          worldBook,
          varMgr.createSafeSnapshotForPrompt(),
          userText,
          parsed.content,
        );
      }

      if (updateText) {
        // callAuxiliaryApi 已负责从 <UpdateVariable> 标签或裸 JSON 中提取内容
        // 这里做一层兜底：如果返回的还带标签，再剥一次
        let jsonContent = updateText;
        const tagMatch = updateText.match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i);
        if (tagMatch) {
          jsonContent = tagMatch[1].trim();
        }

        const applied = varMgr.applyUpdateVariable(jsonContent);
        if (!applied) {
          console.warn('[变量提取] applyUpdateVariable 返回 false，JSON 解析失败。内容前200字:', jsonContent.slice(0, 200));
        }
      } else if (parsed.content) {
        console.warn('[变量提取] 辅助 API 未返回有效的变量更新内容');
      }

      eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
      return;
    } catch (err: unknown) {
      lastError = err;
      console.warn(`[变量提取] 第 ${attempt + 1}/${maxRetries + 1} 次失败:`, (err as Error).message || err);
      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }

  console.warn('[变量提取] 全部重试失败:', (lastError as Error)?.message || lastError);
  eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
}
