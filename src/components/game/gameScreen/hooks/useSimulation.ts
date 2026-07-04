import { useState, useEffect, useCallback } from 'react';
import { getSimulationEngine, setWorldContext } from '../../../../simulation/SimulationApi';
import { extractWorldContext } from '../../../../simulation/worldContext';
import { useSimulationStore } from '../../../../stores/simulationStore';
import { useSaveStore } from '../../../../stores/saveStore';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ApiConfig } from '../../../../api/types';
import type { SimulationRules } from '../../../../modules/schema';

/** 从世界定义中获取仿真规则 */
function getSimRules(worldDef: WorldDef | undefined): SimulationRules | null {
  if (!worldDef?.modules) return null;
  const simMod = worldDef.modules.find(m => m.moduleId === 'simulation' && m.enabled);
  return (simMod?.moduleConfig as unknown as SimulationRules) ?? null;
}

export function useSimulation(
  engine: GameEngine,
  worldDef: WorldDef | undefined,
  apiConfig: ApiConfig | null,
) {
  const simEngine = getSimulationEngine();
  const [isSimulating, setIsSimulating] = useState(false);

  // 当世界变化时，提取世界书语义上下文并注入引擎
  useEffect(() => {
    if (!worldDef) return;
    const ctx = extractWorldContext(
      worldDef.worldBookEntries,
      worldDef.name,
      worldDef.description ?? '',
    );
    setWorldContext(ctx);
  }, [worldDef?.id]);

  // 当主 API 配置变更时更新引擎
  useEffect(() => {
    if (apiConfig) simEngine.setApiConfig(apiConfig);
  }, [apiConfig]);

  // 自动推演：已移至 useGameEngine.ts 中执行（在变量提取之前）
  // 这里只保留手动推演功能

  // 手动推演
  const handleManualTick = useCallback(async () => {
    if (!simEngine.effectiveApiConfig || isSimulating) return;
    setIsSimulating(true);
    try {
      // 同步 store 配置到引擎
      simEngine.state.config = { ...useSimulationStore.getState().simState.config };

      const gs = engine.variableManager.getState();
      const gameTime = {
        current: gs.世界?.时间系统?.当前时间 ?? '',
      };
      const round = engine.messages.length;
      const worldDesc = worldDef?.description ?? worldDef?.name ?? '未知世界';
      const simRules = getSimRules(worldDef);

      // 强制 tick（跳过 shouldTick 检查）
      simEngine.state.config.lastSimulatedTime = '';
      simEngine.state.config.lastAutoTickRound = 0;
      await simEngine.tick(gs, gameTime, round, worldDesc, undefined, simRules);
      useSimulationStore.getState().setSimState(simEngine.state);
      useSaveStore.getState().scheduleAutoSave();
    } catch (err) {
      console.warn('[WorldSim] 手动推演失败:', err);
    } finally {
      setIsSimulating(false);
    }
  }, [isSimulating, engine, simEngine, worldDef]);

  return { isSimulating, handleManualTick };
}
