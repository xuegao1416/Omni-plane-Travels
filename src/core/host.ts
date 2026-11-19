/**
 * 玩法宿主：把启用的模块装配起来，统一执行命令、效果、回合钩子、周期结算和领域事件。
 *
 * 模块之间不互相 import，只通过变量注册表、命令、领域事件和加成联动。
 * 每次操作都在状态副本上进行，结束后给出变更记录、事件、正文备注、抽卡与战斗请求，
 * 由调用方在提交状态后再发布到界面。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { ensureGameplayRuntime } from './state';
import type { GameplayEvent, GameplayLogEntry, GameplayStateRoot } from '../gameplay/types';
import { getTimeSystemFromWorld, getWorldClockIndices, type WorldClockState } from '../time/worldClock';
import { FactRegistry, type FactSpec, type WriteSource } from './facts';
import { Rng, normalizeRngState, type RngState } from './rng';
import { ModifierQuery, expireModifiers, type ModifierRecord } from './modifiers';
import { applyOpsInPlace, type CardRequest, type CommandHandler, type CommandResult, type JsonRecord, type NarrativeNote, type Op } from './ops';
import { diffStates, type StateChange } from './diff';
import { crossedCycles, type CycleTick } from './cycles';

export interface DomainEvent {
  id: string;
  type: string;
  payload: JsonRecord;
  source: string;
  turn: number;
  sequence: number;
  depth: number;
}

export interface TurnInput {
  turnId: string;
  round: number;
  userText?: string;
  /** 已接受的正文（回合结束时提供，用于关键词类触发）。 */
  narrative?: string;
  /** 本回合开始时的世界时钟（用于计算跨过的周期）。 */
  previousClock?: WorldClockState;
}

export type SummaryAudience = 'main' | 'extraction' | 'director';

export interface ModuleHookContext<C> {
  world?: WorldDef;
  config: C;
  facts: FactRegistry;
  rng: Rng;
  turn: number;
  minute: number;
  hourOfDay: number;
  source: WriteSource;
  modifiers: ModifierQuery;
  emit(type: string, payload?: JsonRecord): void;
  note(text: string, tone?: NarrativeNote['tone']): void;
  card(eventId: string, packId?: string, reason?: string): void;
  combat(request: unknown): void;
  /** 在同一份草稿上执行效果；失败返回 false（不会回退整次操作）。 */
  apply(ops: readonly Op[], source?: WriteSource): boolean;
  /** 本次操作到目前为止处理过的领域事件。 */
  events(): readonly DomainEvent[];
  warn(message: string): void;
}

export type ModuleCommand<C> = (state: GameState, args: JsonRecord, context: ModuleHookContext<C>) => CommandResult;

/** 模块会发出的领域事件（事件卡触发器 on、事件生成提示、规则编辑器都从这里取）。 */
export interface DomainEventSpec {
  type: string;
  label: string;
  /** payload 里常用字段的说明，如「id 为物资 id」。 */
  payload?: string;
}
export type ModuleEventHandler<C> = (state: GameState, event: DomainEvent, context: ModuleHookContext<C>) => void;

export interface GameplayModule<C = unknown> {
  id: string;
  label: string;
  /** 小的先执行；同值按注册顺序。 */
  order?: number;
  /** 世界启用该模块时返回规范化配置，否则返回 undefined。 */
  resolveConfig(world: WorldDef | undefined, state: GameState): C | undefined;
  /** 开局/读档：保证自身状态存在、完成旧数据迁移。必须幂等。 */
  prepare?(state: GameState, context: ModuleHookContext<C>): void;
  facts?(config: C): readonly FactSpec[];
  /** 本模块会发出的领域事件。 */
  domainEvents?(config: C): readonly DomainEventSpec[];
  commands?: Record<string, ModuleCommand<C>>;
  /** 常驻加成（不写入存档）。 */
  modifiers?(state: GameState, config: C): readonly ModifierRecord[];
  onTurnStart?(state: GameState, context: ModuleHookContext<C>, input: TurnInput): void;
  onTurnEnd?(state: GameState, context: ModuleHookContext<C>, input: TurnInput): void;
  onCycle?(state: GameState, context: ModuleHookContext<C>, cycle: CycleTick): void;
  /** 事件类型 → 处理器；支持 `prefix.*` 与 `*`。 */
  on?: Record<string, ModuleEventHandler<C>>;
  /**
   * 一次操作的效果与事件都处理完之后调用，before 是操作开始前的状态。
   * 用来对「其他来源的直接写入」（AI 改库存、事件卡加减）补发领域事件；同一操作里已经发过的不要重复发。
   */
  onSettle?(state: GameState, context: ModuleHookContext<C>, before: GameState): void;
  summarize?(state: GameState, context: ModuleHookContext<C>, audience: SummaryAudience): string | undefined;
}

export interface HostOutcome {
  state: GameState;
  status: 'applied' | 'blocked' | 'failed';
  reason?: string;
  changes: StateChange[];
  events: DomainEvent[];
  notes: NarrativeNote[];
  cards: CardRequest[];
  combats: unknown[];
  messages: string[];
  warnings: string[];
}

interface ActiveModule {
  module: GameplayModule<any>;
  config: unknown;
}

const MAX_EVENTS_PER_PASS = 96;
const MAX_EVENT_DEPTH = 5;
const MAX_LOGS = 200;
const MAX_HISTORY = 200;
const MAX_SCHEDULED = 100;
const MAX_NOTES = 24;

type RuntimeWithExtras = NonNullable<GameState['gameplay']> & {
  rng?: RngState;
  notes?: Array<NarrativeNote & { turn: number }>;
};

function clone<T>(value: T): T {
  return value === undefined || value === null || typeof value !== 'object' ? value : structuredClone(value);
}

export function hostRuntime(state: GameState): RuntimeWithExtras {
  return ensureGameplayRuntime(state as GameState & GameplayStateRoot) as RuntimeWithExtras;
}

export function currentTurn(state: GameState): number {
  return Math.max(0, Math.trunc(Number(state.simulationRuntime?.tick) || 0));
}

class Session {
  readonly queue: DomainEvent[] = [];
  readonly processed: DomainEvent[] = [];
  readonly notes: NarrativeNote[] = [];
  readonly cards: CardRequest[] = [];
  readonly combats: unknown[] = [];
  readonly messages: string[] = [];
  readonly warnings: string[] = [];
  readonly rng: Rng;
  readonly turn: number;
  readonly minute: number;
  readonly hourOfDay: number;

  transactionId: string;
  moduleId?: string;

  constructor(readonly host: GameplayHost, readonly draft: GameState, readonly source: WriteSource, readonly label: string) {
    this.transactionId = label;
    const runtime = hostRuntime(draft);
    runtime.rng = normalizeRngState(runtime.rng);
    this.rng = new Rng(runtime.rng);
    this.turn = currentTurn(draft);
    const clock = draft.世界?.时间系统?.时钟;
    const config = getTimeSystemFromWorld(host.world);
    const indices = clock ? getWorldClockIndices(clock, config) : undefined;
    this.minute = clock?.elapsedMinutes ?? 0;
    this.hourOfDay = indices?.hourOfDay ?? 8;
  }

  emit(type: string, payload: JsonRecord | undefined, source: string, depth: number): void {
    if (!type) return;
    const runtime = hostRuntime(this.draft);
    runtime.sequence += 1;
    this.queue.push({
      id: `evt:${this.turn}:${runtime.sequence}`,
      type,
      payload: clone(payload) ?? {},
      source,
      turn: this.turn,
      sequence: runtime.sequence,
      depth,
    });
  }

  /** 抽卡请求同时作为领域事件 `card.requested` 广播，由事件模块放进待处理队列。 */
  requestCard(card: CardRequest, source: string, depth: number): void {
    this.cards.push(card);
    this.emit('card.requested', {
      eventId: card.eventId,
      ...(card.packId ? { packId: card.packId } : {}),
      ...(card.reason ? { reason: card.reason } : {}),
    }, source, depth);
  }

  absorb(result: ReturnType<typeof applyOpsInPlace>, source: string, depth: number): void {
    for (const event of result.emitted) this.emit(event.type, event.payload, event.source ?? source, depth + 1);
    const runtime = hostRuntime(this.draft);
    for (const item of result.scheduled) {
      runtime.sequence += 1;
      runtime.scheduledEvents = [...runtime.scheduledEvents, {
        dueTick: this.turn + item.afterTurns,
        event: {
          id: `sched:${this.turn}:${runtime.sequence}`, type: item.type, payload: (clone(item.payload) ?? {}) as GameplayEvent['payload'],
          tick: this.turn, sequence: runtime.sequence, source: item.source ?? source, transactionId: this.transactionId,
        },
      }].slice(-MAX_SCHEDULED);
    }
    this.notes.push(...result.notes);
    for (const card of result.cards) this.requestCard(card, source, depth + 1);
    this.combats.push(...result.combats);
    this.messages.push(...result.messages);
    this.warnings.push(...result.warnings);
  }
}

export class GameplayHost {
  readonly facts: FactRegistry;
  private readonly modules: ActiveModule[];
  private readonly commandMap = new Map<string, { entry: ActiveModule; handler: ModuleCommand<unknown> }>();

  constructor(readonly world: WorldDef | undefined, modules: readonly GameplayModule<any>[], state: GameState) {
    this.modules = modules
      .map((module, index) => ({ module, config: module.resolveConfig(world, state), index }))
      .filter(entry => entry.config !== undefined)
      .sort((left, right) => (left.module.order ?? 100) - (right.module.order ?? 100) || left.index - right.index)
      .map(({ module, config }) => ({ module, config }));
    this.facts = new FactRegistry();
    for (const entry of this.modules) {
      for (const spec of entry.module.facts?.(entry.config) ?? []) this.facts.register(spec);
      for (const [name, handler] of Object.entries(entry.module.commands ?? {})) {
        this.commandMap.set(`${entry.module.id}.${name}`, { entry, handler: handler as ModuleCommand<unknown> });
      }
    }
  }

  isEnabled(moduleId: string): boolean {
    return this.modules.some(entry => entry.module.id === moduleId);
  }

  configOf<C>(moduleId: string): C | undefined {
    return this.modules.find(entry => entry.module.id === moduleId)?.config as C | undefined;
  }

  commandNames(): string[] {
    return [...this.commandMap.keys()];
  }

  /** 当前世界会发生的领域事件（只含已启用模块的），同类型去重。 */
  domainEvents(): DomainEventSpec[] {
    const seen = new Map<string, DomainEventSpec>();
    for (const entry of this.modules) {
      for (const spec of entry.module.domainEvents?.(entry.config) ?? []) if (!seen.has(spec.type)) seen.set(spec.type, spec);
    }
    return [...seen.values()];
  }

  modifierQuery(state: GameState): ModifierQuery {
    return new ModifierQuery(state, this.modules
      .filter(entry => entry.module.modifiers)
      .map(entry => (current: GameState) => entry.module.modifiers!(current, entry.config)));
  }

  private context(entry: ActiveModule, session: Session, depth: number): ModuleHookContext<unknown> {
    const sourceLabel = entry.module.id;
    // 时钟可能在同一次操作里被行动推进，按草稿实时读取。
    const clock = session.draft.世界?.时间系统?.时钟;
    const hourOfDay = clock ? getWorldClockIndices(clock, getTimeSystemFromWorld(this.world)).hourOfDay : session.hourOfDay;
    return {
      world: this.world,
      config: entry.config,
      facts: this.facts,
      rng: session.rng,
      turn: session.turn,
      minute: clock?.elapsedMinutes ?? session.minute,
      hourOfDay,
      source: session.source,
      modifiers: this.modifierQuery(session.draft),
      emit: (type, payload) => session.emit(type, payload, sourceLabel, depth + 1),
      note: (text, tone = 'fact') => { if (text.trim()) session.notes.push({ text: text.trim(), tone, source: sourceLabel }); },
      card: (eventId, packId, reason) => { if (eventId) session.requestCard({ eventId, packId, reason }, sourceLabel, depth + 1); },
      combat: request => { session.combats.push(clone(request)); },
      apply: (ops, source = 'system') => this.runOps(session, ops, source, sourceLabel, depth),
      events: () => session.processed,
      warn: message => { session.warnings.push(`[${entry.module.label}] ${message}`); },
    };
  }

  private commandsFor(session: Session, depth: number): Map<string, CommandHandler> {
    const map = new Map<string, CommandHandler>();
    for (const [name, { entry, handler }] of this.commandMap) {
      map.set(name, (state, args) => handler(state, args, this.context(entry, session, depth)));
    }
    return map;
  }

  private runOps(session: Session, ops: readonly Op[], source: WriteSource, label: string, depth: number): boolean {
    const result = applyOpsInPlace(session.draft, ops, {
      facts: this.facts,
      commands: this.commandsFor(session, depth),
      source,
      turn: session.turn,
      minute: session.minute,
      hourOfDay: session.hourOfDay,
      rng: session.rng,
      bestEffort: true,
      events: session.processed,
      sourceLabel: label,
    });
    session.absorb(result, label, depth);
    if (result.failure) session.warnings.push(result.failure);
    return !result.failure && result.warnings.length === 0;
  }

  private drain(session: Session): void {
    let processed = 0;
    while (session.queue.length > 0) {
      const event = session.queue.shift()!;
      if (++processed > MAX_EVENTS_PER_PASS) {
        session.warnings.push(`领域事件超过单次上限 ${MAX_EVENTS_PER_PASS}，其余已丢弃`);
        session.queue.length = 0;
        break;
      }
      session.processed.push(event);
      const runtime = hostRuntime(session.draft);
      runtime.eventHistory = [...runtime.eventHistory, {
        id: event.id, type: event.type, payload: event.payload as GameplayEvent['payload'], tick: event.turn,
        sequence: event.sequence, source: event.source, transactionId: session.transactionId,
      }].slice(-MAX_HISTORY);
      if (event.depth > MAX_EVENT_DEPTH) continue;
      for (const entry of this.modules) {
        const handlers = entry.module.on;
        if (!handlers) continue;
        const matched = [handlers[event.type], ...Object.entries(handlers)
          .filter(([key]) => key !== event.type && (key === '*' || (key.endsWith('.*') && event.type.startsWith(key.slice(0, -1)))))
          .map(([, handler]) => handler)].filter(Boolean) as ModuleEventHandler<unknown>[];
        for (const handler of matched) {
          try {
            handler(session.draft, event, this.context(entry, session, event.depth));
          } catch (error) {
            session.warnings.push(`[${entry.module.label}] 处理 ${event.type} 失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  }

  /**
   * 让模块按前后状态补发领域事件，再处理这些事件（最多两轮，防止互相触发停不下来）。
   * 第二轮只比较第一轮事件处理带来的新变化，同一变化不会被报两次。
   */
  private settle(original: GameState, session: Session): void {
    let before = original;
    for (let round = 0; round < 2; round++) {
      for (const entry of this.modules) {
        if (!entry.module.onSettle) continue;
        try {
          entry.module.onSettle(session.draft, this.context(entry, session, 1), before);
        } catch (error) {
          session.warnings.push(`[${entry.module.label}] 结算检查失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (session.queue.length === 0) return;
      before = clone(session.draft);
      this.drain(session);
    }
  }

  private finish(original: GameState, session: Session): HostOutcome {
    const moduleId = session.moduleId;
    const changes = diffStates(original, session.draft);
    const runtime = hostRuntime(session.draft);
    if (session.notes.length > 0) {
      runtime.notes = [...(runtime.notes ?? []), ...session.notes.map(note => ({ ...note, turn: session.turn }))].slice(-MAX_NOTES);
    }
    const produced = changes.length > 0 || session.processed.length > 0 || session.cards.length > 0 || session.combats.length > 0 || session.notes.length > 0;
    if (changes.length > 0) {
      runtime.sequence += 1;
      const log: GameplayLogEntry = {
        id: `log:${session.transactionId}:${runtime.sequence}`,
        sequence: runtime.sequence,
        tick: session.turn,
        transactionId: session.transactionId,
        ...(moduleId ? { moduleId } : {}),
        source: session.source,
        label: session.label,
        status: 'applied',
        changes: changes.map(change => ({ path: change.path, operation: change.after === undefined ? 'remove' : 'set', before: change.before, after: change.after })),
        eventIds: session.processed.map(event => event.id),
        ...(session.warnings.length > 0 ? { warnings: session.warnings.slice(0, 20) } : {}),
      };
      runtime.logs = [...runtime.logs, log].slice(-MAX_LOGS);
    }
    return {
      state: produced ? session.draft : original,
      status: produced ? 'applied' : 'blocked',
      reason: produced ? undefined : session.warnings[0] ?? '没有产生任何变化',
      changes,
      events: session.processed,
      notes: session.notes,
      cards: session.cards,
      combats: session.combats,
      messages: session.messages,
      warnings: session.warnings,
    };
  }

  private session(state: GameState, source: WriteSource, label: string): Session {
    return new Session(this, clone(state), source, label);
  }

  /** 结算 previousClock → 当前时钟之间跨过的周期；返回经过的分钟数。 */
  private runCycles(session: Session, previousClock: WorldClockState | undefined, key: string): number {
    const config = getTimeSystemFromWorld(this.world);
    const nextClock = session.draft.世界?.时间系统?.时钟;
    const cycles = crossedCycles(previousClock, nextClock, config);
    const minutes = nextClock && previousClock ? nextClock.elapsedMinutes - previousClock.elapsedMinutes : 0;
    if (minutes > 0) session.emit('time.passed', { minutes }, 'host', 0);
    for (const cycle of cycles) {
      session.emit(`time.${cycle.period}`, { count: cycle.count, index: cycle.index }, 'host', 0);
      for (const entry of this.modules) {
        if (!entry.module.onCycle) continue;
        const cycleKey = `cycle:${entry.module.id}:${cycle.key}`;
        if (hostRuntime(session.draft).settlementKeys[cycleKey]) continue;
        hostRuntime(session.draft).settlementKeys[cycleKey] = key;
        try {
          entry.module.onCycle(session.draft, this.context(entry, session, 0), cycle);
        } catch (error) {
          session.warnings.push(`[${entry.module.label}] 周期结算失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return minutes;
  }

  /** 开局或读档后调用：补齐各模块状态并迁移旧数据。不写日志。 */
  prepare(state: GameState): GameState {
    const session = this.session(state, 'system', 'prepare');
    for (const entry of this.modules) {
      try {
        entry.module.prepare?.(session.draft, this.context(entry, session, 0));
      } catch (error) {
        console.warn(`[gameplay] ${entry.module.label} 初始化失败`, error);
      }
    }
    return session.draft;
  }

  /** 执行一组效果（事件选项、规则动作、AI 更新、自创模块动作）。 */
  apply(state: GameState, ops: readonly Op[], options: { source: WriteSource; label: string; strict?: boolean; transactionId?: string; moduleId?: string }): HostOutcome {
    const session = this.session(state, options.source, options.label);
    if (options.transactionId) session.transactionId = options.transactionId;
    if (options.moduleId) session.moduleId = options.moduleId;
    const result = applyOpsInPlace(session.draft, ops, {
      facts: this.facts,
      commands: this.commandsFor(session, 0),
      source: options.source,
      turn: session.turn,
      minute: session.minute,
      hourOfDay: session.hourOfDay,
      rng: session.rng,
      bestEffort: !options.strict,
      sourceLabel: options.label,
    });
    if (result.failure && options.strict) {
      return { state, status: 'failed', reason: result.failure, changes: [], events: [], notes: [], cards: [], combats: [], messages: [], warnings: result.warnings };
    }
    session.absorb(result, options.label, 0);
    if (result.failure) session.warnings.push(result.failure);
    this.drain(session);
    // 行动消耗了时间（采集、制作、赶路）时补跑跨过的周期。
    if ((session.draft.世界?.时间系统?.时钟?.elapsedMinutes ?? 0) > (state.世界?.时间系统?.时钟?.elapsedMinutes ?? 0)) {
      this.runCycles(session, state.世界?.时间系统?.时钟, options.transactionId ?? options.label);
      this.drain(session);
    }
    this.settle(state, session);
    return this.finish(state, session);
  }

  /** 玩家或界面发起的模块命令，如 `resources.craft`、`economy.sell`；失败时整体不生效。 */
  dispatch(state: GameState, command: string, args: JsonRecord = {}, options: { source?: WriteSource; label?: string } = {}): HostOutcome {
    if (!this.commandMap.has(command)) {
      return { state, status: 'failed', reason: `当前世界未启用命令 ${command}`, changes: [], events: [], notes: [], cards: [], combats: [], messages: [], warnings: [] };
    }
    return this.apply(state, [{ op: 'command', command, args }], {
      source: options.source ?? 'player', label: options.label ?? command, strict: true, moduleId: command.split('.')[0],
    });
  }

  /** 回合开始（正文生成前）：推进回合数、投放到期的定时事件、运行模块回合钩子与事件触发。 */
  startTurn(state: GameState, input: TurnInput): HostOutcome {
    const runtime = hostRuntime(state);
    if (runtime.settlementKeys['turn.start'] === input.turnId) {
      return { state, status: 'blocked', reason: '本回合已开始', changes: [], events: [], notes: [], cards: [], combats: [], messages: [], warnings: [] };
    }
    const draft = clone(state);
    draft.simulationRuntime ??= { tick: 0, periodicCounters: {}, effectLog: [], triggeredPeriodicEvents: [], evolvedSteps: [] } as unknown as NonNullable<GameState['simulationRuntime']>;
    draft.simulationRuntime.tick = currentTurn(draft) + 1;
    hostRuntime(draft).settlementKeys['turn.start'] = input.turnId;
    const session = new Session(this, draft, 'system', `turn:${input.turnId}:start`);
    const due = hostRuntime(draft).scheduledEvents.filter(item => item.dueTick <= session.turn);
    hostRuntime(draft).scheduledEvents = hostRuntime(draft).scheduledEvents.filter(item => item.dueTick > session.turn);
    for (const item of due) session.emit(item.event.type, item.event.payload as JsonRecord, item.event.source, 1);
    // 内部事务（core/transaction.ts：自创模块、导演落实、离屏事件、战斗结算）留下的事件在回合开始时交给各模块，然后清空。
    const legacyEvents = hostRuntime(draft).pendingEvents ?? [];
    hostRuntime(draft).pendingEvents = [];
    for (const event of legacyEvents) session.emit(event.type, (event.payload ?? {}) as JsonRecord, event.source || 'legacy', 1);
    session.emit('turn.started', { round: input.round, turnId: input.turnId, text: input.userText ?? '' }, 'host', 0);
    for (const entry of this.modules) {
      try {
        entry.module.onTurnStart?.(session.draft, this.context(entry, session, 0), input);
      } catch (error) {
        session.warnings.push(`[${entry.module.label}] 回合开始失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.drain(session);
    this.settle(state, session);
    return this.finish(state, session);
  }

  /** 回合结束（正文已接受、时钟已推进后）：周期结算、加成到期、回合结束钩子与事件触发。 */
  endTurn(state: GameState, input: TurnInput): HostOutcome {
    const runtime = hostRuntime(state);
    if (runtime.settlementKeys['turn.end'] === input.turnId) {
      return { state, status: 'blocked', reason: '本回合已结算', changes: [], events: [], notes: [], cards: [], combats: [], messages: [], warnings: [] };
    }
    const session = this.session(state, 'system', `turn:${input.turnId}:end`);
    hostRuntime(session.draft).settlementKeys['turn.end'] = input.turnId;
    const minutes = this.runCycles(session, input.previousClock, input.turnId);
    const nextClock = session.draft.世界?.时间系统?.时钟;
    for (const expired of expireModifiers(session.draft, session.turn, nextClock?.elapsedMinutes)) {
      session.emit('modifier.expired', { id: expired.id, target: expired.target, source: expired.source, label: expired.label ?? '' }, 'host', 0);
    }
    for (const entry of this.modules) {
      try {
        entry.module.onTurnEnd?.(session.draft, this.context(entry, session, 0), input);
      } catch (error) {
        session.warnings.push(`[${entry.module.label}] 回合结束失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    session.emit('turn.ended', { round: input.round, turnId: input.turnId, minutes }, 'host', 0);
    this.drain(session);
    this.settle(state, session);
    // settlementKeys 只保留最近的周期键，防止无限增长。
    const keys = hostRuntime(session.draft).settlementKeys;
    const cycleKeys = Object.keys(keys).filter(key => key.startsWith('cycle:'));
    for (const key of cycleKeys.slice(0, Math.max(0, cycleKeys.length - 64))) delete keys[key];
    return this.finish(state, session);
  }

  /** 各模块给正文/提取/导演的摘要。 */
  summarize(state: GameState, audience: SummaryAudience): Array<{ moduleId: string; label: string; text: string }> {
    const session = this.session(state, 'system', 'summary');
    const out: Array<{ moduleId: string; label: string; text: string }> = [];
    for (const entry of this.modules) {
      const text = entry.module.summarize?.(session.draft, this.context(entry, session, 0), audience)?.trim();
      if (text) out.push({ moduleId: entry.module.id, label: entry.module.label, text });
    }
    return out;
  }

  /** 取出并清空待写入正文的结算备注。 */
  static takeNotes(state: GameState): Array<NarrativeNote & { turn: number }> {
    const runtime = hostRuntime(state);
    const notes = runtime.notes ?? [];
    runtime.notes = [];
    return notes;
  }

  static peekNotes(state: GameState): Array<NarrativeNote & { turn: number }> {
    return [...((state.gameplay as RuntimeWithExtras | undefined)?.notes ?? [])];
  }
}
