import { expect, test } from 'bun:test';
import { isMemoryVisible, revealMemoryWithEvidence, projectMemoryRuntime, annotateNarrativeDiscoveries } from './memoryVisibility';
import { formatRuntimeToCompiledText } from './compileFormatter';
import { collectMemoryEntries } from './memoryCandidates';
import { normalizeVectorFact } from './vectorUtils';
import { useMemoryStore } from './memoryStore';
import { applyIngestToRuntime } from './memoryPipeline';
import { parseNarrativeSummaryResult } from './narrativeParsers';

test('hidden memory is excluded from ordinary hot compilation and retrieval but readable by director', () => {
  useMemoryStore.getState().resetMemoryRuntime();
  const runtime = structuredClone(useMemoryStore.getState().getMemoryRuntime());
  runtime.eventCards.push({ id: 'secret', title: 'secret pact', summary: 'SECRET PACT', excerpt: '', importance: 5, status: 'hot', entityRefs: [], locationRefs: [], threadRefs: [], timeLabels: [], sourceStartIndex: 1, sourceEndIndex: 1, visibility: 'offscreen', playerKnown: false });
  expect(formatRuntimeToCompiledText(runtime, ['secret']).text).not.toContain('SECRET');
  expect(collectMemoryEntries(runtime)).toHaveLength(0);
  expect(projectMemoryRuntime(runtime, 'director').eventCards[0]?.id).toBe('secret');
  expect(collectMemoryEntries(runtime, 'director')).toHaveLength(1);
  expect(runtime.eventCards).toHaveLength(1);
});

test('legacy known facts stay visible, explicit secrecy needs a discovery source', () => {
  expect(isMemoryVisible({})).toBe(true);
  const hidden = { visibility: 'offscreen' as const, playerKnown: false, sourceEventIds: ['origin'] };
  expect(() => revealMemoryWithEvidence(hidden, { sourceEventId: '', round: 2, evidence: 'saw' })).toThrow();
  const revealed = revealMemoryWithEvidence(hidden, { sourceEventId: 'turn:2', round: 2, evidence: '证人出示契约' });
  expect(isMemoryVisible(revealed)).toBe(true);
  expect(hidden.playerKnown).toBe(false);
  expect(revealed.discovery?.sourceEventId).toBe('turn:2');
});

test('vector normalization preserves hidden provenance', () => {
  const fact = normalizeVectorFact({ fact: 'secret', visibility: 'offscreen', playerKnown: false, knownBy: ['npc:a'], sourceType: 'offscreen_event' });
  expect(fact?.sourceType).toBe('offscreen_event');
  expect(isMemoryVisible(fact!)).toBe(false);
});

test('same-name public entity cannot inherit hidden facts during an ordinary write', () => {
  const runtime = structuredClone(useMemoryStore.getState().getMemoryRuntime());
  applyIngestToRuntime(runtime, { entityPatches: [{ id: 'npc', name: '甲', stableFacts: ['SECRET PACT'], currentStatus: [], visibility: 'offscreen', playerKnown: false }] }, ['external:1'], 1);
  applyIngestToRuntime(runtime, { entityPatches: [{ id: 'npc', name: '甲', stableFacts: ['商人'], currentStatus: [] }] }, ['turn:2'], 2);
  expect(runtime.entityCards).toHaveLength(2);
  const visible = projectMemoryRuntime(runtime).entityCards;
  expect(visible).toHaveLength(1);
  expect(visible[0]!.stableFacts).toEqual(['商人']);
  expect(formatRuntimeToCompiledText(runtime, ['甲']).text).not.toContain('SECRET');
});

test('reunion records only the narrated injury as discovered while its hidden cause remains secret', () => {
  useMemoryStore.getState().resetMemoryRuntime();
  const runtime = structuredClone(useMemoryStore.getState().getMemoryRuntime());
  runtime.sourceEvents.push({ id: 'external:injury', round: 1, userText: '', assistantText: '甲执行秘密任务受伤', createdAt: 1, sourceType: 'offscreen_event', visibility: 'offscreen', playerKnown: false });
  applyIngestToRuntime(runtime, { entityPatches: [{ id: 'npc', name: '甲', stableFacts: ['执行秘密任务'], currentStatus: ['受伤'], layer: 'fact', visibility: 'offscreen', playerKnown: false }] }, ['external:injury'], 1);
  runtime.sourceEvents.push({ id: 'turn_2', round: 2, userText: '去见甲', assistantText: '你看见甲的右臂裹着绷带。', createdAt: 2 });
  const patch = { entityPatches: [{ id: 'npc', name: '甲', stableFacts: [], currentStatus: ['右臂裹着绷带'], layer: 'fact', evidence: ['甲的右臂裹着绷带'] }] };
  applyIngestToRuntime(runtime, annotateNarrativeDiscoveries(runtime, patch, 'turn_2', 2), ['turn_2'], 2);
  const known = projectMemoryRuntime(runtime).entityCards;
  expect(known).toHaveLength(1);
  expect(known[0]?.discovery).toEqual({ sourceEventId: 'turn_2', round: 2, evidence: '甲的右臂裹着绷带' });
  expect(JSON.stringify(known)).not.toContain('秘密任务');
  expect(runtime.sourceEvents[0]?.playerKnown).toBe(false);
  expect(annotateNarrativeDiscoveries(runtime, patch, 'external:injury', 1)).toBe(patch);
});

test('hidden sources quarantine derived summaries and every runtime section', () => {
  useMemoryStore.getState().resetMemoryRuntime();
  const runtime = structuredClone(useMemoryStore.getState().getMemoryRuntime());
  runtime.sourceEvents.push({ id: 'external:s', round: 1, userText: '', assistantText: 'SECRET', createdAt: 1, visibility: 'offscreen', playerKnown: false });
  runtime.summarySaveHistory.push({ savedAt: 1, status: 'success', sourceStartIndex: 1, sourceEndIndex: 1, sourceEventIds: ['external:s'], applyResult: { otherCharacterCount: 1, playerCount: 0, itemCount: 0 }, summaryData: { otherCharacterMemories: [{ title: 'SECRET', summary: 'SECRET', keywords: [] }], playerMemories: [], itemMemories: [] } });
  for (const key of ['activeThreads', 'stateSlots', 'relationEdges', 'relationNetwork', 'entityCards', 'archiveCards'] as const) {
    (runtime[key] as unknown[]).push({ id: key, title: 'SECRET', sourceEventIds: ['external:s'] });
  }
  runtime.sceneAnchor = { timeLabel: '', locationLabel: 'SECRET', presentEntities: [], immediateGoal: '', immediateRisk: '', conversationFocus: '', recentChange: '', confidence: 1, sourceEventIds: ['external:s'] };
  expect(collectMemoryEntries(runtime)).toHaveLength(0);
  expect(formatRuntimeToCompiledText(runtime, ['SECRET']).text).not.toContain('SECRET');
  expect(projectMemoryRuntime(runtime).sceneAnchor).toBeNull();
});

test('summary parsing, persistence and vector merge retain knowledge partitions', () => {
  const summary = parseNarrativeSummaryResult(JSON.stringify({ otherCharacterMemories: [{ title: '秘密', summary: '秘密', visibility: 'offscreen', playerKnown: false, knownBy: ['甲'] }] }));
  expect(isMemoryVisible(summary.otherCharacterMemories[0]!)).toBe(false);
  const store = useMemoryStore.getState();
  store.resetMemoryRuntime();
  store.initMemoryRuntime('visibility');
  store.appendSourceEvent({ id: 'hidden', round: 1, userText: '', assistantText: 'SECRET', createdAt: 1, sourceType: 'offscreen_event', visibility: 'offscreen', playerKnown: false });
  const hidden = normalizeVectorFact({ fact: 'SECRET', visibility: 'offscreen', playerKnown: false })!;
  const publicFact = normalizeVectorFact({ fact: '公开经营商铺' })!;
  store.appendVectorMemories([{ ...hidden, id: 'same' }, { ...publicFact, id: 'same' }]);
  const persisted = useMemoryStore.getState().toJSON();
  store.fromJSON(persisted);
  expect(isMemoryVisible(useMemoryStore.getState().getMemoryRuntime().sourceEvents[0]!)).toBe(false);
  const vectors = useMemoryStore.getState().vectorMemory;
  expect(vectors).toHaveLength(2);
  expect(vectors.filter(value => isMemoryVisible(value)).map(value => value.fact)).toEqual(['公开经营商铺']);
});
