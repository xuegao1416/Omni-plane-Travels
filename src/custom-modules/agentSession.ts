import type { CustomGameplayModuleDefinition, ModuleValidationIssue } from './schema';
import { validateCustomGameplayModule } from './validator';

export type CustomModuleAgentPhase = 'discovery' | 'designing' | 'draft_ready' | 'revising';

export interface CustomModuleAgentWorldContext {
  id: string;
  name: string;
  description?: string;
  availability?: {
    stat: boolean;
    survival: boolean;
    business: boolean;
    currency: boolean;
  };
  survivalResourceIds?: string[];
}

export interface CustomModuleConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CustomModuleDesignBrief {
  goal: string;
  presentation: string;
  triggers: string[];
  inputs: string[];
  state: string[];
  behavior: string[];
  outputs: string[];
  assumptions: string[];
  unresolved: string[];
}

export interface CustomModuleAgentQuestion {
  id: string;
  text: string;
  choices?: string[];
}

export interface CustomModuleAgentEnvelope {
  message: string;
  phase: CustomModuleAgentPhase;
  brief: CustomModuleDesignBrief;
  question?: CustomModuleAgentQuestion;
  module: CustomGameplayModuleDefinition | null;
}

export interface CustomModuleAgentSession {
  /** Version 2 adds a world-scoped conversation transcript. */
  sessionVersion: 2;
  world: CustomModuleAgentWorldContext;
  conversation: CustomModuleConversationMessage[];
  phase: CustomModuleAgentPhase;
  brief: CustomModuleDesignBrief;
  draft?: CustomGameplayModuleDefinition;
  lastValidDraft?: CustomGameplayModuleDefinition;
  revision: number;
}

export interface ApplyCustomModuleAgentTurnResult {
  session: CustomModuleAgentSession;
  accepted: boolean;
  errors: ModuleValidationIssue[];
  previousDraft?: CustomGameplayModuleDefinition;
}

export function createEmptyCustomModuleDesignBrief(): CustomModuleDesignBrief {
  return {
    goal: '', presentation: '', triggers: [], inputs: [], state: [], behavior: [],
    outputs: [], assumptions: [], unresolved: [],
  };
}

export function createCustomModuleAgentSession(world: CustomModuleAgentWorldContext): CustomModuleAgentSession {
  return {
    sessionVersion: 2,
    world: { ...world },
    conversation: [],
    phase: 'discovery',
    brief: createEmptyCustomModuleDesignBrief(),
    revision: 0,
  };
}

function replaceList(previous: string[], next: string[] | undefined): string[] {
  if (!next) return [...previous];
  return [...new Set(next.map((item) => item.trim()).filter(Boolean))];
}

export function mergeCustomModuleDesignBrief(
  previous: CustomModuleDesignBrief,
  next: Partial<CustomModuleDesignBrief>,
): CustomModuleDesignBrief {
  return {
    goal: next.goal?.trim() || previous.goal,
    presentation: next.presentation?.trim() || previous.presentation,
    triggers: replaceList(previous.triggers, next.triggers),
    inputs: replaceList(previous.inputs, next.inputs),
    state: replaceList(previous.state, next.state),
    behavior: replaceList(previous.behavior, next.behavior),
    outputs: replaceList(previous.outputs, next.outputs),
    assumptions: replaceList(previous.assumptions, next.assumptions),
    unresolved: next.unresolved ? [...new Set(next.unresolved.map((item) => item.trim()).filter(Boolean))] : [...previous.unresolved],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Pure session reducer. Invalid replacement drafts never erase the last valid draft. */
export function applyCustomModuleAgentTurn(
  session: CustomModuleAgentSession,
  envelope: CustomModuleAgentEnvelope,
): ApplyCustomModuleAgentTurnResult {
  const previousDraft = session.lastValidDraft ?? session.draft;
  const nextSession: CustomModuleAgentSession = {
    ...clone(session),
    phase: envelope.phase,
    brief: mergeCustomModuleDesignBrief(session.brief, envelope.brief),
  };

  if (envelope.module === null) {
    nextSession.draft = previousDraft ? clone(previousDraft) : undefined;
    nextSession.lastValidDraft = previousDraft ? clone(previousDraft) : undefined;
    return { session: nextSession, accepted: true, errors: [], previousDraft };
  }

  const validation = validateCustomGameplayModule(envelope.module);
  if (!validation.valid || !validation.normalized) {
    nextSession.phase = session.phase === 'draft_ready' ? 'revising' : envelope.phase;
    nextSession.draft = previousDraft ? clone(previousDraft) : undefined;
    nextSession.lastValidDraft = previousDraft ? clone(previousDraft) : undefined;
    return { session: nextSession, accepted: false, errors: validation.errors, previousDraft };
  }

  nextSession.draft = clone(validation.normalized);
  nextSession.lastValidDraft = clone(validation.normalized);
  nextSession.phase = 'draft_ready';
  nextSession.revision = session.revision + 1;
  return { session: nextSession, accepted: true, errors: [], previousDraft };
}
