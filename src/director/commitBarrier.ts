import type { PipelineStatus } from '../engine/pipelineTypes';

/** Derived retrieval may degrade; authoritative writes must be settled before auditing progress. */
export function canReviewCommittedTurn(status: PipelineStatus): boolean {
  return status.stages.main.status === 'success' && (['variable', 'memory_write', 'memory_summary', 'memory_vector'] as const)
    .every(id => ['success', 'skipped'].includes(status.stages[id].status));
}
