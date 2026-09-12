import { useState,useEffect,useCallback } from 'react';
import { getSimulationEngine,requestDirectorReview,setWorldContext } from '../../../../simulation/SimulationApi';
import { extractWorldContext } from '../../../../simulation/worldContext';
import { useSimulationStore } from '../../../../stores/simulationStore';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ApiConfig } from '../../../../api/types';
import { isCombatInteractionPaused } from '../../../../gameplay/combatRuntime';

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
    if (isCombatInteractionPaused(engine.variableManager.getState())) return;
    setIsSimulating(true);
    try {
      // 同步 store 配置到引擎
      simEngine.state.config = { ...useSimulationStore.getState().simState.config };

      // 手动按钮复用已提交正文的审查通道，强制后台分支执行一次。
      // 这样不会绕过回合身份/快照校验，也不会重新引入已废弃的 engine.tick。
      await requestDirectorReview('background');
    } catch (err) {
      console.warn('[WorldSim] 手动推演失败:', err);
    } finally {
      setIsSimulating(false);
    }
  }, [isSimulating, engine, simEngine, worldDef]);

  return { isSimulating, handleManualTick };
}
