/**
 * Shared, declarative contracts for every built-in gameplay module.
 *
 * The kernel intentionally understands data paths and transactions, not any
 * particular world or module. Module adapters translate their domain rules
 * into these primitives.
 */

export type GameplayScalar = string | number | boolean | null;
export type GameplayValue = GameplayScalar | GameplayValue[] | { [key: string]: GameplayValue };
export type GameplayLiteral = string | number | boolean | string[];

export type GameplayComparator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains';

export type GameplayCondition =
  | { all: GameplayCondition[] }
  | { any: GameplayCondition[] }
  | { not: GameplayCondition }
  | { state: { path: string; op: GameplayComparator; value: GameplayLiteral } }
  | { event: { type: string; where?: Record<string, GameplayLiteral> } };

export interface GameplayEventInput {
  type: string;
  payload?: Record<string, GameplayValue>;
  tags?: string[];
}

export interface GameplayEvent extends GameplayEventInput {
  id: string;
  tick: number;
  sequence: number;
  source: string;
  moduleId?: string;
  transactionId: string;
}

export type GameplayEffect =
  | { set: { path: string; value: GameplayValue } }
  | { add: { path: string; delta: number; min?: number; max?: number; create?: boolean } }
  | { append: { path: string; value: GameplayValue; limit?: number; create?: boolean } }
  | { remove: { path: string } }
  | { emit: GameplayEventInput }
  | { schedule: { after: number; event: GameplayEventInput } };

export interface GameplayCost {
  id?: string;
  label?: string;
  path: string;
  amount: number;
}

export interface GameplayReward {
  id?: string;
  label?: string;
  effects: GameplayEffect[];
}

export interface GameplayTransaction {
  id: string;
  moduleId?: string;
  source: string;
  label?: string;
  conditions?: GameplayCondition[];
  costs?: GameplayCost[];
  effects?: GameplayEffect[];
  rewards?: GameplayReward[];
  events?: GameplayEventInput[];
}

export interface GameplayChange {
  path: string;
  operation: 'cost' | 'set' | 'add' | 'append' | 'remove';
  before: unknown;
  after: unknown;
  label?: string;
}

export interface GameplayLogEntry {
  id: string;
  sequence: number;
  tick: number;
  transactionId: string;
  moduleId?: string;
  source: string;
  label?: string;
  status: 'applied' | 'blocked' | 'failed' | 'reverted';
  reason?: string;
  /** Sequence of the compensating transaction when this entry was reverted. */
  revertedBy?: string;
  changes: GameplayChange[];
  eventIds: string[];
}

export interface ScheduledGameplayEvent {
  dueTick: number;
  event: GameplayEvent;
}

export interface GameplayStatModifier {
  id: string;
  statId: string;
  delta: number;
  mode?: 'flat' | 'percent';
  source?: string;
  /** Absolute gameplay tick; the modifier is active before this tick. */
  expiresAtTick?: number;
}

export interface GameplayStatRuntime {
  modifiers: Record<string, GameplayStatModifier>;
  base: Record<string, number>;
  derived: Record<string, number>;
}

export interface GameplaySurvivalRuntime {
  unlockedRecipes: string[];
  statuses: Record<string, { value: number; expiresAtTick?: number; source?: string }>;
}

export interface GameplayBusinessRuntime {
  inventory: Record<string, number>;
  productionCycles: Record<string, number>;
}

export interface GameplayRuntimeState {
  schemaVersion: number;
  sequence: number;
  pendingEvents: GameplayEvent[];
  eventHistory: GameplayEvent[];
  scheduledEvents: ScheduledGameplayEvent[];
  logs: GameplayLogEntry[];
  appliedMigrations: string[];
  settlementKeys: Record<string, string>;
  stat?: GameplayStatRuntime;
  survival?: GameplaySurvivalRuntime;
  business?: GameplayBusinessRuntime;
}

export type GameplayStateRoot = object & {
  gameplay?: GameplayRuntimeState;
};

export interface GameplayExecutionContext {
  tick: number;
  enabledModules?: readonly string[];
  events?: readonly GameplayEventInput[];
  /** Explicit calendar rules for gameplay clock writes. */
  worldClockConfig?: import('../time/worldClock').WorldClockConfig;
}

export interface GameplayExecutionResult<TState extends GameplayStateRoot = GameplayStateRoot> {
  state: TState;
  status: 'applied' | 'blocked' | 'failed';
  reason?: string;
  changes: GameplayChange[];
  events: GameplayEvent[];
  warnings: string[];
  log: GameplayLogEntry;
}
