import type { ChoiceEffect } from '../modules/schema';
import { applyEffectTarget } from '../modules/eventChoiceState';
import type { GameState } from '../schema/variables';
import { normalizeCombatEncounterRequest, type CombatEncounterRequest } from './protocols';

export type NarrativeDecisionEffect =
  | { type: 'delta'; effect: ChoiceEffect }
  | { type: 'flag'; path: string; value: string | number | boolean | null };

export type NarrativeDecisionAction =
  | { type: 'apply_effects'; effects: NarrativeDecisionEffect[] }
  | { type: 'start_combat'; proposalId: string; request?: CombatEncounterRequest }
  | { type: 'combat.encounter.requested'; request: CombatEncounterRequest }
  | { type: 'attempt_escape'; combatSessionId?: string }
  | { type: 'narrative'; instruction: string };

export interface NarrativeDecisionRecord {
  schemaVersion: 1;
  id: string;
  saveId: string;
  eventPackId: string;
  cardId: string;
  blockId: string;
  selectedIndex: number;
  action: NarrativeDecisionAction;
  aiNote?: string;
  status: 'pending' | 'consumed';
  createdAt: number;
  consumedAt?: number;
  consumedByNarrativeId?: string;
}

export interface NarrativeDecisionRecordInput {
  id: string;
  saveId: string;
  eventPackId: string;
  cardId: string;
  blockId: string;
  selectedIndex: number;
  action: NarrativeDecisionAction;
  aiNote?: string;
  createdAt?: number;
}

export interface NarrativeDecisionApplication {
  state: GameState;
  applied: boolean;
  record: NarrativeDecisionRecord;
}

export interface NarrativeDecisionSource {
  id: string;
  saveId: string;
  eventPackId: string;
  cardId: string;
  blockId: string;
  selectedIndex: number;
}

export type LegacyEventChoice = string | {
  label: string;
  effect?: ChoiceEffect;
  aiNote?: string;
  action?: NarrativeDecisionAction;
};

export interface NarrativeResponseResult {
  status: 'success' | 'failure';
  narrativeId: string;
  content?: string;
  saveId?: string;
  decisionIds?: readonly string[];
}

export interface NarrativeDecisionPromptSnapshot {
  context: string;
  decisionIds: string[];
}

export interface NarrativeDecisionConsumption {
  narrativeId: string;
  saveId?: string;
  decisionIds?: readonly string[];
  consumedAt?: number;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function scalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function normalizeNarrativeDecisionAction(input: unknown): NarrativeDecisionAction | undefined {
  const raw = record(input);
  if (!raw || typeof raw.type !== 'string') return undefined;
  if (raw.type === 'start_combat' && typeof raw.proposalId === 'string' && raw.proposalId.trim()) {
    const request = normalizeCombatEncounterRequest(raw.request);
    return { type: 'start_combat', proposalId: raw.proposalId.trim(), ...(request ? { request } : {}) };
  }
  if (raw.type === 'combat.encounter.requested') {
    const request = normalizeCombatEncounterRequest(raw.request);
    return request ? { type: 'combat.encounter.requested', request } : undefined;
  }
  if (raw.type === 'attempt_escape') {
    return {
      type: 'attempt_escape',
      ...(typeof raw.combatSessionId === 'string' && raw.combatSessionId.trim() ? { combatSessionId: raw.combatSessionId.trim() } : {}),
    };
  }
  if (raw.type === 'narrative' && typeof raw.instruction === 'string' && raw.instruction.trim()) {
    return { type: 'narrative', instruction: raw.instruction.trim() };
  }
  if (raw.type === 'apply_effects' && Array.isArray(raw.effects)) {
    const effects: NarrativeDecisionEffect[] = [];
    for (const item of raw.effects) {
      const effect = record(item);
      if (!effect || typeof effect.type !== 'string') continue;
      if (effect.type === 'flag' && typeof effect.path === 'string' && effect.path.trim() && scalar(effect.value)) {
        effects.push({ type: 'flag', path: effect.path.trim(), value: effect.value });
        continue;
      }
      const choice = record(effect.effect);
      const delta = Number(choice?.delta);
      const statId = typeof choice?.statId === 'string' && choice.statId.trim() ? choice.statId.trim() : undefined;
      const resourcePath = typeof choice?.resourcePath === 'string' && choice.resourcePath.trim() ? choice.resourcePath.trim() : undefined;
      if (effect.type === 'delta' && (statId || resourcePath) && Number.isFinite(delta)) {
        effects.push({ type: 'delta', effect: { statId, resourcePath, delta } });
      }
    }
    return effects.length > 0 ? { type: 'apply_effects', effects } : undefined;
  }
  return undefined;
}

export function createNarrativeDecisionRecord(input: NarrativeDecisionRecordInput): NarrativeDecisionRecord {
  return {
    schemaVersion: 1,
    id: input.id,
    saveId: input.saveId,
    eventPackId: input.eventPackId,
    cardId: input.cardId,
    blockId: input.blockId,
    selectedIndex: Math.max(0, Math.trunc(input.selectedIndex)),
    action: clone(input.action),
    ...(input.aiNote?.trim() ? { aiNote: input.aiNote.trim() } : {}),
    status: 'pending',
    createdAt: input.createdAt ?? Date.now(),
  };
}

function setFlag(state: GameState, path: string, value: string | number | boolean | null): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0 || parts.some(part => part === '__proto__' || part === 'constructor' || part === 'prototype')) return;
  let current: Record<string, unknown> = state as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function applyAction(state: GameState, action: NarrativeDecisionAction): void {
  if (action.type !== 'apply_effects') return;
  for (const effect of action.effects) {
    if (effect.type === 'delta') applyEffectTarget(state, effect.effect);
    else setFlag(state, effect.path, effect.value);
  }
}

export function applyNarrativeDecision(state: GameState, record: NarrativeDecisionRecord): NarrativeDecisionApplication {
  const next = clone(state);
  const records = next.narrativeDecisions ?? [];
  const existing = records.find(item => item.id === record.id);
  if (existing) return { state: next, applied: false, record: existing };

  applyAction(next, record.action);
  next.narrativeDecisions = [...records, clone(record)];
  return { state: next, applied: true, record };
}

export function getPendingNarrativeDecisions(state: GameState): NarrativeDecisionRecord[] {
  return (state.narrativeDecisions ?? [])
    .filter(record => record.status === 'pending')
    .map(record => clone(record));
}

export function getPendingNarrativeDecisionsForSave(state: GameState, saveId: string): NarrativeDecisionRecord[] {
  return getPendingNarrativeDecisions(state).filter(record => record.saveId === saveId);
}

export function settleNarrativeResponse(state: GameState, result: NarrativeResponseResult): GameState {
  if (result.status !== 'success' || !result.content?.trim()) return clone(state);
  return consumeNarrativeDecisions(state, {
    narrativeId: result.narrativeId,
    saveId: result.saveId,
    decisionIds: result.decisionIds,
  });
}

export function narrativeDecisionFromChoice(
  choice: LegacyEventChoice,
  source: NarrativeDecisionSource,
): NarrativeDecisionRecord {
  const label = typeof choice === 'string' ? choice : choice.label;
  const effect = typeof choice === 'string' ? undefined : choice.effect;
  const action = typeof choice === 'string' ? undefined : normalizeNarrativeDecisionAction(choice.action);
  return createNarrativeDecisionRecord({
    ...source,
    action: action ?? (effect
      ? { type: 'apply_effects', effects: [{ type: 'delta', effect: clone(effect) }] }
      : { type: 'narrative', instruction: label }),
    aiNote: typeof choice === 'string' ? label : choice.aiNote ?? label,
  });
}

export function consumeNarrativeDecisions(state: GameState, consumption: NarrativeDecisionConsumption): GameState {
  const next = clone(state);
  const ids = consumption.decisionIds ? new Set(consumption.decisionIds) : undefined;
  next.narrativeDecisions = (next.narrativeDecisions ?? []).map(record => (
    record.status === 'pending'
      && (!consumption.saveId || record.saveId === consumption.saveId)
      && (!ids || ids.has(record.id))
      ? {
        ...record,
        status: 'consumed' as const,
        consumedAt: consumption.consumedAt ?? Date.now(),
        consumedByNarrativeId: consumption.narrativeId,
      }
      : record
  ));
  return next;
}

export function getNarrativeDecisionPromptSnapshot(state: GameState, saveId?: string): NarrativeDecisionPromptSnapshot {
  const pending = saveId ? getPendingNarrativeDecisionsForSave(state, saveId) : getPendingNarrativeDecisions(state);
  if (pending.length === 0) return { context: '', decisionIds: [] };
  const lines = ['【玩家事件决策 — 仅供下一次成功正文承接】'];
  for (const record of pending) {
    const note = record.aiNote?.trim() || `${record.eventPackId}/${record.cardId} 选择了第 ${record.selectedIndex + 1} 项`;
    lines.push(`- ${note}`);
  }
  return { context: lines.join('\n'), decisionIds: pending.map(record => record.id) };
}

export function getNarrativeDecisionContext(state: GameState): string {
  return getNarrativeDecisionPromptSnapshot(state).context;
}
