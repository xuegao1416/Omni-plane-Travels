import { useEffect, useRef } from 'react';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { SurvivalModuleSchema } from '../../../../modules/schema';
import { settleSurvivalCycle } from '../../../../gameplay/modules/survival';
import { getBusinessSettlementPeriodKey } from '../../../../time/businessPeriod';
import { getTimeSystemFromWorld } from '../../../../time/worldClock';
import { isCombatInteractionPaused } from '../../../../gameplay/combatRuntime';

export interface ResourceChangeLog {
  tick: number;
  timestamp: number;
  changes: Array<{
    resourceId: string;
    resourceName: string;
    symbol: string;
    before: number;
    after: number;
    reason: string;
  }>;
}

const MAX_LOG_ENTRIES = 50;

export function useSurvivalSettlement(
  engine: GameEngine,
  worldDef: WorldDef | undefined,
  bumpVersion: () => void,
) {
  const logRef = useRef<ResourceChangeLog[]>([]);
  const localTickRef = useRef(0);

  useEffect(() => {
    const config = worldDef?.modules?.find(
      module => module.moduleId === 'survival' && module.enabled,
    )?.moduleConfig as SurvivalModuleSchema | undefined;
    if (!config) return;
    const clockConfig = getTimeSystemFromWorld(worldDef);

    const metadata = new Map(config.resources.map(resource => [resource.id, resource]));
    const handler = () => {
      const state = engine.variableManager.getState();
      if (isCombatInteractionPaused(state)) return;
      if (!state.玩家.生存资源) return;
      localTickRef.current = Math.max(localTickRef.current + 1, state.simulationRuntime?.tick ?? 0);
      const tick = localTickRef.current;
      const cycleName = config.rules?.cycleName || '回合';
      const turnKey = String(state.世界.时间系统.时钟?.elapsedMinutes ?? tick);
      const periodKey = getBusinessSettlementPeriodKey(
        cycleName,
        state.世界.时间系统.当前时间 || '',
        turnKey,
        state.世界.时间系统.时钟,
        clockConfig,
      );
      if (!periodKey || state.gameplay?.settlementKeys.survival === periodKey) return;
      if (!state.gameplay?.settlementKeys.survival && !/回合|轮/.test(cycleName)) {
        state.gameplay!.settlementKeys.survival = periodKey;
        engine.variableManager.setState(state);
        return;
      }
      const result = settleSurvivalCycle(state, config, { tick, enabledModules: ['survival'] }, periodKey);
      if (result.status !== 'applied') return;

      const changes: ResourceChangeLog['changes'] = result.changes
        .filter(change => change.path.startsWith('玩家.生存资源.') && change.path.endsWith('.数量'))
        .map(change => {
          const resourceId = change.path.split('.')[2] ?? '';
          const resource = metadata.get(resourceId);
          return {
            resourceId,
            resourceName: resource?.name ?? resourceId,
            symbol: resource?.symbol ?? '',
            before: Number(change.before) || 0,
            after: Number(change.after) || 0,
            reason: `周期消耗 ${Number(change.after) - Number(change.before)}`,
          };
        });
      for (const event of result.events) {
        if (event.type !== 'survival.critical' && event.type !== 'survival.depleted') continue;
        const resourceId = String(event.payload?.resourceId ?? '');
        const resource = metadata.get(resourceId);
        const amount = Number(event.payload?.amount) || 0;
        changes.push({
          resourceId,
          resourceName: resource?.name ?? resourceId,
          symbol: resource?.symbol ?? '',
          before: amount,
          after: amount,
          reason: event.type === 'survival.depleted' ? '资源已耗尽' : '资源即将耗尽',
        });
      }

      engine.variableManager.setState(result.state);
      if (changes.length > 0) {
        logRef.current.push({ tick, timestamp: Date.now(), changes });
        if (logRef.current.length > MAX_LOG_ENTRIES) logRef.current = logRef.current.slice(-MAX_LOG_ENTRIES);
      }
      bumpVersion();
    };

    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, handler);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, handler); };
  }, [engine, worldDef, bumpVersion]);

  return {
    getChangeLog: () => logRef.current,
    clearChangeLog: () => { logRef.current = []; },
  };
}
