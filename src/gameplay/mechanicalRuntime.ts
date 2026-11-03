/** Deterministic gameplay settlement; no narrative planning or model requests. */
import type { SimulationState, GameTime, MechanicsSettlement, MechanicalNotifications } from '../simulation/types';
import type { WorldDynamics, ModuleEffects, EffectLogEntry, ResourceEvolutionStep, Literal, WorldContext } from '../modules/schema';
import { createDefaultSimulationRuntimeState } from '../modules/schema';
import { advanceGameplayEvents, consumeGameplayEvents, getGameplayPath } from './kernel';
import type { GameState } from '../schema/variables';
import { EventWorldEvolution, eventWorldEvolution, collectAddEventEvents, collectCombatEncounterRequests, collectScheduledTickEntries, getPeriodicRules } from '../modules/eventIntegration';
import { getWebEvent } from '../modules/eventDb';
import { readCanonicalEventPack } from '../modules/eventPackFormat';
import { checkCondition, applyAction } from '../modules/ruleEngine';
import { eventBus, EVENTS } from '../engine/eventBus';

export async function emitCanonicalEventCard(
  eventId: string,
  eventPackIds: readonly string[],
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  for (const eventPackId of eventPackIds) {
    const record = await getWebEvent(eventPackId);
    if (!isCurrent()) return false;
    if (!record) continue;
    const view = readCanonicalEventPack(record.files);
    if (!view.workflowByEventId.has(eventId)) continue;
    eventBus.emit(EVENTS.EVENT_CARD, { cardId: eventId, eventPackId });
    return true;
  }
  return false;
}

export class MechanicalRuntime {
  constructor(public state: SimulationState) {}


  /** 本地结算只修改调用方提供的副本；调用方通过变量事务提交返回状态。 */
  async settleMechanics(
    gameState: GameState,
    gameTime: GameTime,
    round: number,
    _worldSetting: string,
    _simRules?: WorldDynamics | null,
    resources?: ResourceEvolutionStep[],
    turnId = `round:${round}`,
  ): Promise<MechanicsSettlement> {
    const clock = this.state.mechanics ?? {
      lastTurnId: '', lastRound: -1,
      lastTime: '', tickCount: gameState.simulationRuntime?.tick ?? 0,
    };
    const notifications: MechanicalNotifications = { eventCards: [], combatRequests: [] };
    // Every accepted foreground turn advances the local clock. AI cadence/time gates
    // apply only to background requests; module intervalTicks/offsetTicks govern effects.
    if (clock.lastTurnId === turnId || round <= clock.lastRound) {
      return { gameState, mechanicalEffects: {}, effectLog: [], settled: false, notifications };
    }
    // Proposed clock is committed only after the caller accepts the variable transaction.
    const nextClock = { lastTurnId: turnId, lastRound: round, lastTime: gameTime.current, tickCount: clock.tickCount + 1 };
    gameState.simulationRuntime ??= createDefaultSimulationRuntimeState();
    gameState.simulationRuntime.tick = nextClock.tickCount;
    const mechanical = this.resolveMechanicalEffects(gameState, notifications);
    this.evaluateDeterministicEventRules(gameState, nextClock.tickCount, notifications);
    const resourceResult = this.resolveResourceEvolution(gameState, resources);
    this.mergeModuleEffects(mechanical.effects, resourceResult.effects);
    mechanical.log.push(...resourceResult.log);
    if (gameState.simulationRuntime) {
      gameState.simulationRuntime.tick = nextClock.tickCount;
      gameState.simulationRuntime.effectLog = [...gameState.simulationRuntime.effectLog, ...mechanical.log].slice(-100);
    }
    return { gameState, mechanicalEffects: mechanical.effects, effectLog: mechanical.log, settled: true, notifications, nextMechanics: nextClock };
  }


  /** Only commit the local clock after the state transaction has succeeded. */
  commitMechanics(settlement: MechanicsSettlement): boolean {
    const next = settlement.nextMechanics;
    if (!settlement.settled || !next) return false;
    const current = this.state.mechanics;
    if (current && (current.lastTurnId === next.lastTurnId || current.tickCount >= next.tickCount)) return false;
    this.state.mechanics = { ...next };
    return true;
  }


  /** 卡片/战斗通知只能在变量事务被接受后发布。 */
  async publishMechanicalEvents(settlement: MechanicsSettlement, isCurrent: () => boolean = () => true): Promise<void> {
    const notifications = settlement.notifications;
    // Consume before awaiting IndexedDB so retrying publish cannot duplicate UI effects.
    settlement.notifications = { eventCards: [], combatRequests: [] };
    for (const event of notifications.eventCards) {
      if (!isCurrent()) return;
      const packs = [event.eventPackId];
      if (!eventWorldEvolution.has(event.eventPackId)) packs.push(...eventWorldEvolution.list().map(pack => pack.eventPackId));
      await emitCanonicalEventCard(event.eventId, packs, isCurrent);
    }
    for (const request of notifications.combatRequests) {
      if (!isCurrent()) return;
      eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, request);
    }
  }



  /**
   * 在外部模拟请求前执行只依赖 tick 起始状态的事件包规则。
   *
   * EventRule 的输入只有 WorldContext 和本 tick 已到期的 scheduled 事件；
   * AI 生成的事件/世界状态由下方 worldStateRules 单独在生成结果后处理。
   * 因此本地规则应与外部 LLM 解耦，并且每个 tick 只允许经过这一处求值。
   */
  private evaluateDeterministicEventRules(gameState: GameState, tick: number, notifications: MechanicalNotifications): void {
    try {
      let runtime = gameState.simulationRuntime;
      const tickEvents: Array<{ type: string; where?: Record<string, Literal> }> = [];

      const advancedGameplay = advanceGameplayEvents(gameState, tick);
      gameState.gameplay = advancedGameplay.state.gameplay;
      const gameplayEvents = gameState.gameplay?.pendingEvents ?? [];
      for (const event of gameplayEvents) {
        tickEvents.push({
          type: event.type,
          where: event.payload as Record<string, Literal> | undefined,
        });
      }

      if (runtime?.scheduledTicks?.length) {
        const due = runtime.scheduledTicks.filter(e => e.scheduledAt <= tick);
        runtime.scheduledTicks = runtime.scheduledTicks.filter(e => e.scheduledAt > tick);
        for (const entry of due) {
          tickEvents.push({
            type: (entry.payload?.type as string) ?? 'scheduled',
            where: entry.payload?.where as Record<string, Literal> | undefined,
          });
        }
      }

      const isolatedRules = new EventWorldEvolution();
      for (const pack of eventWorldEvolution.list()) {
        isolatedRules.registerPack({ ...pack,
          runtime: JSON.parse(JSON.stringify(runtime?.eventRuntimes?.[pack.eventPackId] ?? pack.runtime)),
        });
      }
      const { ctx, results, packRuntimes } = isolatedRules.evaluateTick(
        gameState as unknown as WorldContext,
        tick,
        tickEvents,
      );
      const live = gameState as unknown as Record<string, unknown>;
      for (const key of Object.keys(ctx)) {
        live[key] = (ctx as Record<string, unknown>)[key];
      }
      // Rule evaluation returns an immutable context copy; do not write the detached old runtime.
      runtime = gameState.simulationRuntime;
      if (gameplayEvents.length > 0) {
        const consumed = consumeGameplayEvents(gameState, event => gameplayEvents.some(item => item.id === event.id));
        gameState.gameplay = consumed.state.gameplay;
      }

      if (packRuntimes && runtime) {
        runtime.eventRuntimes = packRuntimes;
      }

      try {
        const addEventActions = [
          ...collectAddEventEvents(results),
          ...(runtime?.pendingAddEvents ?? []),
        ];
        if (runtime) runtime.pendingAddEvents = [];

        notifications.eventCards.push(...addEventActions);
        notifications.combatRequests.push(...collectCombatEncounterRequests(results));
      } catch (addEventErr) {
        console.warn('[WorldSim] Mod 事件广播失败（已忽略）:', addEventErr);
      }

      try {
        const scheduled = collectScheduledTickEntries(results);
        if (scheduled.length > 0 && runtime) {
          runtime.scheduledTicks = [...(runtime.scheduledTicks ?? []), ...scheduled];
        }
      } catch (scheduledErr) {
        console.warn('[WorldSim] Mod scheduleTick 收集失败（已忽略）:', scheduledErr);
      }
    } catch (err) {
      console.warn('[WorldSim] Mod 规则求值失败（已隔离，不影响内核）:', err);
    }
  }


  // ─── 机械层结算 ───

  /**
   * 机械层结算：周期事件（事件效果匹配已移至事件包系统）
   * 不经 AI，直接确定性结算
   *
   * @param gameState 当前游戏状态
   * @param rules 世界演化规则
   * @returns 机械层效果 + 效果日志
   */
  resolveMechanicalEffects(
    gameState: GameState,
    notifications: MechanicalNotifications = { eventCards: [], combatRequests: [] },
  ): { effects: ModuleEffects; log: EffectLogEntry[] } {
    const runtime = gameState.simulationRuntime;
    if (!runtime) {
      return { effects: {}, log: [] };
    }

    const mergedEffects: ModuleEffects = {};
    const effectLog: EffectLogEntry[] = [];
    const currentTick = runtime.tick;

    // 1. 周期事件结算（从事件系统的周期注册表读取，沿用原计数器/merge 逻辑）
    for (const periodic of getPeriodicRules()) {
      // 推进计数器
      const counter = (runtime.periodicCounters[periodic.id] ?? 0) + 1;
      runtime.periodicCounters[periodic.id] = counter;

      // 计算下次触发时间（考虑 offset）
      const offset = periodic.offsetTicks ?? 0;
      const effectiveCounter = counter - offset;

      // 到达触发时间
      if (effectiveCounter > 0 && effectiveCounter % periodic.intervalTicks === 0) {
        // 条件守卫：如果周期规则有 when 条件，先检查是否满足
        if (periodic.when) {
          const ctx = gameState as unknown as WorldContext;
          if (!checkCondition(periodic.when, ctx)) {
            // 条件不满足，跳过本次周期触发
            continue;
          }
        }

        const periodicActions: import('../modules/schema').Action[] = periodic.actions ?? [];

        if (periodicActions.length > 0) {
          const ctx = gameState as unknown as WorldContext;
          const applied: import('../modules/ruleEngine').AppliedAction[] = [];
          for (const action of periodicActions) {
            try {
              const path = 'set' in action ? action.set.path : 'modifyResource' in action
                ? (gameState.玩家?.生存资源?.[action.modifyResource.key]
                    ? `玩家.生存资源.${action.modifyResource.key}.数量`
                    : `resources.${action.modifyResource.key}.amount`) : undefined;
              const before = path ? getGameplayPath(gameState, path) : undefined;
              applyAction(action, ctx, applied, periodic.id);
              const after = path ? getGameplayPath(gameState, path) : undefined;
              if (path && JSON.stringify(before) !== JSON.stringify(after)) {
                const display = (value: unknown): string | number => typeof value === 'number' || typeof value === 'string'
                  ? value : JSON.stringify(value) ?? '未设置';
                effectLog.push({ tick: currentTick, source: 'periodic', ruleId: periodic.id,
                  module: 'worldState', variable: path, before: display(before), after: display(after),
                  reason: `周期事件: ${periodic.name ?? periodic.id}（已本地结算，勿重复应用）` });
              }
            } catch (e) {
              console.warn(`[周期规则] 动作执行失败 (${periodic.id}):`, e);
            }
          }
          // addEvent 存入 pendingAddEvents（async 段统一处理）；scheduleTick 写入 runtime
          for (const a of applied) {
            try {
              if (a.kind === 'addEvent') {
                const eventId = (a.detail as { eventId?: string }).eventId ?? '';
                if (eventId) {
                  if (!runtime.pendingAddEvents) runtime.pendingAddEvents = [];
                  runtime.pendingAddEvents.push({ eventId, eventPackId: periodic.id });
                }
              } else if (a.kind === 'scheduleTick') {
                const d = a.detail as { after: number; payload?: Record<string, unknown> };
                if (runtime) {
                  if (!runtime.scheduledTicks) runtime.scheduledTicks = [];
                  runtime.scheduledTicks.push({ scheduledAt: currentTick + d.after, ruleId: a.ruleId, payload: d.payload });
                }
              } else if (a.kind === 'requestCombat') {
                notifications.combatRequests.push(a.detail as import('../gameplay/protocols').CombatEncounterRequest);
              }
            } catch { /* 逐条隔离 */ }
          }
        }

      }
    }

    // 注：周期事件（periodicEvents）已作为周期卡搬入事件系统（eventWorldEvolution），
    // 此处机械层仅负责从周期注册表读取并按 tick 静默结算（沿用 mergeModuleEffects）。
    // 事件触发职责亦由事件包系统（事件卡）承担，内核不再内置 eventEffects 匹配，
    // 避免与原生事件卡双触发（-400 坑）。

    return { effects: mergedEffects, log: effectLog };
  }


  /**
   * 资源演化蓝图机械结算（不经 AI，确定性触发）
   *
   * 两层触发机制：
   * - 层A 游戏内动态：活跃事件文本或玩家本轮对话命中 step.trigger.keywords
   * - 层B 轮次兜底：currentTick >= step.afterRounds 时强制触发
   * 满足其一即触发，且每个 step 仅触发一次（记录在 simulationRuntime.evolvedSteps）。
   *
   * @param gameState 当前游戏状态（用于读取 simulationRuntime）
   * @param steps 资源演化蓝图步骤
   * @param recentNarrative 玩家本轮对话文本（用于层A关键词匹配）
   * @returns 机械层效果 + 效果日志
   */
  private resolveResourceEvolution(
    gameState: GameState,
    steps: ResourceEvolutionStep[] | undefined,
  ): { effects: ModuleEffects; log: EffectLogEntry[] } {
    const runtime = gameState.simulationRuntime;
    if (!runtime || !steps || steps.length === 0) {
      return { effects: {}, log: [] };
    }

    const mergedEffects: ModuleEffects = {};
    const effectLog: EffectLogEntry[] = [];
    const currentTick = runtime.tick;
    const evolvedSteps = runtime.evolvedSteps ?? (runtime.evolvedSteps = []);

    // 混合记忆含伏笔、联系和计划，不能作为已发生的机械触发依据。
    const memoryText = Object.values(this.state.events)
      .filter(e => e.factStatus === 'confirmed' && e.status === 'active')
      .map(e => `${e.title} ${e.description}`).join(' ').toLowerCase();

    for (const step of steps) {
      if (evolvedSteps.includes(step.id)) continue; // 已触发过，跳过

      let triggered = false;
      let reason = '';

      // 层B：轮次兜底
      if (typeof step.afterRounds === 'number' && currentTick >= step.afterRounds) {
        triggered = true;
        reason = `演化蓝图【${step.id}】轮次兜底触发（第 ${currentTick} 轮 ≥ ${step.afterRounds}）`;
      }

      // 层A：关键词动态触发（从记忆系统文本中匹配）
      if (!triggered && step.trigger?.keywords?.length) {
        const hit = step.trigger.keywords
          .map(k => k.toLowerCase())
          .find(k => memoryText.includes(k));
        if (hit) {
          triggered = true;
          reason = `演化蓝图【${step.id}】记忆系统关键词触发：「${hit}」`;
        }
      }

      if (!triggered) continue;

      // 组装 survival 效果
      const survival: NonNullable<ModuleEffects['survival']> = {};
      if (step.add?.length) {
        survival.addResources = step.add.map(r => ({
          id: r.id, name: r.name, symbol: r.symbol,
          amount: r.amount ?? 0, max: r.max, scarce: r.scarce,
          gatherRate: r.gatherRate, usage: r.usage, description: r.description,
        }));
      }
      if (step.remove?.length) {
        survival.removeResources = step.remove.map(id => ({ id }));
      }

      if (survival.addResources || survival.removeResources) {
        mergedEffects.survival = { ...mergedEffects.survival, ...survival };
        effectLog.push(...this.createEffectLogEntries(currentTick, 'periodic', step.id, { survival }, reason));
        evolvedSteps.push(step.id);
      }
    }

    return { effects: mergedEffects, log: effectLog };
  }


  /**
   * 合并模块效果（add 策略）
   */
  private mergeModuleEffects(target: ModuleEffects, source: ModuleEffects): void {
    // 合并 survival
    if (source.survival?.resources) {
      if (!target.survival) target.survival = { resources: {} };
      if (!target.survival.resources) target.survival.resources = {};
      for (const [id, change] of Object.entries(source.survival.resources)) {
        if (!target.survival.resources[id]) {
          target.survival.resources[id] = { ...change };
        } else {
          const existing = target.survival.resources[id];
          if (change.delta !== undefined) {
            existing.delta = (existing.delta ?? 0) + change.delta;
          }
          if (change.set !== undefined) {
            existing.set = change.set;
          }
        }
      }
    }

    // 合并 survival 动态新增/移除资源（演化蓝图、周期事件共用）
    if (source.survival?.addResources?.length) {
      if (!target.survival) target.survival = {};
      if (!target.survival.addResources) target.survival.addResources = [];
      target.survival.addResources.push(...source.survival.addResources);
    }
    if (source.survival?.removeResources?.length) {
      if (!target.survival) target.survival = {};
      if (!target.survival.removeResources) target.survival.removeResources = [];
      target.survival.removeResources.push(...source.survival.removeResources);
    }

    // 合并 business
    if (source.business) {
      if (!target.business) target.business = {};
      if (source.business.fundsDelta !== undefined) {
        target.business.fundsDelta = (target.business.fundsDelta ?? 0) + source.business.fundsDelta;
      }
    }

    // 合并 stats
    if (source.stats?.changes) {
      if (!target.stats) target.stats = { changes: {} };
      if (!target.stats.changes) target.stats.changes = {};
      for (const [id, change] of Object.entries(source.stats.changes)) {
        if (!target.stats.changes[id]) {
          target.stats.changes[id] = { ...change };
        } else {
          const existing = target.stats.changes[id];
          if (change.delta !== undefined) {
            existing.delta = (existing.delta ?? 0) + change.delta;
          }
          if (change.set !== undefined) {
            existing.set = change.set;
          }
        }
      }
    }

    // 合并 progression
    if (source.progression) {
      if (!target.progression) target.progression = {};
      if (source.progression.xpDelta !== undefined) {
        target.progression.xpDelta = (target.progression.xpDelta ?? 0) + source.progression.xpDelta;
      }
      if (source.progression.tierIndex !== undefined) {
        target.progression.tierIndex = source.progression.tierIndex;
      }
    }
  }


  /**
   * 创建效果日志条目
   */
  private createEffectLogEntries(
    tick: number,
    source: 'rule' | 'periodic' | 'ai' | 'npc',
    ruleId: string,
    effects: ModuleEffects,
    reason: string,
  ): EffectLogEntry[] {
    const entries: EffectLogEntry[] = [];

    // survival
    if (effects.survival?.resources) {
      for (const [id, change] of Object.entries(effects.survival.resources)) {
        entries.push({
          tick, source, ruleId,
          module: 'survival',
          variable: id,
          before: 0, // 实际值需要在应用时填充
          after: change.delta ?? change.set ?? 0,
          reason,
        });
      }
    }

    // survival 动态新增资源（演化解锁/资源发现）
    if (effects.survival?.addResources) {
      for (const res of effects.survival.addResources) {
        entries.push({
          tick, source, ruleId,
          module: 'survival',
          variable: res.id,
          before: 'N/A' as any,
          after: res.amount ?? 0,
          reason: `${reason}｜新增资源：${res.name || res.id}`,
        });
      }
    }

    // survival 动态移除资源（枯竭/被替代）
    if (effects.survival?.removeResources) {
      for (const { id } of effects.survival.removeResources) {
        entries.push({
          tick, source, ruleId,
          module: 'survival',
          variable: id,
          before: 'N/A' as any,
          after: '已移除' as any,
          reason: `${reason}｜移除资源：${id}`,
        });
      }
    }

    // business
    if (effects.business?.fundsDelta) {
      entries.push({
        tick, source, ruleId,
        module: 'business',
        variable: 'funds',
        before: 0,
        after: effects.business.fundsDelta,
        reason,
      });
    }

    // stats
    if (effects.stats?.changes) {
      for (const [id, change] of Object.entries(effects.stats.changes)) {
        entries.push({
          tick, source, ruleId,
          module: 'stats',
          variable: id,
          before: 0,
          after: change.delta ?? change.set ?? 0,
          reason,
        });
      }
    }

    // progression
    if (effects.progression) {
      if (effects.progression.xpDelta) {
        entries.push({
          tick, source, ruleId,
          module: 'progression',
          variable: 'xp',
          before: 0,
          after: effects.progression.xpDelta,
          reason,
        });
      }
    }

    return entries;
  }
}
