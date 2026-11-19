/**
 * 唯一的效果语言。
 *
 * 事件卡选项、规则动作、AI 变量更新、自创模块动作、模块命令最终都翻译成 Op 列表，
 * 由这里按顺序执行：读写经变量注册表（类型、范围、写权限、旧路径别名），
 * 领域命令交给模块，事件/备注/抽卡/战斗请求作为输出交还调用方。
 */
import type { GameState } from '../schema/variables';
import { getGameplayPath, setGameplayPath } from './state';
import type { GameplayStateRoot } from '../gameplay/types';
import type { FactRegistry, WriteSource } from './facts';
import type { Rng } from './rng';
import { evaluateCondition, type CoreCondition, type EventLike } from './conditions';
import { addModifier, removeModifier, type ModifierRecord } from './modifiers';
import { diffStates, type StateChange } from './diff';

export type JsonRecord = Record<string, unknown>;

export interface NarrativeNote {
  text: string;
  /** fact：已经发生、正文必须承认的结果；hint：可以自然带出的线索。 */
  tone: 'fact' | 'hint';
  source?: string;
}

export interface CardRequest {
  eventId: string;
  packId?: string;
  reason?: string;
}

export interface EmittedEvent {
  type: string;
  payload?: JsonRecord;
  source?: string;
}

export interface ScheduledEvent extends EmittedEvent {
  afterTurns: number;
}

export type ModifierOpInput = Omit<ModifierRecord, 'source' | 'expiresAfterTurn' | 'expiresAtMinute'> & {
  source?: string;
  /** 持续回合数（从当前回合起算）。 */
  turns?: number;
  /** 持续世界分钟数。 */
  minutes?: number;
};

export type Op =
  | { op: 'set'; path: string; value: unknown; label?: string }
  | { op: 'add'; path: string; value: number; strict?: boolean; min?: number; max?: number; create?: boolean; label?: string }
  | { op: 'remove'; path: string; label?: string }
  | { op: 'append'; path: string; value: unknown; limit?: number; label?: string }
  | { op: 'command'; command: string; args?: JsonRecord; label?: string }
  | { op: 'emit'; event: string; payload?: JsonRecord }
  | { op: 'schedule'; event: string; payload?: JsonRecord; afterTurns: number }
  | { op: 'modifier'; modifier: ModifierOpInput }
  | { op: 'clearModifier'; id: string }
  | { op: 'note'; text: string; tone?: NarrativeNote['tone'] }
  | { op: 'card'; eventId: string; packId?: string }
  | { op: 'combat'; request: unknown }
  | { op: 'if'; when: CoreCondition; then: Op[]; else?: Op[] };

export type CommandResult = { ok: true; message?: string } | { ok: false; reason: string };

export interface CommandContext {
  facts: FactRegistry;
  source: WriteSource;
  turn: number;
  minute?: number;
  rng: Rng;
  emit(type: string, payload?: JsonRecord): void;
  note(text: string, tone?: NarrativeNote['tone']): void;
  card(eventId: string, packId?: string): void;
  combat(request: unknown): void;
  /** 在同一份草稿上执行子 Op（命令内部复用通用写入）。 */
  apply(ops: readonly Op[]): boolean;
}

export type CommandHandler = (state: GameState, args: JsonRecord, context: CommandContext) => CommandResult;

export interface OpContext {
  facts: FactRegistry;
  commands?: ReadonlyMap<string, CommandHandler>;
  source: WriteSource;
  turn: number;
  minute?: number;
  hourOfDay?: number;
  rng: Rng;
  /** true：单条失败只记警告；false：任一失败整体回退。 */
  bestEffort?: boolean;
  /** 条件里 `event` 匹配用的当前事件。 */
  events?: readonly EventLike[];
  sourceLabel?: string;
}

export interface OpOutcome {
  state: GameState;
  status: 'applied' | 'blocked' | 'failed';
  reason?: string;
  warnings: string[];
  changes: StateChange[];
  emitted: EmittedEvent[];
  scheduled: ScheduledEvent[];
  notes: NarrativeNote[];
  cards: CardRequest[];
  combats: unknown[];
  messages: string[];
}

const MAX_OPS = 256;
const MAX_NESTING = 8;

function clone<T>(value: T): T {
  return value === undefined || value === null || typeof value !== 'object' ? value : structuredClone(value);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

class OpRunner {
  readonly warnings: string[] = [];
  readonly emitted: EmittedEvent[] = [];
  readonly scheduled: ScheduledEvent[] = [];
  readonly notes: NarrativeNote[] = [];
  readonly cards: CardRequest[] = [];
  readonly combats: unknown[] = [];
  readonly messages: string[] = [];
  private executed = 0;

  constructor(private readonly draft: GameState, private readonly context: OpContext) {}

  /** 返回 null 表示成功，否则返回失败原因。 */
  run(ops: readonly Op[], depth = 0): string | null {
    if (depth > MAX_NESTING) return '效果嵌套过深';
    for (const op of ops) {
      if (++this.executed > MAX_OPS) return `单次结算的效果超过上限 ${MAX_OPS}`;
      const failure = this.runOne(op, depth);
      if (!failure) continue;
      if (this.context.bestEffort) {
        this.warnings.push(failure);
        continue;
      }
      return failure;
    }
    return null;
  }

  private commandContext(): CommandContext {
    return {
      facts: this.context.facts,
      source: this.context.source,
      turn: this.context.turn,
      minute: this.context.minute,
      rng: this.context.rng,
      emit: (type, payload) => { this.emitted.push({ type, payload, source: this.context.sourceLabel ?? this.context.source }); },
      note: (text, tone = 'fact') => { if (text.trim()) this.notes.push({ text: text.trim(), tone, source: this.context.sourceLabel }); },
      card: (eventId, packId) => { if (eventId) this.cards.push({ eventId, packId }); },
      combat: request => { this.combats.push(clone(request)); },
      apply: ops => this.run(ops, 1) === null,
    };
  }

  private runOne(op: Op, depth: number): string | null {
    const { facts, source } = this.context;
    switch (op.op) {
      case 'set': {
        const result = facts.set(this.draft, op.path, op.value, source, op.label);
        return result.ok ? null : result.reason ?? `无法写入 ${op.path}`;
      }
      case 'add': {
        const result = facts.add(this.draft, op.path, Number(op.value), source, { strict: op.strict, min: op.min, max: op.max, create: op.create, label: op.label });
        return result.ok ? null : result.reason ?? `无法修改 ${op.path}`;
      }
      case 'remove': {
        const result = facts.remove(this.draft, op.path, source, op.label);
        return result.ok ? null : result.reason ?? `无法删除 ${op.path}`;
      }
      case 'append': {
        const resolved = facts.resolve(op.path);
        if (!resolved) return `无法追加到 ${op.path}`;
        if (!facts.canWrite(op.path, source)) return `${op.path} 不允许由 ${source} 修改`;
        if (resolved.spec && !resolved.storagePath) {
          // 自定义读写的列表变量（如旧版 经营资产.资产列表）：读出、追加、整体写回。
          const current = facts.read(this.draft, op.path);
          const list = Array.isArray(current) ? [...current] : current === undefined ? [] : null;
          if (!list) return `${op.path} 不是列表`;
          list.push(clone(op.value));
          const limit = op.limit && op.limit > 0 ? Math.trunc(op.limit) : undefined;
          const result = facts.set(this.draft, op.path, limit ? list.slice(-limit) : list, source, op.label);
          return result.ok ? null : result.reason ?? `无法追加到 ${op.path}`;
        }
        if (!resolved.storagePath) return `无法追加到 ${op.path}`;
        const current = getGameplayPath(this.draft, resolved.storagePath);
        const list = Array.isArray(current) ? [...current] : current === undefined ? [] : null;
        if (!list) return `${op.path} 不是列表`;
        list.push(clone(op.value));
        const limit = op.limit && op.limit > 0 ? Math.trunc(op.limit) : undefined;
        setGameplayPath(this.draft as unknown as GameplayStateRoot, resolved.storagePath, limit ? list.slice(-limit) : list);
        return null;
      }
      case 'command': {
        const handler = this.context.commands?.get(op.command);
        if (!handler) return `未知命令：${op.command}`;
        const result = handler(this.draft, asRecord(op.args) ?? {}, this.commandContext());
        if (!result.ok) return result.reason;
        if (result.message) this.messages.push(result.message);
        return null;
      }
      case 'emit':
        if (!op.event) return '事件类型为空';
        this.emitted.push({ type: op.event, payload: clone(op.payload), source: this.context.sourceLabel ?? source });
        return null;
      case 'schedule':
        if (!op.event) return '事件类型为空';
        this.scheduled.push({ type: op.event, payload: clone(op.payload), afterTurns: Math.max(1, Math.trunc(op.afterTurns || 1)), source: this.context.sourceLabel ?? source });
        return null;
      case 'modifier': {
        const input = op.modifier;
        if (!input?.id || !input.target || !Number.isFinite(Number(input.value))) return '修正器缺少 id/target/value';
        addModifier(this.draft, {
          id: input.id,
          target: input.target,
          mode: input.mode === 'mult' ? 'mult' : 'flat',
          value: Number(input.value),
          source: input.source ?? this.context.sourceLabel ?? source,
          label: input.label,
          ...(input.turns && input.turns > 0 ? { expiresAfterTurn: this.context.turn + Math.trunc(input.turns) - 1 } : {}),
          ...(input.minutes && input.minutes > 0 && this.context.minute !== undefined ? { expiresAtMinute: this.context.minute + Math.trunc(input.minutes) } : {}),
        });
        return null;
      }
      case 'clearModifier':
        removeModifier(this.draft, op.id);
        return null;
      case 'note':
        if (op.text?.trim()) this.notes.push({ text: op.text.trim(), tone: op.tone ?? 'fact', source: this.context.sourceLabel });
        return null;
      case 'card':
        if (!op.eventId) return '抽卡缺少事件 ID';
        this.cards.push({ eventId: op.eventId, packId: op.packId });
        return null;
      case 'combat':
        this.combats.push(clone(op.request));
        return null;
      case 'if': {
        const pass = evaluateCondition(op.when, {
          state: this.draft, facts, events: this.context.events, rng: this.context.rng, hourOfDay: this.context.hourOfDay,
        });
        return this.run(pass ? op.then : op.else ?? [], depth + 1);
      }
      default:
        return `无法识别的效果：${JSON.stringify(op).slice(0, 80)}`;
    }
  }
}

/** 在状态副本上执行；失败（非 bestEffort）时返回原状态。 */
export function applyOps(state: GameState, ops: readonly Op[], context: OpContext): OpOutcome {
  const draft = clone(state);
  const runner = new OpRunner(draft, context);
  const failure = runner.run(ops);
  const base = {
    warnings: runner.warnings,
    emitted: runner.emitted,
    scheduled: runner.scheduled,
    notes: runner.notes,
    cards: runner.cards,
    combats: runner.combats,
    messages: runner.messages,
  };
  if (failure) {
    return { state, status: 'failed', reason: failure, changes: [], ...base, emitted: [], scheduled: [], notes: [], cards: [], combats: [], messages: [] };
  }
  const changes = diffStates(state, draft);
  const hasOutput = changes.length > 0 || runner.emitted.length > 0 || runner.scheduled.length > 0 || runner.notes.length > 0
    || runner.cards.length > 0 || runner.combats.length > 0;
  return { state: draft, status: hasOutput ? 'applied' : 'blocked', reason: hasOutput ? undefined : '没有产生任何变化', changes, ...base };
}

/** 在已有草稿上原地执行（宿主内部使用，草稿由调用方负责回退）。 */
export function applyOpsInPlace(draft: GameState, ops: readonly Op[], context: OpContext): Omit<OpOutcome, 'state' | 'changes' | 'status'> & { failure: string | null } {
  const runner = new OpRunner(draft, context);
  const failure = runner.run(ops);
  return {
    failure,
    warnings: runner.warnings,
    emitted: runner.emitted,
    scheduled: runner.scheduled,
    notes: runner.notes,
    cards: runner.cards,
    combats: runner.combats,
    messages: runner.messages,
  };
}
