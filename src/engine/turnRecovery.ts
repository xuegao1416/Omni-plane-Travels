import type { MemoryPipelineContext } from '../memory/useMemorySystem';
import { createPipelineStatus, type PipelineConfig } from './pipelineTypes';
import type { PipelineResult } from './pipelineExecutor';
import type { TurnSettlementInput } from './turnSettlement';

const MEMORY_FIELDS = ['floor', 'batchText', 'inputText', 'assistantText', 'recentContext', 'playerName',
  '_queryRewriteResult', '_plannerResult', '_rerankResult', '_selectedEntries', '_selectedVectorFacts',
  '_compiledContext', '_retrievalKeywords', '_semanticQuery', '_finalSelectedTitles', '_candidateList',
  '_allMemories', '_hitDetails', '_degradedStages', 'resourceState'] as const;

/** No credentials, AbortSignal, closures or store objects cross the save boundary. */
export function recoverableMemoryContext(context: Partial<MemoryPipelineContext>): Partial<MemoryPipelineContext> {
  const output: Record<string, unknown> = {};
  for (const key of MEMORY_FIELDS) if (context[key] !== undefined) output[key] = context[key];
  return structuredClone(output);
}

export function recoveryVersion(value: unknown): string {
  // Partition revision pointers are materialized during save/load; their data is
  // already compared in the reconstructed state and must not invalidate a retry.
  return JSON.stringify(value, (key, item) => key === 'moduleRevisions' ? undefined : item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export interface TurnRecovery {
  version: 1;
  worldId: string;
  saveId: string | null;
  aiMsgId: string;
  round: number;
  userText: string;
  rawText: string;
  stateVersion: string;
  memoryVersion: string;
  config: PipelineConfig;
  result: PipelineResult;
  memory: Partial<MemoryPipelineContext>;
  settlement: TurnSettlementInput;
}

/** Imported malformed or stale recovery must never turn a completed task into a new write. */
export function readTurnRecovery(value: unknown): TurnRecovery | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as TurnRecovery;
  const tasks = Object.keys(createPipelineStatus(0).stages);
  const statuses = ['pending', 'running', 'success', 'warning', 'error', 'skipped'];
  if (data.version !== 1 || typeof data.worldId !== 'string' || typeof data.aiMsgId !== 'string'
    || !(data.saveId === null || typeof data.saveId === 'string') || !Number.isSafeInteger(data.round)
    || typeof data.userText !== 'string' || typeof data.rawText !== 'string'
    || typeof data.stateVersion !== 'string' || typeof data.memoryVersion !== 'string'
    || typeof data.result?.mainResult?.parsed?.content !== 'string' || !data.result.mainResult.parsed.content.trim()
    || data.result.status?.stages?.main?.status !== 'success'
    || data.result.status.round !== data.round || !tasks.every(key => statuses.includes(data.result.status.stages[key as keyof typeof data.result.status.stages]?.status))
    || !Array.isArray(data.config?.executionOrder) || !data.config.executionOrder.every(layer => Array.isArray(layer) && layer.every(task => tasks.includes(task)))
    || !data.config.executionOrder.some(layer => layer.includes('main'))
    || typeof data.config.variableEnabled !== 'boolean' || typeof data.config.memoryEnabled !== 'boolean'
    || !Number.isFinite(data.config.variableDelayMs) || data.config.variableDelayMs < 0
    || !Number.isSafeInteger(data.config.variableMaxRetries) || data.config.variableMaxRetries < 0 || data.config.variableMaxRetries > 10
    || !data.settlement || typeof data.settlement.done !== 'boolean' || typeof data.settlement.internalContinuation !== 'boolean'
    || !Number.isFinite(data.settlement.progressionBaseline?.tierIndex) || !Number.isFinite(data.settlement.progressionBaseline?.currentXP)
    || typeof data.settlement.narrativeDecisionRequest?.saveId !== 'string' || !Array.isArray(data.settlement.narrativeDecisionRequest?.decisionIds)
    || !data.memory || typeof data.memory !== 'object') return null;
  try { return structuredClone(data); } catch { return null; }
}

export function needsTurnRecovery(result: PipelineResult, config: PipelineConfig, settlement: TurnSettlementInput): boolean {
  return Boolean(result.mainResult && (!settlement.done || !['success', 'skipped'].includes(result.status.stages.settlement.status)
    || config.executionOrder.flat().some(id => !['success', 'skipped'].includes(result.status.stages[id].status))));
}
