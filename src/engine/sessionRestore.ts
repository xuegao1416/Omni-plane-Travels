import type { GameSave } from '../storage/db';
import type { WorldDef } from '../data/worlds-schema';
import { VariableManager } from './variableManager';
import { ensureWorldClockOnGameState, getTimeSystemFromWorld } from '../time/worldClock';
import { prepareGameplayState } from '../gameplay/statePreparation';
import { normalizeGameStateV3, synchronizeV3FeatureFlagsForWorld } from '../gameplay/protocols';
import { isProfessionModuleEnabled } from '../gameplay/profession/featureGate';

/**
 * 把一份已解码的存档恢复成可运行的变量管理器。
 * 读档、导入后的继续游玩与存档兼容测试共用这一条路径，保证测试覆盖的正是玩家读档时走的代码。
 */
export function restoreGameplayManager(save: Pick<GameSave, 'id' | 'gameState' | 'moduleStates' | 'moduleCheckpoints' | 'personalInfo'>, worldDef: WorldDef | undefined): VariableManager {
  const migratedClockState = ensureWorldClockOnGameState(save.gameState, worldDef);
  const clockConfig = getTimeSystemFromWorld(worldDef);
  const manager = VariableManager.fromJSON({
    state: migratedClockState,
    saveId: save.id,
    moduleStates: save.moduleStates,
    moduleCheckpoints: save.moduleCheckpoints,
  }, clockConfig);
  const normalized = ensureWorldClockOnGameState(manager.getState(), worldDef);
  const prepared = prepareGameplayState(normalizeGameStateV3(normalized), worldDef?.modules, { mode: 'load' }).state;
  const synchronized = synchronizeV3FeatureFlagsForWorld(prepared, {
    professionsEnabled: isProfessionModuleEnabled(worldDef),
    combatEnabled: worldDef?.modules?.some(module => typeof module === 'string'
      ? module === 'combat'
      : module.moduleId === 'combat' && module.enabled) === true,
    fallbackRiskMode: save.personalInfo?.combatRiskMode ?? 'normal',
  });
  manager.setState(synchronized);
  manager.setWorldClockConfig(clockConfig);
  manager.bindWorld(worldDef);
  return manager;
}
