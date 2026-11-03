import type { GameState, NPCData } from '../schema/variables';

export type DirectorTruth = 'true' | 'false' | 'unknown';
export type PlotPlanStatus = 'waiting' | 'ready' | 'directed' | 'occurred' | 'blocked' | 'invalid' | 'superseded';
export type DirectiveOutcome = 'realized' | 'partially_realized' | 'not_realized' | 'player_rejected' | 'invalidated' | 'deferred';
export type DirectorVisibility = 'foreground' | 'reader_only' | 'secret';

export interface PlotPlanDependency {
  kind: 'variable' | 'memory' | 'plan' | 'entity' | 'event' | 'condition';
  ref: string;
  expected?: unknown;
  operator?: 'eq' | 'neq' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
  truth?: DirectorTruth;
  source?: string;
  note?: string;
  resolution?: { truth: DirectorTruth; stateVersion: string; evidenceIds: string[] };
}

export interface PlotPlan {
  stageId?: string;
  id: string;
  intent: string;
  participants: string[];
  dependencies: PlotPlanDependency[];
  constraints?: string[];
  mutableRange?: string[];
  preserveDirection?: string[];
  status: PlotPlanStatus;
  priority: number;
  visibility: DirectorVisibility;
  source: 'director' | 'novel' | 'authored' | 'legacy';
  sourceRef?: string;
  createdAt: number;
  updatedAt: number;
  lastDirectiveId?: string;
  lastReceiptId?: string;
  basis?: string[];
}

export interface DirectorReadContext {
  saveId: string;
  worldId: string;
  completedTurnId: string;
  stateVersion: string;
  playerInput?: string;
  narrative?: string;
  variableProjection: GameState;
  memories: Array<{ id: string; text: string; confidence?: number; provenance?: string; layer?: 'fact' | 'state' | 'inference' | 'summary'; visibility?: DirectorVisibility }>;
}

export interface DirectorDirectiveItem {
  planId: string;
  intent: string;
  participants: string[];
  priority: number;
  constraints?: string[];
  prerequisites?: string[];
  deferIf?: string[];
  forbiddenKnowledge?: string[];
  note?: string;
}

export interface DirectorDirective {
  issuedForTurnId?: string;
  id: string;
  directorRunId: string;
  saveId: string;
  basedOnTurnId: string;
  basedOnStateVersion?: string;
  primary?: DirectorDirectiveItem;
  secondary: DirectorDirectiveItem[];
  createdAt: number;
}

export type OffscreenEventKind =
  | 'character_injured'
  | 'character_moved'
  | 'relationship_changed'
  | 'knowledge_changed'
  | 'faction_relation_changed'
  | 'world_event';

export interface OffscreenEventProposal {
  planId?: string;
  worldId?: string;
  basedOnTurnId?: string;
  proposalId: string;
  directorRunId: string;
  saveId: string;
  baseStateVersion: string;
  logicalEventKey: string;
  kind: OffscreenEventKind;
  subjectIds: string[];
  prerequisites: Array<{ kind: 'variable' | 'entity' | 'plan' | 'memory' | 'event'; ref: string; truth: DirectorTruth }>;
  occurredAt: string;
  visibility: DirectorVisibility;
  description: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface OffscreenEventReceipt {
  id: string;
  proposalId: string;
  logicalEventKey: string;
  status: 'accepted' | 'rejected' | 'pending';
  reason?: string;
  committedAt?: number;
  stateVersion?: string;
  consumers: {
    variables: 'pending' | 'done' | 'failed';
    memory: 'pending' | 'done' | 'failed';
  };
}

export interface DirectorOutcomeItem {
  planId: string;
  outcome: DirectiveOutcome;
  evidence?: string;
  note?: string;
}

export interface DirectorOutcomeReceipt {
  id: string;
  turnId: string;
  directiveId?: string;
  stateVersion?: string;
  outcomes: DirectorOutcomeItem[];
  offscreenReceiptIds?: string[];
  createdAt: number;
}

export interface DirectorSourceBinding {
  actorNames?: Record<string, string>;
  actorAliases?: Record<string, string[]>;
  stages?: Array<{ id: string; title: string; mode: 'all' | 'any'; planIds: string[]; completionPlanIds: string[]; status: 'pending' | 'active' | 'completed' | 'failed' }>;
  currentStageId?: string;
  definitionId?: string;
  startStageId?: string;
  type: 'novel' | 'authored';
  sourceId: string;
  version: string;
  startIndex?: number;
  roleBinding?: Record<string, string>;
  adaptationMode?: 'source_faithful' | 'adapted';
  exhausted?: boolean;
  boundAt: number;
}

export interface DirectorState {
  version: 1;
  /** Retry metadata only; narrative and facts remain in their existing owners. */
  pendingReview?: { saveId: string; worldId: string; turnId: string; round: number; writesCommitted: boolean };
  plans: Record<string, PlotPlan>;
  directives: Record<string, DirectorDirective>;
  receipts: DirectorOutcomeReceipt[];
  offscreenReceipts: Record<string, OffscreenEventReceipt>;
  offscreenProposals: Record<string, OffscreenEventProposal>;
  sourceBinding?: DirectorSourceBinding;
  legacyMigrated?: boolean;
  lastCompiledTurnId?: string;
  lastRunAt?: number;
}

export interface CharacterKnowledgeRecord {
  npcId: string;
  observed: Partial<NPCData>;
  fields: Record<string, { value: unknown; source: 'legacy_baseline' | 'observed' | 'dialogue' | 'system'; turnId?: string; updatedAt: number }>;
  firstKnownAt: number;
  updatedAt: number;
}

export interface CharacterKnowledgeState {
  version: 1;
  seededFromLegacy: boolean;
  characters: Record<string, CharacterKnowledgeRecord>;
}

export function createEmptyDirectorState(): DirectorState {
  return {
    version: 1,
    plans: {},
    directives: {},
    receipts: [],
    offscreenReceipts: {},
    offscreenProposals: {},
  };
}
