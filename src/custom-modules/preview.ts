import { createDefaultGameState, type GameState } from '../schema/variables';
import type { CustomGameplayModuleDefinition } from './schema';
import type { CustomModuleLifecycle } from './runtime';
import { executeCustomModuleInGame, type CustomModuleGameExecutionOptions } from './hostRuntime';
import { normalizeCustomGameplayModule } from './normalize';

export function simulateCustomModule(module: CustomGameplayModuleDefinition, gameState: GameState,
  lifecycle: CustomModuleLifecycle, options: CustomModuleGameExecutionOptions) {
  return executeCustomModuleInGame(gameState, module, lifecycle, options);
}

export function createCustomModulePreviewState(module: CustomGameplayModuleDefinition): GameState {
  return createCustomModulePreview(module).gameState;
}

export function createCustomModulePreview(module: CustomGameplayModuleDefinition) {
  const state = createDefaultGameState();
  state.玩家.货币资源.主货币.数量 = 100;
  const normalized = normalizeCustomGameplayModule(module);
  if (!normalized.ok) return { gameState: state, applied: 0, warnings: normalized.errors.map(error => error.message) };
  for (const item of Object.values(normalized.data.items)) {
    state.玩家.物品栏[item.name] = { 数量: 10, 类型: item.category ?? '物品', 品质: '普通', 备注: item.description ?? '' };
  }
  state.玩家.生存资源 = {};
  for (const rules of Object.values(normalized.data.logic)) for (const rule of rules) for (const action of rule.actions) {
    if ('resourceId' in action) state.玩家.生存资源[action.resourceId] = { 数量: 100, 最大值: 100 };
  }
  for (const binding of Object.values(normalized.data.inputs)) {
    const match = /^player\.survival\.([A-Za-z][A-Za-z0-9_]*)\./.exec(typeof binding === 'string' ? binding : binding.path);
    if (match) state.玩家.生存资源[match[1]] = { 数量: 100, 最大值: 100 };
  }
  return executeCustomModuleInGame(state, normalized.data, 'onGameStart', { eventId: 'preview:start', now: 0 });
}
