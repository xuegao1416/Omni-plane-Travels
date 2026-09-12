/** Read-only shape retained for old save history. Runtime progression belongs to director/. */
export type MainlineEventStatus = 'pending' | 'active' | 'blocked' | 'completed' | 'diverged';

export interface MainlineState {
  enabled: boolean;
  datasetId: string;
  currentSegmentIndex: number;
  eventStates: Record<string, {
    status: MainlineEventStatus;
    lastTurnId?: string;
    evidenceQuote?: string;
    prerequisiteEvidence?: Array<{ index: number; quote: string; turnId: string }>;
  }>;
  deviationSummary: string;
  lastProcessedTurnId?: string;
  lastError?: string;
  stageLabel: string;
  updatedAt?: number;
  apiPresetId?: string;
}
