import { useEffect } from 'react';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { BusinessModuleSchema } from '../../../../modules/schema';
import { getBusinessSettlementPeriodKey } from '../../../../time/businessPeriod';
import { getTimeSystemFromWorld } from '../../../../time/worldClock';
import { settleBusinessCycle } from '../../../../gameplay/modules/business';
import { prepareGameplayState } from '../../../../gameplay/migrations';
import { isCombatInteractionPaused } from '../../../../gameplay/combatRuntime';

export { getBusinessSettlementPeriodKey as settlementPeriodKey };

/** 经营资产按世界时钟周期做确定性结算，所有资金和资产状态一次提交。 */
export function useBusinessSettlement(
  engine: GameEngine,
  worldDef: WorldDef | undefined,
  bumpVersion: () => void,
) {
  useEffect(() => {
    const handler = (turnId?: string) => {
      if (isCombatInteractionPaused(engine.variableManager.getState())) return;
      const config = worldDef?.modules?.find(
        module => module.moduleId === 'business' && module.enabled,
      )?.moduleConfig as BusinessModuleSchema | undefined;
      if (!config || !worldDef) return;
      const clockConfig = getTimeSystemFromWorld(worldDef);

      const prepared = prepareGameplayState(engine.variableManager.getState(), worldDef.modules ?? [], { mode: 'load' }).state;
      const runtime = prepared.玩家.经营资产;
      if (!runtime) return;
      for (const asset of runtime.资产列表) {
        if (!['active', 'idle', 'damaged', 'destroyed'].includes(asset.状态)) asset.状态 = 'active';
      }

      const cycleName = config.cycleName || '天';
      const periodKey = getBusinessSettlementPeriodKey(
        cycleName,
        prepared.世界.时间系统.当前时间 || '',
        turnId,
        prepared.世界.时间系统.时钟,
        clockConfig,
      );
      if (!periodKey || runtime.上次结算周期 === periodKey) return;

      // 自然时间制以首次观察为基线，避免读档后平白补发一期收益。
      if (!runtime.上次结算周期 && !/回合|轮/.test(cycleName)) {
        runtime.上次结算周期 = periodKey;
        engine.variableManager.setState(prepared);
        return;
      }

      const result = settleBusinessCycle(prepared, config, periodKey, {
        tick: prepared.simulationRuntime?.tick ?? 0,
        enabledModules: ['business'],
      });
      if (result.execution.status !== 'applied') return;
      engine.variableManager.setState(result.execution.state);
      bumpVersion();
    };

    eventBus.on(EVENTS.GENERATION_ENDED, handler);
    return () => { eventBus.off(EVENTS.GENERATION_ENDED, handler); };
  }, [engine, worldDef, bumpVersion]);
}
