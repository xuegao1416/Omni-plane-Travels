import type { GameState } from '../schema/variables';
import { acceptOffscreenEvent } from './offscreen';
import { consumeAcceptedOffscreenMemory, type OffscreenMemoryPort } from './memoryConsumer';
import type { DirectorReadContext, DirectorState, OffscreenEventProposal, OffscreenEventReceipt } from './types';

export async function submitOffscreenEvent(input: {
  proposal: OffscreenEventProposal;
  gameState: GameState;
  director: DirectorState;
  currentStateVersion: string;
  context?: DirectorReadContext;
  memory?: OffscreenMemoryPort;
}): Promise<{ state: GameState; receipt: OffscreenEventReceipt }> {
  const key = input.proposal.logicalEventKey;
  const existing = input.director.offscreenReceipts[key];
  const accepted = acceptOffscreenEvent(input.proposal, input.gameState, input.director, input.currentStateVersion, input.context);
  // Once variables commit, their original proposal owns the event payload forever.
  // A later model response must not replace it while the memory consumer retries.
  if (existing?.status === 'accepted' && accepted.receipt.status !== 'accepted') return accepted;
  const proposal = existing?.status === 'accepted' ? input.director.offscreenProposals[key] : input.proposal;
  if (!proposal) throw new Error('已提交幕后事件的原始内容缺失，无法安全补写记忆');
  if (existing?.status !== 'accepted') input.director.offscreenProposals[key] = structuredClone(proposal);
  let finalReceipt = accepted.receipt;
  if (input.memory && finalReceipt.status === 'accepted') finalReceipt = await consumeAcceptedOffscreenMemory(proposal, finalReceipt, input.memory);
  input.director.offscreenReceipts[key] = finalReceipt;
  return { state: accepted.state, receipt: finalReceipt };
}

export async function retryPendingOffscreenMemories(director: DirectorState, memory: OffscreenMemoryPort): Promise<OffscreenEventReceipt[]> {
  const updated: OffscreenEventReceipt[] = [];
  for (const [key, receipt] of Object.entries(director.offscreenReceipts)) {
    if (receipt.status !== 'accepted' || receipt.consumers.variables !== 'done' || receipt.consumers.memory === 'done') continue;
    const proposal = director.offscreenProposals[key];
    if (!proposal) continue;
    const next = await consumeAcceptedOffscreenMemory(proposal, receipt, memory);
    director.offscreenReceipts[key] = next;
    updated.push(next);
  }
  return updated;
}
