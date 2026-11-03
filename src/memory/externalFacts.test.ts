import { expect, test } from 'bun:test';
import { applyAcceptedExternalEvent, type AcceptedExternalMemoryEvent } from './externalFacts';
import { useMemoryStore } from './memoryStore';
import { collectMemoryEntries } from './memoryCandidates';

test('only accepted receipts become memory and retries do not duplicate events', () => {
  const runtime = structuredClone(useMemoryStore.getState().getMemoryRuntime());
  const receipt: AcceptedExternalMemoryEvent = { status: 'accepted', eventId: 'pact:1', round: 3, acceptedAt: 100, title: '秘密结盟', text: '甲与乙秘密结盟', entityIds: ['甲', '乙'], visibility: 'offscreen', playerKnown: false, knownBy: ['甲', '乙'] };
  expect(() => applyAcceptedExternalEvent(runtime, { ...receipt, status: 'proposed' } as never)).toThrow();
  const first = applyAcceptedExternalEvent(runtime, receipt);
  expect(first.status).toBe('applied');
  expect(first.runtime.sourceEvents.some(event => event.id === 'external:pact:1')).toBe(true);
  expect(collectMemoryEntries(first.runtime).some(entry => entry.title === '秘密结盟')).toBe(false);
  const second = applyAcceptedExternalEvent(first.runtime, receipt);
  expect(second.status).toBe('duplicate');
  expect(second.runtime.eventCards.length).toBe(first.runtime.eventCards.length);
  expect(runtime.sourceEvents.some(event => event.id === 'external:pact:1')).toBe(false);
});
