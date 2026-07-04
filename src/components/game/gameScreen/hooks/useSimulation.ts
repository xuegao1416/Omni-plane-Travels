import { useState, useEffect, useCallback } from 'react';
import { getSimulationEngine, setWorldContext } from '../../../../simulation/SimulationApi';
import { extractWorldContext } from '../../../../simulation/worldContext';
import { useSimulationStore } from '../../../../stores/simulationStore';
import { useSaveStore } from '../../../../stores/saveStore';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ApiConfig } from '../../../../api/types';

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

  // 自动推演：变量更新后检查是否需要 tick
  useEffect(() => {
    const handler = async () => {
      // 同步 store 配置到引擎（UI toggle 只改 store，引擎不感知）
      simEngine.state.config = { ...useSimulationStore.getState().simState.config };

      const gs = engine.variableManager.getState();
      const gameTime = {
        current: gs.世界?.时间系统?.当前时间 ?? '',
      };
      const round = engine.messages.length;

      if (!simEngine.shouldTick(gameTime, round)) return;
      if (!simEngine.effectiveApiConfig) return;

      setIsSimulating(true);
      try {
        const worldDesc = worldDef?.description ?? worldDef?.name ?? '未知世界';
        await simEngine.tick(gs, gameTime, round, worldDesc);
        // 同步到 Zustand store
        useSimulationStore.getState().setSimState(simEngine.state);
        // tick 可能耗时超过 auto-save 的 500ms debounce，
        // 导致 IndexedDB 存档中保存的是 tick 前的旧状态。
        // tick 完成后立即触发存档，确保最新状态写入 IndexedDB
        useSaveStore.getState().scheduleAutoSave();
      } catch (err) {
        console.warn('[WorldSim] 自动推演失败:', err);
      } finally {
        setIsSimulating(false);
      }
    };

    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, handler);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, handler); };
  }, [engine, apiConfig, simEngine, worldDef]);

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

      // 强制 tick（跳过 shouldTick 检查）
      simEngine.state.config.lastSimulatedTime = '';
      simEngine.state.config.lastAutoTickRound = 0;
      await simEngine.tick(gs, gameTime, round, worldDesc);
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
