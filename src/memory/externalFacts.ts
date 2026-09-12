import type { MemoryVisibility, NarrativeMemoryRuntime, NarrativeSourceEvent, NarrativeEventCard } from './types';
import { memoryVisibilityMetadata } from './memoryVisibility';

/** Supplied by the authoritative event consumer, never by the director model. */
export interface AcceptedExternalMemoryEvent extends MemoryVisibility {
  status: 'accepted';
  eventId: string;
  round: number;
  acceptedAt: number;
  title: string;
  text: string;
  entityIds: string[];
}

/** Memory-owned immutable preparation; caller persists returned runtime under its save/turn guard. */
export function applyAcceptedExternalEvent(runtime: NarrativeMemoryRuntime, receipt: AcceptedExternalMemoryEvent): {
  status: 'applied' | 'duplicate'; runtime: NarrativeMemoryRuntime; sourceEventId: string;
} {
  if (receipt.status !== 'accepted' || !receipt.eventId?.trim() || !receipt.text?.trim() || !receipt.title?.trim()
    || !Number.isInteger(receipt.round) || receipt.round < 0 || !Number.isFinite(receipt.acceptedAt)
    || !Array.isArray(receipt.entityIds)) throw new Error('Only a valid accepted external event can enter memory');
  const sourceEventId = `external:${receipt.eventId}`;
  if (runtime.sourceEvents.some(event => event.id === sourceEventId)) return { status: 'duplicate', runtime, sourceEventId };
  const visibility = { ...memoryVisibilityMetadata(receipt), visibility: receipt.visibility ?? 'offscreen' as const, playerKnown: receipt.playerKnown ?? false };
  const source: NarrativeSourceEvent = {
    ...visibility, id: sourceEventId, round: receipt.round, createdAt: receipt.acceptedAt,
    userText: '', assistantText: receipt.text, sourceType: 'offscreen_event', layer: 'fact',
  };
  const event: NarrativeEventCard = {
    ...visibility, id: sourceEventId, title: receipt.title, summary: receipt.text, excerpt: receipt.text,
    importance: 3, status: 'warm', entityRefs: [...receipt.entityIds], locationRefs: [], threadRefs: [], timeLabels: [],
    sourceStartIndex: receipt.round, sourceEndIndex: receipt.round, createdAt: receipt.acceptedAt, updatedAt: receipt.acceptedAt,
    sourceType: 'offscreen_event', layer: 'fact', confidence: 1, evidence: [receipt.text], sourceEventIds: [sourceEventId],
    validFromRound: receipt.round, validUntilRound: null,
  };
  return { status: 'applied', sourceEventId, runtime: { ...runtime, sourceEvents: [...runtime.sourceEvents, source], eventCards: [...runtime.eventCards, event] } };
}
