import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { BusinessModuleSchema, SurvivalModuleSchema } from '../modules/schema';
export interface ResourceChangeLog { tick: number; timestamp: number; changes: Array<{ resourceId: string; resourceName: string; symbol: string; before: number; after: number; reason: string }> }
import { isCombatInteractionPaused } from '../gameplay/combatRuntime';
import { prepareGameplayState } from '../gameplay/statePreparation';
import { settleBusinessCycle } from '../gameplay/modules/business';
import { settleSurvivalCycle } from '../gameplay/modules/survival';
import { getBusinessSettlementPeriodKey } from '../time/businessPeriod';
import { getTimeSystemFromWorld } from '../time/worldClock';

/** Successful turn settlement belongs to the turn, never to React mount/event timing. */
export function settleTurnCycles(input: GameState, world: WorldDef | undefined, turnId: string, round: number) {
  if (!world || isCombatInteractionPaused(input)) return { state: input, changeLog: undefined };
  let state = prepareGameplayState(input, world.modules ?? [], { mode: 'load' }).state;
  const clockConfig = getTimeSystemFromWorld(world);
  const business = world.modules?.find(module => module.moduleId === 'business' && module.enabled)?.moduleConfig as BusinessModuleSchema | undefined;
  const assets = state.玩家.经营资产;
  if (business && assets) {
    for (const asset of assets.资产列表) if (!['active', 'idle', 'damaged', 'destroyed'].includes(asset.状态)) asset.状态 = 'active';
    const cycle = business.cycleName || '天';
    const key = getBusinessSettlementPeriodKey(cycle, state.世界.时间系统.当前时间 || '', turnId, state.世界.时间系统.时钟, clockConfig);
    if (key && assets.上次结算周期 !== key) {
      if (!assets.上次结算周期 && !/回合|轮/.test(cycle)) assets.上次结算周期 = key;
      else {
        const result = settleBusinessCycle(state, business, key, { tick: state.simulationRuntime?.tick ?? round, enabledModules: ['business'] });
        if (result.execution.status === 'applied') state = result.execution.state;
      }
    }
  }
  let changeLog: ResourceChangeLog | undefined;
  const survival = world.modules?.find(module => module.moduleId === 'survival' && module.enabled)?.moduleConfig as SurvivalModuleSchema | undefined;
  if (survival && state.玩家.生存资源) {
    const tick = state.simulationRuntime?.tick ?? round;
    const cycle = survival.rules?.cycleName || '回合';
    const turnKey = turnId;
    const key = getBusinessSettlementPeriodKey(cycle, state.世界.时间系统.当前时间 || '', turnKey, state.世界.时间系统.时钟, clockConfig);
    if (key && state.gameplay?.settlementKeys.survival !== key) {
      if (!state.gameplay?.settlementKeys.survival && !/回合|轮/.test(cycle)) state.gameplay!.settlementKeys.survival = key;
      else {
        const result = settleSurvivalCycle(state, survival, { tick, enabledModules: ['survival'] }, key);
        if (result.status === 'applied') {
          state = result.state;
          const metadata = new Map(survival.resources.map(resource => [resource.id, resource]));
          const changes: ResourceChangeLog['changes'] = result.changes.filter(change => change.path.startsWith('玩家.生存资源.') && change.path.endsWith('.数量')).map(change => {
            const resourceId = change.path.split('.')[2] ?? ''; const resource = metadata.get(resourceId);
            return { resourceId, resourceName: resource?.name ?? resourceId, symbol: resource?.symbol ?? '', before: Number(change.before) || 0, after: Number(change.after) || 0, reason: `周期消耗 ${Number(change.after) - Number(change.before)}` };
          });
          for (const event of result.events) {
            if (event.type !== 'survival.critical' && event.type !== 'survival.depleted') continue;
            const resourceId = String(event.payload?.resourceId ?? ''); const resource = metadata.get(resourceId); const amount = Number(event.payload?.amount) || 0;
            changes.push({ resourceId, resourceName: resource?.name ?? resourceId, symbol: resource?.symbol ?? '', before: amount, after: amount, reason: event.type === 'survival.depleted' ? '资源已耗尽' : '资源即将耗尽' });
          }
          if (changes.length) changeLog = { tick, timestamp: Date.now(), changes };
        }
      }
    }
  }
  return { state, changeLog };
}
