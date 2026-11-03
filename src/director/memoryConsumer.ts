import type { AcceptedExternalMemoryEvent } from '../memory/externalFacts';
import type { OffscreenEventProposal, OffscreenEventReceipt } from './types';

export interface OffscreenMemoryPort {
  appendAcceptedEvent: (event: Omit<AcceptedExternalMemoryEvent, 'round'>) => void | Promise<void>;
  hasOffscreenFact: (logicalEventKey: string) => boolean;
}

export async function consumeAcceptedOffscreenMemory(
  proposal: OffscreenEventProposal,
  receipt: OffscreenEventReceipt,
  memory: OffscreenMemoryPort,
): Promise<OffscreenEventReceipt> {
  if (receipt.status !== 'accepted' || receipt.consumers.variables !== 'done') return receipt;
  if (memory.hasOffscreenFact(proposal.logicalEventKey)) return { ...receipt, consumers: { ...receipt.consumers, memory: 'done' } };
  try {
    await memory.appendAcceptedEvent({
      status: 'accepted', eventId: proposal.logicalEventKey,
      title: proposal.description.slice(0, 80), text: proposal.description,
      entityIds: proposal.subjectIds,
      visibility: 'offscreen', playerKnown: false,
      acceptedAt: receipt.committedAt ?? Date.now(),
    });
    return { ...receipt, consumers: { ...receipt.consumers, memory: 'done' } };
  } catch {
    return { ...receipt, consumers: { ...receipt.consumers, memory: 'failed' } };
  }
}
