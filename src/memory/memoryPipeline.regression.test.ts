import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultMemorySystemConfig } from './memoryConfig';
import {
  applyMemoryConflictDecision,
  buildMemoryBatchText,
  collectAllMemoriesFromRuntime,
  executeMemoryPrepareForMain,
} from './memoryPipeline';
import { useMemoryStore } from './memoryStore';
import { parseNarrativeSummaryResult } from './narrativeParsers';
import { normalizeEntityCard, normalizeProvenance } from './normalize';
import type { MemoryPipelineContext } from './useMemorySystem';

beforeEach(() => {
  useMemoryStore.setState({ config: createDefaultMemorySystemConfig() });
  useMemoryStore.getState().resetMemoryRuntime();
  useMemoryStore.getState().initMemoryRuntime('test-save');
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('long-running narrative memory regression', () => {
  test('writes the completed assistant narrative into the memory batch', () => {
    const batch = buildMemoryBatchText('打开月影门', '门后出现了失踪多年的守门人。');
    expect(batch).toContain('【玩家输入】\n打开月影门');
    expect(batch).toContain('【AI正文】\n门后出现了失踪多年的守门人。');
    expect(batch).not.toContain('等待AI回复');
  });

  test('retains more than ten rounds and recalls a matching old summary before main generation', async () => {
    const store = useMemoryStore.getState();
    for (let floor = 1; floor <= 12; floor++) {
      store.appendSummarySaveRecord({
        savedAt: floor,
        status: 'success',
        sourceStartIndex: floor,
        sourceEndIndex: floor,
        applyResult: { otherCharacterCount: 0, playerCount: 1, itemCount: 0 },
        summaryData: {
          otherCharacterMemories: [],
          playerMemories: [{
            title: floor === 1 ? '月影钥匙的约定' : `第${floor}轮记录`,
            summary: floor === 1 ? '守门人约定只能在满月时使用月影钥匙。' : `普通剧情${floor}`,
            keywords: floor === 1 ? ['月影钥匙', '守门人', '满月'] : [`剧情${floor}`],
          }],
          itemMemories: [],
        },
      });
    }

    expect(useMemoryStore.getState().memoryRuntime?.summarySaveHistory).toHaveLength(12);

    const ctx: MemoryPipelineContext = {
      floor: 13,
      batchText: '',
      inputText: '我现在可以使用月影钥匙了吗？',
      recentContext: '',
      playerName: '测试旅者',
      apiConfig: { baseUrl: 'http://localhost', apiKey: '', model: 'test' },
    };
    await executeMemoryPrepareForMain(useMemoryStore.getState(), ctx);

    expect(ctx._compiledContext).toContain('月影钥匙的约定');
    expect(ctx._compiledContext).toContain('只能在满月时使用月影钥匙');
  });

  test('uses configured embeddings for same-turn semantic recall', async () => {
    const config = createDefaultMemorySystemConfig();
    config.vectorEnabled = true;
    config.semanticRetrieveEnabled = true;
    config.vectorApiUrl = 'http://embedding.test/v1';
    config.vectorApiModel = 'local-embedding';
    config.vectorScoreThreshold = 0.5;
    useMemoryStore.setState({
      config,
      vectorMemory: [
        {
          id: 'moon-key', fact: '守门人要求只能在满月时使用月影钥匙。', keywords: ['月影钥匙'], entities: ['守门人'],
          primaryType: 'rule', secondaryTypes: [], characters: ['守门人'], locations: [], factions: [], items: ['月影钥匙'],
          abilities: [], events: [], rules: ['满月时使用'], timeMarkers: ['满月'], importance: 5, timeScope: 'long', state: 'active',
        },
        {
          id: 'market', fact: '集市每天清晨开放。', keywords: ['集市'], entities: ['集市'],
          primaryType: 'location', secondaryTypes: [], characters: [], locations: ['集市'], factions: [], items: [],
          abilities: [], events: [], rules: [], timeMarkers: ['清晨'], importance: 2, timeScope: 'mid', state: 'active',
        },
      ],
    });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { input: string | string[] };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return new Response(JSON.stringify({
        data: inputs.map((text, index) => ({
          index,
          embedding: String(text).includes('月影') || String(text).includes('特定月相') ? [1, 0] : [0, 1],
        })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const ctx: MemoryPipelineContext = {
      floor: 30,
      batchText: '',
      inputText: '我想打开那扇只有特定月相才能开启的门。',
      recentContext: '',
      playerName: '测试旅者',
      apiConfig: { baseUrl: 'http://localhost', apiKey: '', model: 'test' },
    };
    await executeMemoryPrepareForMain(useMemoryStore.getState(), ctx);

    expect(ctx._selectedVectorFacts?.map(item => item.id)).toContain('moon-key');
    expect(ctx._compiledContext).toContain('只能在满月时使用月影钥匙');
    expect(useMemoryStore.getState().vectorMemory[0].embedding).toEqual([1, 0]);
  });
});


describe('memory integrity invariants', () => {
  test('keeps the immutable source-event ledger without silently dropping old evidence', () => {
    const store = useMemoryStore.getState();
    store.setConfig({ retention: { ...store.config.retention, maxSourceEvents: 2 } });
    store.appendSourceEvent({ id: 'turn_1', round: 1, userText: 'a', assistantText: 'A', createdAt: 1 });
    store.appendSourceEvent({ id: 'turn_1', round: 1, userText: 'changed', assistantText: 'changed', createdAt: 2 });
    store.appendSourceEvent({ id: 'turn_2', round: 2, userText: 'b', assistantText: 'B', createdAt: 3 });
    store.appendSourceEvent({ id: 'turn_3', round: 3, userText: 'c', assistantText: 'C', createdAt: 4 });
    const events = useMemoryStore.getState().memoryRuntime?.sourceEvents ?? [];
    expect(events.map(event => event.id)).toEqual(['turn_1', 'turn_2', 'turn_3']);
    expect(events[0]).toMatchObject({ round: 1, userText: 'a', assistantText: 'A' });
    expect(events[2]).toMatchObject({ round: 3, userText: 'c', assistantText: 'C' });
  });

  test('includes every structured memory kind in retrieval candidates with provenance', () => {
    const runtime = useMemoryStore.getState().getMemoryRuntime();
    runtime.activeThreads.push({
      id: 'thread-1', title: '寻找月影门', summary: '门仍未开启', goal: '找到钥匙', status: 'open', priority: 5,
      blockingReason: '', relatedEntities: ['守门人'], relatedItems: ['月影钥匙'], relatedLocations: ['旧城'], deadline: '',
      sourceStartIndex: 2, sourceEndIndex: 3, sourceType: 'plot_fact', layer: 'fact', confidence: 0.9,
      sourceEventIds: ['turn_2'],
    });
    runtime.stateSlots.push({
      id: 'state-1', scopeType: 'world', scopeId: '月影门', slotType: '开启状态', value: '关闭', summary: '月影门仍然关闭',
      status: 'active', priority: 4, sourceStartIndex: 3, sourceEndIndex: 3, sourceType: 'system_state', layer: 'state', confidence: 1,
      sourceEventIds: ['turn_3'],
    });
    runtime.relationEdges.push({
      id: 'relation-1', sourceEntityId: '守门人', targetEntityId: '玩家', relationType: '盟友', stance: '信任', strength: 70,
      status: 'active', summary: '守门人决定协助玩家', sourceStartIndex: 4, sourceEndIndex: 4,
      sourceType: 'plot_fact', layer: 'fact', confidence: 0.8, sourceEventIds: ['turn_4'],
    });
    runtime.eventCards.push({
      id: 'event-1', title: '满月约定', summary: '满月时开启门', excerpt: '守门人给出约定', importance: 8, status: 'warm',
      entityRefs: ['守门人'], locationRefs: ['月影门'], threadRefs: ['thread-1'], timeLabels: ['满月'], sourceStartIndex: 4,
      sourceEndIndex: 4, sourceType: 'plot_fact', layer: 'fact', confidence: 0.95, sourceEventIds: ['turn_4'],
    });
    runtime.entityCards.push({
      id: 'entity-1', name: '守门人', entityType: 'character', aliases: [], currentStatus: ['在旧城'], stableFacts: ['知晓开启方法'],
      currentStance: '协助玩家', affiliations: [], relatedThreads: ['thread-1'], relatedEvents: ['event-1'], sourceStartIndex: 2,
      sourceEndIndex: 4, sourceType: 'world_fact', layer: 'fact', confidence: 1, sourceEventIds: ['turn_2', 'turn_4'],
    });
    runtime.archiveCards.push({
      id: 'archive-1', title: '初遇守门人', arcTitle: '月影门序章', summary: '玩家第一次见到守门人', timeSpan: '第1轮', keywords: ['守门人'],
      entityRefs: ['entity-1'], sourceStartIndex: 1, sourceEndIndex: 1, sourceType: 'plot_fact', layer: 'summary', confidence: 0.9,
      sourceEventIds: ['turn_1'],
    });

    const candidates = collectAllMemoriesFromRuntime(runtime);
    expect(new Set(candidates.map(item => item.type))).toEqual(new Set(['thread', 'state', 'relation', 'event', 'entity', 'archive']));
    expect(candidates.find(item => item.id === 'state-1')).toMatchObject({
      sourceType: 'system_state', layer: 'state', confidence: 1, sourceEventIds: ['turn_3'],
    });
  });

  test('summary parser supplies a complete provenance contract when the model omits optional metadata', () => {
    const parsed = parseNarrativeSummaryResult(JSON.stringify({
      playerMemories: [{ title: '本轮推进', summary: '玩家打开了月影门', keywords: ['月影门'] }],
    }));
    expect(parsed.playerMemories[0]).toMatchObject({
      sourceType: 'summary', layer: 'summary', confidence: 0.5,
      validFromRound: null, validUntilRound: null,
    });
  });

  test('applies semantic conflict decisions to state and relation objects', () => {
    const states = [
      { id: 'state-1', status: 'active', confidence: 0.6, conflictStatus: 'none' as const, validUntilRound: null },
      { id: 'state-1@12', status: 'expired', confidence: 0.6, conflictStatus: 'superseded' as const, validUntilRound: 12 },
    ];
    applyMemoryConflictDecision(states, 0, { action: 'supersede_current', confidence: 0.9 }, 12, 'expired');
    expect(states[0]).toMatchObject({ status: 'expired', conflictStatus: 'superseded', validUntilRound: 12 });
    expect(new Set(states.map(item => item.id)).size).toBe(states.length);

    const relations = [{ id: 'relation-1', status: 'active', confidence: 0.6, conflictStatus: 'none' as const }];
    applyMemoryConflictDecision(relations, 0, { action: 'update_current', confidence: 0.9 }, 13, 'changed');
    expect(relations[0]).toMatchObject({ status: 'active', conflictStatus: 'disputed', confidence: 0.9 });
  });

  test('keeps player inference out of stable entity facts', () => {
    const provenance = normalizeProvenance({ sourceType: 'world_fact', layer: 'inference' });
    expect(provenance).toMatchObject({ sourceType: 'player_inference', layer: 'inference' });
    const entity = normalizeEntityCard({
      id: 'npc-1', name: '猜测对象', stableFacts: ['未经证实'],
      sourceType: 'player_inference', layer: 'inference', factHistory: [],
    });
    expect(entity.stableFacts).toEqual([]);
    expect(entity.factHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ fact: '未经证实', sourceType: 'player_inference', layer: 'inference' }),
    ]));
  });

  test('preserves changed vector facts as superseded history', () => {
    const store = useMemoryStore.getState();
    const base = {
      id: 'fact-1', fact: '城门在夜间关闭', keywords: ['城门'], entities: ['城门'],
      primaryType: 'rule' as const, secondaryTypes: [], characters: [], locations: [], factions: [], items: [],
      abilities: [], events: [], rules: [], timeMarkers: [], importance: 5, timeScope: 'long' as const, state: 'active' as const,
      sourceStartIndex: 1, sourceEndIndex: 1,
    };
    store.appendVectorMemories([base]);
    store.appendVectorMemories([{ ...base, fact: '城门在夜间开放', sourceStartIndex: 2, sourceEndIndex: 2 }]);
    const facts = useMemoryStore.getState().vectorMemory;
    expect(facts).toHaveLength(2);
    expect(facts.some(item => item.conflictStatus === 'superseded')).toBe(true);
    expect(facts.some(item => item.previousVersionId === 'fact-1')).toBe(true);
  });
});
