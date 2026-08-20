// 记忆系统管线执行器 - 从 useGameEngine.ts 提取
import { fetchRerank, requestCompletion } from '../api/client';
import { waitForRateLimit } from '../api/rateLimiter';
import type { MemoryPipelineContext } from './useMemorySystem';
import type {
  NarrativeMemoryRuntime, SummaryMemoryItem, VectorMemoryItem,
  NarrativeStateSlot, NarrativeRelationEdge, NarrativeRelationNetworkItem, NarrativeArchiveCard,
  NarrativeConflictJudgeResult,
} from './types';
import { cosineSimilarity, normalizeVectorFact } from './vectorUtils';
import { createEmbeddingClient, resolveEmbeddingEndpoint } from './embeddingRuntime';
import { normalizeProvenance } from './normalize';
import { collectMemoryEntries } from './memoryCandidates';
import {
  parseNarrativePayload,
  parseNarrativeIngestResult,
  parseNarrativeSummaryResult,
  parseNarrativeRetrievePlannerResult,
  parseNarrativeConflictJudgeResult,
  parseVectorQueryRewriteResult,
  parseRerankResult,
} from './narrativeParsers';

type MemoryStore = ReturnType<typeof import('./memoryStore').useMemoryStore.getState>;
type ConflictAction = NarrativeConflictJudgeResult['action'];
type ConflictDecisionMap = WeakMap<object, ConflictAction>;

export function buildMemoryBatchText(userText: string, assistantText: string): string {
  const parts: string[] = [];
  const user = String(userText ?? '').trim();
  const assistant = String(assistantText ?? '').trim();
  if (user) parts.push(`【玩家输入】\n${user}`);
  if (assistant) parts.push(`【AI正文】\n${assistant}`);
  return parts.join('\n\n');
}

function extractQueryTerms(inputText: string, recentContext = ''): string[] {
  const source = `${inputText}\n${recentContext.slice(-800)}`.toLowerCase();
  const terms = source
    .split(/[\s,，。！？、；："“”'‘’（）()【】\[\]\n]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2 && term.length <= 32);
  return [...new Set(terms)].slice(0, 24);
}

function selectSummaryEntriesForCurrentTurn(
  entries: MemoryPipelineContext['_selectedEntries'],
  inputText: string,
  recentContext: string,
  limit: number,
) {
  const query = `${inputText}\n${recentContext.slice(-800)}`.toLowerCase();
  return [...(entries ?? [])]
    .map(entry => {
      const keywordHits = entry.keywords.filter(keyword => {
        const normalized = String(keyword ?? '').trim().toLowerCase();
        return normalized.length >= 2 && query.includes(normalized);
      }).length;
      const title = entry.title.trim().toLowerCase();
      const titleHit = title.length >= 2 && query.includes(title) ? 2 : 0;
      return { entry, score: keywordHits * 3 + titleHit };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.savedAt - a.entry.savedAt)
    .slice(0, limit)
    .map(item => item.entry);
}

function vectorSearchText(item: VectorMemoryItem): string {
  return item.searchText?.trim()
    || [
      item.fact,
      item.summary,
      ...(Array.isArray(item.keywords) ? item.keywords : []),
      ...(Array.isArray(item.entities) ? item.entities : []),
    ].filter(Boolean).join(' ');
}

function getSourceEventId(round: number): string {
  return `turn_${Math.max(0, Math.floor(round))}`;
}

function extractAssistantText(batchText: string): string {
  const match = String(batchText ?? '').match(/【AI正文】\s*([\s\S]*)$/);
  return match?.[1]?.trim() || '';
}

function appendSourceEvent(memStore: MemoryStore, ctx: MemoryPipelineContext): string {
  const runtime = memStore.getMemoryRuntime();
  const id = getSourceEventId(ctx.floor);
  if (runtime.sourceEvents.some(event => event.id === id)) return id;
  const event = {
    id,
    round: Math.max(0, Math.floor(ctx.floor)),
    userText: String(ctx.inputText ?? ''),
    assistantText: String(ctx.assistantText ?? extractAssistantText(ctx.batchText)),
    createdAt: Date.now(),
  };
  runtime.sourceEvents = [...runtime.sourceEvents, event];
  return id;
}

async function recallVectorFacts(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const config = memStore.config;
  if (!config.vectorEnabled || !config.semanticRetrieveEnabled || memStore.vectorMemory.length === 0) return;
  const embeddingEndpoint = resolveEmbeddingEndpoint(config);
  if (config.vectorRuntime !== 'local' && (!embeddingEndpoint || !config.vectorApiModel.trim())) return;
  const embeddingClient = createEmbeddingClient({
    ...config,
    vectorApiKey: config.vectorApiKey.trim() || ctx.apiConfig.apiKey,
  });

  const eligible = memStore.vectorMemory.filter(item =>
    item.state !== 'expired'
      && item.conflictStatus !== 'superseded'
      && item.conflictStatus !== 'rejected'
      && item.importance >= config.vectorRetrieveMinImportance
  );
  if (eligible.length === 0) return;

  // 兼容旧存档：首次启用语义检索时，补齐已有事实的 embedding。
  const missing = eligible.filter(item => !Array.isArray(item.embedding) || item.embedding.length === 0);
  if (missing.length > 0) {
    const batchSize = 64;
    for (let start = 0; start < missing.length; start += batchSize) {
      const chunk = missing.slice(start, start + batchSize);
      const embeddings = await embeddingClient.embed(chunk.map(vectorSearchText));
      chunk.forEach((item, index) => {
        item.embedding = embeddings[index];
        item.embeddingTimestamp = Date.now();
      });
    }
    memStore.setVectorMemory([...memStore.vectorMemory]);
  }

  const queryText = config.vectorRetrieveUseContextQuery
    ? `${ctx.inputText}\n${ctx.recentContext.slice(-1000)}`
    : ctx.inputText;
  const [queryEmbedding] = await embeddingClient.embed([queryText]);
  if (!queryEmbedding) return;
  const scored = eligible
    .filter(item => Array.isArray(item.embedding) && item.embedding.length > 0)
    .map(item => ({ ...item, similarity: cosineSimilarity(queryEmbedding, item.embedding!) }))
    .filter(item => item.similarity >= config.vectorScoreThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, config.vectorRetrieveCandidateCount);

  let ranked = scored;
  if (
    scored.length > 1
    && (config.vectorRetrieveMode === 'cross_encoder' || config.vectorRetrieveMode === 'hybrid')
    && config.vectorRerankApiUrl.trim()
    && config.vectorRerankModel.trim()
  ) {
    const reranked = await fetchRerank({
      baseUrl: config.vectorRerankApiUrl.trim(),
      apiKey: config.vectorRerankApiKey.trim() || config.vectorApiKey.trim() || ctx.apiConfig.apiKey,
      model: config.vectorRerankModel.trim(),
    }, queryText, scored.map(vectorSearchText));
    const scoreByIndex = new Map(reranked.map(item => [item.index, item.relevance_score]));
    ranked = scored
      .map((item, index) => ({ ...item, similarity: scoreByIndex.get(index) ?? item.similarity }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  const perType = new Map<string, number>();
  ctx._selectedVectorFacts = ranked.filter(item => {
    const isHistoryIndex = item.id.startsWith('history_round_');
    const typeKey = isHistoryIndex ? '__history_index__' : item.primaryType;
    const typeLimit = isHistoryIndex
      ? Math.min(3, config.vectorRetrieveTopK)
      : config.vectorRetrieveMaxPerType;
    const count = perType.get(typeKey) ?? 0;
    if (count >= typeLimit) return false;
    perType.set(typeKey, count + 1);
    return true;
  }).slice(0, config.vectorRetrieveTopK);
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}超时(${ms / 1000}s)`)), ms)
    ),
  ]);
}

/** 调用记忆系统 AI */
export async function callMemoryAI(
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  systemPrompt: string,
  userContent: string,
  temperature = 0.3,
  timeoutMs = 120000,
): Promise<string> {
  // 限流保护
  await waitForRateLimit();

  try {
    // 非流式调用，加大超时到 120 秒
    const result = await withTimeout(
      requestCompletion(
        { ...apiConfig, provider: 'openai' },
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        { temperature },
      ),
      timeoutMs,
      '记忆AI调用',
    );
    return result.text;
  } catch (err) {
    console.error('[记忆AI] 调用失败:', err);
    throw err;
  }
}

/**
 * 正文生成前的本轮记忆准备。
 * 本地关键词召回始终可用；玩家配置真实 embedding 后再叠加语义召回。
 */
export async function executeMemoryPrepareForMain(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  if (!memStore.config.enabled) return;

  const allMemories = collectAllMemoriesFromRuntime(memStore.getMemoryRuntime());
  ctx._retrievalKeywords = extractQueryTerms(ctx.inputText, ctx.recentContext);
  ctx._selectedEntries = selectSummaryEntriesForCurrentTurn(
    allMemories,
    ctx.inputText,
    ctx.recentContext,
    memStore.config.compiler.rerankSelectedTotalLimit,
  );

  try {
    await recallVectorFacts(memStore, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!memStore.config.retrieval.vectorFallbackEnabled) {
      ctx._degradedStages = [...(ctx._degradedStages || []), 'memory_vector_strict_failure'];
      throw error;
    }
    memStore.appendRetrieveDebugLog({ kind: 'vector_recall', message, mode: 'error' });
    console.warn('[向量召回] 失败，已降级为本地关键词记忆:', message);
    ctx._degradedStages = [...(ctx._degradedStages || []), 'memory_vector'];
  }

  await executeMemoryCompile(memStore, ctx);
}

function uniqueVersionId(list: readonly object[], sourceId: string, currentRound: number): string {
  const baseId = `${sourceId}@${currentRound}`;
  let candidate = baseId;
  let suffix = 2;
  while (list.some(item => (item as Record<string, unknown>).id === candidate)) {
    candidate = `${baseId}@${suffix++}`;
  }
  return candidate;
}

/** Apply one semantic judge decision without assuming a specific memory-card status enum. */
export function applyMemoryConflictDecision<T extends object>(
  runtimeList: T[],
  existingIndex: number,
  decision: Pick<NarrativeConflictJudgeResult, 'action' | 'confidence'>,
  currentRound: number,
  supersededStatus?: string,
): void {
  const existing = runtimeList[existingIndex];
  if (!existing) return;
  const record = existing as Record<string, unknown>;
  if (decision.action === 'mark_expired' || decision.action === 'supersede_current') {
    const archivedId = typeof record.id === 'string' && record.id
      ? uniqueVersionId(runtimeList, record.id, currentRound)
      : undefined;
    runtimeList[existingIndex] = {
      ...record,
      ...(archivedId ? { id: archivedId } : {}),
      ...(supersededStatus ? { status: supersededStatus } : {}),
      conflictStatus: 'superseded',
      validUntilRound: currentRound,
    } as T;
    return;
  }
  if (decision.action === 'update_current') {
    runtimeList[existingIndex] = {
      ...record,
      conflictStatus: 'disputed',
      confidence: Math.max(Number(record.confidence) || 0.5, decision.confidence),
    } as T;
  }
}

// ─── 阶段1: 记忆写入（带重试）───

export async function executeMemoryWrite(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const runtime = memStore.getMemoryRuntime();
  const sourceEventId = appendSourceEvent(memStore, ctx);
  const templates = memStore.config.narrativePromptTemplates;
  const retryCount = memStore.config.writePipeline.retryCount ?? 2;
  const retryDelayMs = memStore.config.writePipeline.retryDelayMs ?? 1200;
  const maxAttempts = retryCount + 1;

  memStore.setLoading(true, '正在写入叙事记忆...');
  runtime.lastIngestAttemptAt = Date.now();

  let lastError: Error | null = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const referenceBlock = buildIngestReferenceBlock(runtime, ctx.playerName);
        const prompt = templates.ingest
          .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
          .replace(/\{\{叙事写入参考\}\}/g, referenceBlock)
          .replace(/\{\{剧情原文\}\}/g, ctx.batchText);

        const rawResult = await callMemoryAI(ctx.writeApiConfig ?? ctx.apiConfig, prompt, '请分析上述剧情并输出结构化叙事记忆 JSON。');
        const parsed = parseNarrativeIngestResult(rawResult) as unknown as Record<string, unknown>;
        const conflictDecisions: ConflictDecisionMap = new WeakMap();

        // 冲突裁决覆盖全部结构化对象；裁决失败时仍由 versionedUpsert 保留历史。
        if (memStore.config.writePipeline.conflictJudgeEnabled) {
          const conflictTasks: Array<() => Promise<void>> = [];
          type MemoryRecord = Record<string, unknown>;
          const sameIdOr = (left: MemoryRecord, right: MemoryRecord, fields: string[]) =>
            Boolean(left.id && right.id && left.id === right.id)
              || fields.every(field => left[field] != null && left[field] === right[field]);
          const specs: Array<{
            key: string;
            runtimeList: MemoryRecord[];
            matchFields: string[];
            supersededStatus?: string;
          }> = [
            { key: 'threadUpserts', runtimeList: runtime.activeThreads as unknown as MemoryRecord[], matchFields: ['title'], supersededStatus: 'superseded' },
            { key: 'stateSlotUpserts', runtimeList: runtime.stateSlots as unknown as MemoryRecord[], matchFields: ['scopeType', 'scopeId', 'slotType'], supersededStatus: 'expired' },
            { key: 'relationUpserts', runtimeList: runtime.relationEdges as unknown as MemoryRecord[], matchFields: ['sourceEntityId', 'targetEntityId', 'relationType'], supersededStatus: 'changed' },
            { key: 'relationNetworkUpserts', runtimeList: runtime.relationNetwork as unknown as MemoryRecord[], matchFields: ['sourceEntityId', 'targetEntityId', 'relationType'], supersededStatus: 'superseded' },
            { key: 'eventCandidates', runtimeList: runtime.eventCards as unknown as MemoryRecord[], matchFields: ['title'], supersededStatus: 'cold' },
            { key: 'entityPatches', runtimeList: runtime.entityCards as unknown as MemoryRecord[], matchFields: ['name'] },
            { key: 'archiveHints', runtimeList: runtime.archiveCards as unknown as MemoryRecord[], matchFields: ['title'] },
          ];

          const checkConflict = (spec: typeof specs[number]) => {
            const incomingList = parsed[spec.key] as Array<MemoryRecord | null> | undefined;
            if (!Array.isArray(incomingList)) return;
            for (let i = 0; i < incomingList.length; i++) {
              const incoming = incomingList[i];
              if (!incoming) continue;
              const existingIndex = spec.runtimeList.findIndex(existing =>
                existing.conflictStatus !== 'superseded'
                && existing.conflictStatus !== 'rejected'
                && existing.validUntilRound == null
                && sameIdOr(existing, incoming, spec.matchFields)
              );
              if (existingIndex >= 0) {
                conflictTasks.push(async () => {
                  try {
                    const existing = spec.runtimeList[existingIndex];
                    const judgePrompt = templates.conflictJudge
                      .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
                      .replace(/\{\{currentObject\}\}/g, JSON.stringify(existing))
                      .replace(/\{\{incomingObject\}\}/g, JSON.stringify(incoming));
                    const judgeRaw = await callMemoryAI(ctx.conflictJudgeApiConfig ?? ctx.apiConfig, judgePrompt, '请裁决冲突，输出 JSON。');
                    const judgeResult = parseNarrativeConflictJudgeResult(judgeRaw);
                    if (judgeResult.action === 'reject_incoming') {
                      incomingList[i] = null;
                    } else {
                      conflictDecisions.set(incoming, judgeResult.action);
                      if (judgeResult.action === 'mark_expired' || judgeResult.action === 'supersede_current') {
                        if (incoming.previousVersionId == null && typeof existing.id === 'string') {
                          incoming.previousVersionId = existing.id;
                        }
                        applyMemoryConflictDecision(spec.runtimeList, existingIndex, judgeResult, ctx.floor, spec.supersededStatus);
                      }
                    }
                  } catch {
                    // 裁决不可用时保留双方，避免一次 AI 失败静默覆盖旧事实。
                    conflictDecisions.set(incoming, 'keep_both');
                  }
                });
              }
            }
          };

          specs.forEach(checkConflict);

          if (conflictTasks.length > 0) {
            await Promise.all(conflictTasks.map(t => t()));
            for (const spec of specs) {
              const incomingList = parsed[spec.key];
              if (Array.isArray(incomingList)) parsed[spec.key] = incomingList.filter(Boolean);
            }
          }
        }

        applyIngestToRuntime(runtime, parsed, [sourceEventId], ctx.floor, conflictDecisions);
        runtime.lastIngestCursor = Math.max(runtime.lastIngestCursor, ctx.floor);
        if (runtime.lastIngestFailure?.status === 'active') {
          runtime.lastIngestFailure = {
            ...runtime.lastIngestFailure,
            status: 'resolved',
            resolvedAt: Date.now(),
          };
        }
        memStore.bumpRuntimeVersion();
        memStore.appendWriteDebugLog({ kind: 'ingest', message: '写入完成', sourceStartIndex: ctx.floor, sourceEndIndex: ctx.floor });
        return; // 成功，退出
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[记忆写入] 第 ${attempt}/${maxAttempts} 次尝试失败:`, lastError.message);

        if (attempt < maxAttempts) {
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    // 所有重试都失败
    const errorMessage = lastError?.message || '写入失败';
    runtime.lastIngestFailure = {
      occurredAt: Date.now(),
      message: errorMessage,
      sourceStartIndex: ctx.floor,
      sourceEndIndex: ctx.floor,
      cursor: runtime.lastIngestCursor,
      pendingCount: 1,
      attempt: maxAttempts,
      maxAttempts,
      source: 'post_assistant_turn',
      status: 'active',
      resolvedAt: 0,
    };
    memStore.bumpRuntimeVersion();
    memStore.appendWriteDebugLog({ kind: 'ingest', message: `写入失败: ${errorMessage}`, mode: 'error', sourceStartIndex: ctx.floor, sourceEndIndex: ctx.floor });
    console.error('[记忆写入] 所有重试都失败:', errorMessage);
    throw new Error(`记忆写入失败: ${errorMessage}`);
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段2: 摘要保存（带重试）───

export async function executeMemorySummary(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  if (!memStore.config.writePipeline.saveSummaryAfterIngest) return;
  const templates = memStore.config.narrativePromptTemplates;
  const retryCount = memStore.config.writePipeline.retryCount ?? 2;
  const retryDelayMs = memStore.config.writePipeline.retryDelayMs ?? 1200;
  const maxAttempts = retryCount + 1;

  memStore.setLoading(true, '正在保存剧情摘要...');

  try {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const prompt = templates.summary
          .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
          .replace(/\{\{batchText\}\}/g, ctx.batchText);

        const rawResult = await callMemoryAI(ctx.summaryApiConfig ?? ctx.apiConfig, prompt, '请为当前剧情批次产出结构化摘要 JSON。');
        const parsed = parseNarrativeSummaryResult(rawResult);
        const savedAt = Date.now();
        const sourceEventId = appendSourceEvent(memStore, ctx);
        const attachSource = (items: typeof parsed.playerMemories) => items.map(item => ({
          ...item,
          sourceType: item.sourceType ?? 'summary' as const,
          layer: item.layer ?? 'summary' as const,
          confidence: Number.isFinite(item.confidence) ? item.confidence : 0.5,
          sourceStartIndex: item.sourceStartIndex ?? ctx.floor,
          sourceEndIndex: item.sourceEndIndex ?? ctx.floor,
          validFromRound: item.validFromRound ?? ctx.floor,
          validUntilRound: item.validUntilRound ?? null,
          sourceEventIds: [...new Set([...(item.sourceEventIds || []), sourceEventId])],
        }));

        memStore.appendSummarySaveRecord({
          savedAt, status: 'success', sourceStartIndex: ctx.floor, sourceEndIndex: ctx.floor,
          sourceEventIds: [sourceEventId],
          applyResult: { otherCharacterCount: parsed.otherCharacterMemories.length, playerCount: parsed.playerMemories.length, itemCount: parsed.itemMemories.length },
          summaryData: { otherCharacterMemories: attachSource(parsed.otherCharacterMemories), playerMemories: attachSource(parsed.playerMemories), itemMemories: attachSource(parsed.itemMemories) },
        });
        memStore.bumpRuntimeVersion();
        return; // 成功，退出
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[摘要保存] 第 ${attempt}/${maxAttempts} 次尝试失败:`, lastError.message);

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    // 所有重试都失败
    const errorMessage = lastError?.message || '摘要保存失败';
    memStore.appendWriteDebugLog({ kind: 'summary', message: `摘要保存失败: ${errorMessage}`, mode: 'error' });
    console.error('[摘要保存] 所有重试都失败:', errorMessage);
    throw new Error(`摘要保存失败: ${errorMessage}`);
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段3: 向量提取 ───

export async function executeMemoryVector(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  if (!memStore.config.vectorEnabled) return;
  const templates = memStore.config.narrativePromptTemplates;
  memStore.setLoading(true, '正在提取向量事实...');

  try {
    const prompt = templates.vectorExtract
      .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
      .replace(/\{\{剧情原文\}\}/g, ctx.batchText);

    const rawResult = await callMemoryAI(ctx.vectorApiConfig ?? ctx.apiConfig, prompt, '请提取长期事实，输出 JSON 数组。');
    const parsed = parseNarrativePayload(rawResult);
    const factsArray = Array.isArray(parsed) ? parsed : Array.isArray(parsed.facts) ? parsed.facts : Array.isArray(parsed.data) ? parsed.data : [];
    const sourceEventId = appendSourceEvent(memStore, ctx);

    let vectorItems: VectorMemoryItem[] = factsArray
      .map((item: unknown, index: number) => {
        const fact = normalizeVectorFact(item);
        if (!fact) return null;
        return {
          ...fact,
          id: `vec_${ctx.floor}_${index}`,
          sourceStartIndex: ctx.floor,
          sourceEndIndex: ctx.floor,
          createdAt: Date.now(),
          sourceEventIds: [...new Set([...(fact.sourceEventIds || []), sourceEventId])],
          searchText: [fact.fact, ...fact.keywords, ...fact.entities].join(' '),
        } as VectorMemoryItem;
      })
      .filter((item): item is VectorMemoryItem => item != null);

    // 本地模型或真实 Embedding 服务可用时写入向量；失败仍保留文本事实供关键词兜底。
    const config = memStore.config;
    const embeddingEndpoint = resolveEmbeddingEndpoint(config);
    const canEmbed = config.vectorRuntime === 'local'
      || Boolean(embeddingEndpoint && config.vectorApiModel.trim());
    if (vectorItems.length > 0 && config.semanticRetrieveEnabled && canEmbed) {
      try {
        const embeddings = await createEmbeddingClient({
          ...config,
          vectorApiKey: config.vectorApiKey.trim() || ctx.apiConfig.apiKey,
        }).embed(vectorItems.map(vectorSearchText));
        const embeddedAt = Date.now();
        vectorItems = vectorItems.map((item, index) => ({
          ...item,
          embedding: embeddings[index],
          embeddingTimestamp: embeddedAt,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        memStore.appendWriteDebugLog({ kind: 'vector_embedding', message, mode: 'error' });
        console.warn('[向量写入] Embedding 失败，已保留文本事实:', message);
      }
    }

    memStore.appendVectorMemories(vectorItems);
    memStore.bumpRuntimeVersion();
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段4: 查询改写 ───

export async function executeMemoryQueryRewrite(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const rConfig = memStore.config.retrieval;
  if (!rConfig.useQueryRewrite) return;

  const templates = memStore.config.narrativePromptTemplates;
  memStore.setLoading(true, '正在查询改写...');

  try {
    const qrPrompt = templates.queryRewrite
      .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
      .replace(/\{\{inputText\}\}/g, ctx.inputText)
      .replace(/\{\{recentContext\}\}/g, ctx.recentContext.slice(-800))
      .replace(/\{\{entityTerms\}\}/g, '').replace(/\{\{timeTerms\}\}/g, '');
    const qrRaw = await callMemoryAI(ctx.retrievalApiConfig ?? ctx.apiConfig, qrPrompt, '请分析当前输入并输出查询改写 JSON。');
    const qrResult = parseVectorQueryRewriteResult(qrRaw);
    ctx._retrievalKeywords = qrResult.retrievalKeywords;
    ctx._semanticQuery = qrResult.semanticQuery || ctx.inputText;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询改写失败';
    console.warn('[查询改写] 失败:', message);
    ctx._retrievalKeywords = [];
    ctx._semanticQuery = ctx.inputText;
    ctx._degradedStages = ctx._degradedStages || [];
    ctx._degradedStages.push('memory_query_rewrite');
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段5: 检索规划 ───

export async function executeMemoryRetrievePlan(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const runtime = memStore.getMemoryRuntime();
  const allMemories = collectAllMemoriesFromRuntime(runtime);
  if (allMemories.length === 0) {
    return;
  }

  const templates = memStore.config.narrativePromptTemplates;
  const rConfig = memStore.config.retrieval;
  memStore.setLoading(true, '正在检索规划...');

  try {
    const semanticQuery = ctx._semanticQuery || ctx.inputText;
    const candidateList = allMemories.slice(0, rConfig.plannerCandidateLimit)
      .map((m, i) => `[${i}] ${m.title}（关键词：${m.keywords.join('、')}）`).join('\n');

    const plannerPrompt = templates.retrievePlanner
      .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
      .replace(/\{\{inputText\}\}/g, ctx.inputText)
      .replace(/\{\{recentContext\}\}/g, ctx.recentContext.slice(-600))
      .replace(/\{\{compiledNarrativeContext\}\}/g, '无')
      .replace(/\{\{compiledNarrativeSections\}\}/g, '无')
      .replace(/\{\{semanticAnalysis\}\}/g, semanticQuery)
      .replace(/\{\{summaryHistory\}\}/g, `共 ${runtime.summarySaveHistory.length} 条摘要`)
      .replace(/\{\{memoryCandidates\}\}/g, candidateList || '无候选');

    const plannerRaw = await callMemoryAI(ctx.retrievalApiConfig ?? ctx.apiConfig, plannerPrompt, '请规划需要注入的记忆，输出 JSON。');
    const plannerResult = parseNarrativeRetrievePlannerResult(plannerRaw);
    ctx._plannerResult = plannerResult;
    ctx._finalSelectedTitles = [...plannerResult.items.map(i => i.title)];
    ctx._candidateList = candidateList;
    ctx._allMemories = allMemories;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '检索规划失败';
    console.warn('[检索规划] 失败:', message);
    ctx._plannerResult = undefined;
    ctx._finalSelectedTitles = [];
    ctx._degradedStages = ctx._degradedStages || [];
    ctx._degradedStages.push('memory_retrieve_plan');
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段6: 多轮补充 ───

export async function executeMemoryMultiRound(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const rConfig = memStore.config.retrieval;
  if (!rConfig.multiRoundEnabled || !ctx._plannerResult) return;

  const runtime = memStore.getMemoryRuntime();
  const templates = memStore.config.narrativePromptTemplates;
  memStore.setLoading(true, '正在多轮补充...');

  try {
    const semanticQuery = ctx._semanticQuery || ctx.inputText;
    const candidateList = ctx._candidateList || '';
    const maxRounds = rConfig.multiRoundMaxRounds;
    let previousResults = ctx._plannerResult.items.map(item => `${item.title}: ${item.reason || ''}`).join('\n');

    for (let round = 2; round <= maxRounds; round++) {
      try {
        const isLast = round === maxRounds;
        const multiPrompt = isLast ? templates.multiRoundRetrievePlannerFinal : templates.multiRoundRetrievePlanner;

        const multiFilled = multiPrompt
          .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
          .replace(/\{\{currentRound\}\}/g, String(round))
          .replace(/\{\{maxRounds\}\}/g, String(maxRounds))
          .replace(/\{\{inputText\}\}/g, ctx.inputText)
          .replace(/\{\{recentContext\}\}/g, ctx.recentContext.slice(-600))
          .replace(/\{\{compiledNarrativeContext\}\}/g, '无')
          .replace(/\{\{compiledNarrativeSections\}\}/g, '无')
          .replace(/\{\{semanticAnalysis\}\}/g, semanticQuery)
          .replace(/\{\{summaryHistory\}\}/g, `共 ${runtime.summarySaveHistory.length} 条摘要`)
          .replace(/\{\{memoryCandidates\}\}/g, candidateList || '无候选')
          .replace(/\{\{previousResults\}\}/g, previousResults);

        const multiRaw = await callMemoryAI(ctx.retrievalApiConfig ?? ctx.apiConfig, multiFilled, '请补充遗漏的记忆，输出 JSON。');
        const multiResult = parseNarrativeRetrievePlannerResult(multiRaw);

        const multiTitles = multiResult.items.map(i => i.title);
        if (multiTitles.length === 0) break;

        if (!ctx._finalSelectedTitles) ctx._finalSelectedTitles = [];
        ctx._finalSelectedTitles.push(...multiTitles);
        previousResults += '\n' + multiResult.items.map(item => `${item.title}: ${item.reason || ''}`).join('\n');
      } catch (roundErr) {
        console.warn('[多轮补充] 单轮失败，提前终止:', roundErr instanceof Error ? roundErr.message : roundErr);
        break;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '多轮补充失败';
    console.warn('[多轮补充] 失败:', message);
    ctx._degradedStages = ctx._degradedStages || [];
    ctx._degradedStages.push('memory_multi_round');
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段7: 精排 ───

export async function executeMemoryRerank(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const rConfig = memStore.config.retrieval;
  if (!rConfig.useRerank) {
    return;
  }

  const allMemories = ctx._allMemories || collectAllMemoriesFromRuntime(memStore.getMemoryRuntime());
  const finalSelectedTitles = ctx._finalSelectedTitles || [];
  if (allMemories.length === 0 || finalSelectedTitles.length === 0) {
    return;
  }

  const templates = memStore.config.narrativePromptTemplates;
  memStore.setLoading(true, '正在精排...');

  try {
    // 先做本地匹配
    const titleSelected = allMemories.filter(m =>
      finalSelectedTitles.some(t => t === m.title || (m.title ?? '').includes(t) || t.includes(m.title ?? ''))
    );

    const rerankPrompt = templates.rerank
      .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
      .replace(/\{\{query\}\}/g, ctx.inputText)
      .replace(/\{\{candidates\}\}/g, titleSelected.map((m, i) => `[${i}] ${m.title}: ${m.summary}`).join('\n'));

    const rerankRaw = await callMemoryAI(ctx.retrievalApiConfig ?? ctx.apiConfig, rerankPrompt, '请对候选记忆精排打分，输出 JSON。');
    const rerankResult = parseRerankResult(rerankRaw);
    ctx._rerankResult = rerankResult;

    // 按精排分数重新排序
    const scoreMap = new Map(rerankResult.rankings.map(r => [r.index, r.score]));
    const sortedEntries = [...titleSelected]
      .map((entry, index) => ({ entry, score: scoreMap.get(index) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => entry);

    ctx._selectedEntries = sortedEntries;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '精排失败';
    console.warn('[精排] 失败:', message);
    // 精排失败，使用原始排序
    const titleSelected = allMemories.filter(m =>
      finalSelectedTitles.some(t => t === m.title || (m.title ?? '').includes(t) || t.includes(m.title ?? ''))
    );
    ctx._selectedEntries = titleSelected;
    ctx._degradedStages = ctx._degradedStages || [];
    ctx._degradedStages.push('memory_rerank');
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段8: 检索收尾 ───

export async function executeMemoryRetrieveFinalize(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const runtime = memStore.getMemoryRuntime();
  const allMemories = collectAllMemoriesFromRuntime(runtime);
  const rConfig = memStore.config.retrieval;
  memStore.setLoading(true, '正在检索收尾...');

  try {
    const finalSelectedTitles = ctx._finalSelectedTitles || [];
    const retrievalKeywords = ctx._retrievalKeywords || [];
    const plannerKeywords = ctx._plannerResult?.retrievalKeywords || [];
    const allKeywords = [...new Set([...retrievalKeywords, ...plannerKeywords])];

    // 标题匹配
    const titleSelected = allMemories.filter(m =>
      finalSelectedTitles.some(t => t === m.title || (m.title ?? '').includes(t) || t.includes(m.title ?? ''))
    );

    // 关键词命中率补充
    const threshold = rConfig.keywordRecallThreshold / 100;
    const keywordSelected = allMemories.filter(m => {
      if (titleSelected.some(t => t.id === m.id)) return false;
      const mk = m.keywords.map(k => k.toLowerCase());
      const rk = allKeywords.map(k => k.toLowerCase());
      const matched = mk.filter(k => rk.some(r => r.includes(k) || k.includes(r)));
      return mk.length > 0 && (matched.length / mk.length) >= threshold;
    });

    // 去重 + 排序
    const seen = new Set<string>();
    const deduped = [...titleSelected, ...keywordSelected].filter(e => {
      const key = e.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => a.sourceFloor - b.sourceFloor);

    ctx._selectedEntries = deduped;
    memStore.setRetrievePlan({
      plannedAt: Date.now(),
      candidates: allMemories.map(m => ({ title: m.title })),
      selectedTitles: deduped.map(m => m.title),
      selectedModes: deduped.map(() => 'keyword_hit'),
      strategy: `AI规划 ${ctx._plannerResult?.items.length ?? 0} 条 + 关键词补充 ${keywordSelected.length} 条 → ${deduped.length} 条`,
    });
  } finally {
    memStore.setLoading(false);
  }
}

// ─── 阶段9: 上下文编译 ───

export async function executeMemoryCompile(memStore: MemoryStore, ctx: MemoryPipelineContext): Promise<void> {
  const { formatRuntimeToCompiledText, DEFAULT_COMPILE_BUDGET } = await import('./compileFormatter');
  const runtime = memStore.getMemoryRuntime();

  // 提取查询关键词：优先使用检索阶段产出的关键词，否则从用户输入分词
  const queryKeywords = ctx._retrievalKeywords?.length
    ? ctx._retrievalKeywords
    : ctx.inputText.split(/[\s,，。！？、；：""''（）【】\n]+/).filter(w => w.length >= 2);

  const result = formatRuntimeToCompiledText(runtime, queryKeywords, DEFAULT_COMPILE_BUDGET, ctx.resourceState);

  const retrievedLines = (ctx._selectedEntries ?? [])
    .slice(0, memStore.config.compiler.rerankSelectedTotalLimit)
    .map(entry => `- [第${entry.sourceFloor}轮] ${entry.title}：${entry.summary}`);
  const vectorLines = (ctx._selectedVectorFacts ?? [])
    .slice(0, memStore.config.vectorRetrieveTopK)
    .map(entry => {
      const fact = String(entry.fact ?? '').trim();
      const clipped = fact.length > 900 ? `${fact.slice(0, 900)}…` : fact;
      return `- [长期事实] ${clipped}`;
    });
  const recallLines = [...retrievedLines, ...vectorLines];

  // 控制检索补充层体积，避免长存档把系统提示撑爆。
  const recallBudgetChars = 2400;
  const keptRecallLines: string[] = [];
  let recallChars = 0;
  for (const line of recallLines) {
    if (keptRecallLines.length > 0 && recallChars + line.length > recallBudgetChars) break;
    keptRecallLines.push(line);
    recallChars += line.length;
  }
  const recallText = keptRecallLines.length > 0
    ? `【本轮检索到的长期记忆】\n${keptRecallLines.join('\n')}`
    : '';
  const fullText = [result.text, recallText].filter(Boolean).join('\n\n');
  if (recallText) result.sections.retrieved = recallText;

  ctx._compiledContext = fullText;
  memStore.setCompiledContext({
    compiledAt: Date.now(),
    fullText,
    sections: result.sections,
    sceneAnchor: runtime.sceneAnchor,
  });

  memStore.appendCompileDebugLog({
    kind: 'compile',
    message: `双层编译完成: ${result.tokenEstimate + Math.ceil(recallText.length / 2.5)} tokens, hot=[${Object.values(result.hotIds).flat().length} items], recalled=${keptRecallLines.length}`,
    sourceStartIndex: ctx.floor,
    sourceEndIndex: ctx.floor,
  });
}

// ─── 内部工具函数 ───

function buildIngestReferenceBlock(runtime: NarrativeMemoryRuntime, playerName: string): string {
  const parts: string[] = [];
  if (runtime.sceneAnchor) {
    const sa = runtime.sceneAnchor;
    parts.push(`场景：${sa.locationLabel || '未知'} | ${sa.timeLabel || '未知'} | 目标：${sa.immediateGoal || '无'} | 风险：${sa.immediateRisk || '无'}`);
  }
  const threads = runtime.activeThreads.filter(t => t.status === 'open' || t.status === 'blocked');
  if (threads.length > 0) parts.push(`活跃线程：${threads.map(t => `${t.title}(${t.status})`).join('、')}`);
  const slots = runtime.stateSlots.filter(s => s.status === 'active');
  if (slots.length > 0) parts.push(`状态槽：${slots.map(s => `${s.slotType}(${s.scopeId})`).join('、')}`);
  // 关系网带地点标注，帮助 AI 理解空间上下文
  if (runtime.relationNetwork.length > 0) {
    const rels = runtime.relationNetwork
      .filter(r => r.status === 'active' || r.status === 'changed')
      .slice(0, 8)
      .map(r => {
        const loc = r.locationScope ? `[${r.locationScope}]` : '';
        return `${r.sourceEntityId}→${r.targetEntityId}(${r.relationType}${loc})`;
      });
    if (rels.length > 0) parts.push(`关系网：${rels.join('、')}`);
  }
  return parts.length > 0 ? parts.join('\n') : '暂无已知参考锚点';
}

function meaningfulSnapshot(value: Record<string, unknown>): string {
  const ignored = new Set(['createdAt', 'updatedAt', 'sourceEventIds', 'previousVersionId', 'validFromRound', 'validUntilRound', 'conflictStatus']);
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key))));
}

function versionedUpsert<T extends { id: string }>(
  list: T[],
  incoming: T,
  matcher: (item: T) => boolean,
  currentRound: number,
  options: { conflictAction?: ConflictAction } = {},
): void {
  const asRecord = (value: T): Record<string, unknown> => value as unknown as Record<string, unknown>;
  const idx = list.findIndex(item => {
    const record = asRecord(item);
    return matcher(item)
      && record.conflictStatus !== 'superseded'
      && record.conflictStatus !== 'rejected'
      && record.validUntilRound == null;
  });
  if (idx < 0) {
    const record = asRecord(incoming);
    list.push({
      ...incoming,
      ...(record.createdAt == null ? { createdAt: Date.now() } : {}),
      updatedAt: Date.now(),
    } as T);
    return;
  }
  const existing = list[idx];
  const existingRecord = asRecord(existing);
  const incomingRecord = asRecord(incoming);
  if (meaningfulSnapshot(existingRecord) === meaningfulSnapshot(incomingRecord)) {
    const existingSourceIds = Array.isArray(existingRecord.sourceEventIds)
      ? existingRecord.sourceEventIds.filter((id): id is string => typeof id === 'string')
      : [];
    const incomingSourceIds = Array.isArray(incomingRecord.sourceEventIds)
      ? incomingRecord.sourceEventIds.filter((id): id is string => typeof id === 'string')
      : [];
    list[idx] = {
      ...existing,
      ...incoming,
      sourceEventIds: [...new Set([...existingSourceIds, ...incomingSourceIds])],
      updatedAt: Date.now(),
    } as T;
    return;
  }
  if (options.conflictAction === 'update_current') {
    list[idx] = {
      ...existing,
      ...incoming,
      id: existing.id,
      createdAt: existingRecord.createdAt ?? incomingRecord.createdAt ?? Date.now(),
      sourceEventIds: [...new Set([
        ...(Array.isArray(existingRecord.sourceEventIds) ? existingRecord.sourceEventIds.filter((id): id is string => typeof id === 'string') : []),
        ...(Array.isArray(incomingRecord.sourceEventIds) ? incomingRecord.sourceEventIds.filter((id): id is string => typeof id === 'string') : []),
      ])],
      conflictStatus: 'none',
      validUntilRound: incomingRecord.validUntilRound ?? null,
      updatedAt: Date.now(),
    } as T;
    return;
  }
  if (options.conflictAction === 'keep_both') {
    const baseId = String(incoming.id || `${existing.id}@${currentRound}`);
    let branchId = `${baseId}@branch`;
    let branchIndex = 2;
    while (list.some(item => item.id === branchId)) {
      branchId = `${baseId}@branch${branchIndex++}`;
    }
    list.push({
      ...incoming,
      id: branchId,
      previousVersionId: incomingRecord.previousVersionId ?? existing.id,
      ...(incomingRecord.createdAt == null ? { createdAt: Date.now() } : {}),
      updatedAt: Date.now(),
    } as T);
    return;
  }
  const oldId = existing.id;
  list[idx] = {
    ...existing,
    id: uniqueVersionId(list, oldId, currentRound),
    conflictStatus: 'superseded',
    validUntilRound: currentRound,
    updatedAt: Date.now(),
  } as T;
  list.push({
    ...incoming,
    id: incoming.id || oldId,
    previousVersionId: oldId,
    ...(incomingRecord.createdAt == null ? { createdAt: Date.now() } : {}),
    updatedAt: Date.now(),
  } as T);
}
function normalizeIncomingObject(raw: Record<string, unknown>, sourceEventIds: string[], currentRound: number): Record<string, unknown> {
  const normalized = normalizeProvenance({ ...raw });
  const existingIds = Array.isArray(normalized.sourceEventIds)
    ? normalized.sourceEventIds.filter((id): id is string => typeof id === 'string')
    : [];
  normalized.sourceEventIds = [...new Set([...existingIds, ...sourceEventIds])];
  if (normalized.validFromRound == null) normalized.validFromRound = currentRound;
  if ('sourceStartIndex' in normalized && normalized.sourceStartIndex == null) normalized.sourceStartIndex = currentRound;
  if ('sourceEndIndex' in normalized && normalized.sourceEndIndex == null) normalized.sourceEndIndex = currentRound;
  return normalized;
}

function applyIngestToRuntime(
  runtime: NarrativeMemoryRuntime,
  parsed: Record<string, unknown>,
  sourceEventIds: string[] = [],
  currentRound = 0,
  conflictDecisions?: ConflictDecisionMap,
): void {
  const scenePatch = parsed.scenePatch as Record<string, string> | undefined;
  if (scenePatch && typeof scenePatch === 'object') {
    const existing = runtime.sceneAnchor;
    const oldLocation = existing?.locationLabel || '';

    // 替换式更新：AI 返回空字符串也视为"有意清空"，不用 ?? 回退到旧值
    const pick = (field: string, fallback: string = '') =>
      scenePatch[field] !== undefined && scenePatch[field] !== null
        ? String(scenePatch[field])
        : (existing?.[field as keyof typeof existing] as string ?? fallback);

    const newLocation = pick('locationLabel');
    const newPresentEntities = Array.isArray(scenePatch.presentEntities)
      ? scenePatch.presentEntities as string[]
      : (Array.isArray(existing?.presentEntities) ? existing.presentEntities : []);

    const sceneProvenance = normalizeIncomingObject(scenePatch, sourceEventIds, currentRound);
    runtime.sceneAnchor = {
      timeLabel: pick('timeLabel'),
      locationLabel: newLocation,
      presentEntities: newPresentEntities,
      immediateGoal: pick('immediateGoal'),
      immediateRisk: pick('immediateRisk'),
      conversationFocus: pick('conversationFocus'),
      recentChange: pick('recentChange'),
      confidence: Number(scenePatch.confidence) || existing?.confidence || 0.5,
      sourceType: sceneProvenance.sourceType as any,
      validFromRound: sceneProvenance.validFromRound as number | null,
      validUntilRound: sceneProvenance.validUntilRound as number | null,
      sourceEventIds: sceneProvenance.sourceEventIds as string[],
      updatedAt: Date.now(),
    };

    // 地点变化时：将旧地点的空间关系降级为 changed
    if (newLocation && oldLocation && newLocation !== oldLocation) {
      for (const edge of runtime.relationNetwork) {
        if (edge.locationScope && edge.locationScope === oldLocation && edge.status === 'active') {
          edge.status = 'changed';
          edge.updatedAt = Date.now();
        }
      }
      for (const edge of runtime.relationEdges) {
        if (edge.locationScope && edge.locationScope === oldLocation && edge.status === 'active') {
          edge.status = 'changed';
          edge.updatedAt = Date.now();
        }
      }
    }
  }

  const threadUpserts = parsed.threadUpserts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(threadUpserts)) {
    for (const thread of threadUpserts) {
      const incoming = normalizeIncomingObject(thread, sourceEventIds, currentRound) as unknown as typeof runtime.activeThreads[number];
      versionedUpsert(runtime.activeThreads, incoming, item => item.id === incoming.id, currentRound, { conflictAction: conflictDecisions?.get(thread) });
    }
  }

  const eventCandidates = parsed.eventCandidates as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(eventCandidates)) {
    for (const card of eventCandidates) {
      const incoming = normalizeIncomingObject(card, sourceEventIds, currentRound) as unknown as typeof runtime.eventCards[number];
      versionedUpsert(runtime.eventCards, incoming, item => item.id === incoming.id || item.title === incoming.title, currentRound, { conflictAction: conflictDecisions?.get(card) });
    }
  }

  const entityPatches = parsed.entityPatches as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(entityPatches)) {
    const ensureArr = (v: unknown): string[] => Array.isArray(v) ? v as string[] : (v ? [String(v)] : []);
    for (const patch of entityPatches) {
      Object.assign(patch, normalizeIncomingObject(patch, sourceEventIds, currentRound));
      // 防御：currentStatus/aliases/stableFacts/affiliations 应为数组，AI 可能返回字符串
      for (const arrField of ['currentStatus', 'aliases', 'stableFacts', 'affiliations', 'relatedThreads', 'relatedEvents']) {
        if (patch[arrField] && !Array.isArray(patch[arrField])) {
          patch[arrField] = [patch[arrField]];
        }
      }
      const idx = runtime.entityCards.findIndex(c => (c.id === patch.id || c.name === patch.name) && c.conflictStatus !== 'superseded' && c.validUntilRound == null);
      const existing = idx >= 0 ? runtime.entityCards[idx] : undefined;
      const priorFacts = ensureArr(existing?.stableFacts);
      const incomingFacts = ensureArr(patch.stableFacts);
      const inferenceOnly = patch.layer === 'inference' || patch.sourceType === 'player_inference';
      const acceptedFacts = inferenceOnly ? [] : incomingFacts;
      const inferredFacts = inferenceOnly ? incomingFacts : [];
      const oldLocFacts = Array.isArray(existing?.locationFacts) ? existing.locationFacts : [];
      const newLocFacts = Array.isArray(patch.locationFacts) ? patch.locationFacts as Array<{ location: string; fact: string }> : [];
      const mergedLocFacts = [...oldLocFacts, ...newLocFacts].filter((v, i, arr) => arr.findIndex(x => x.location === v.location && x.fact === v.fact) === i).slice(-15);
      const factHistory = Array.isArray(existing?.factHistory) ? [...existing.factHistory] : [];
      if (inferredFacts.length > 0) factHistory.push(...inferredFacts.map(fact => ({ fact, recordedAt: Date.now(), sourceType: 'player_inference' as const, layer: 'inference' as const, confidence: Number(patch.confidence) || 0.5, sourceEventIds: patch.sourceEventIds as string[] })));
      if (existing && acceptedFacts.some(fact => !priorFacts.includes(fact))) factHistory.push(...priorFacts.map(fact => ({ fact, recordedAt: Date.now(), sourceType: existing.sourceType, layer: existing.layer, confidence: existing.confidence, sourceEventIds: existing.sourceEventIds })));
      const candidate = {
        ...(existing || {}), ...patch,
        stableFacts: [...new Set([...priorFacts, ...acceptedFacts])].slice(-10),
        factHistory: factHistory.slice(-20),
        locationFacts: mergedLocFacts,
      } as typeof runtime.entityCards[number];
      const conflictAction = conflictDecisions?.get(patch);
      if (idx >= 0) {
        const oldId = runtime.entityCards[idx].id;
        if (meaningfulSnapshot(runtime.entityCards[idx] as unknown as Record<string, unknown>) === meaningfulSnapshot(candidate as unknown as Record<string, unknown>)) runtime.entityCards[idx] = { ...runtime.entityCards[idx], sourceEventIds: candidate.sourceEventIds, updatedAt: Date.now() };
        else if (conflictAction === 'update_current') {
          runtime.entityCards[idx] = {
            ...runtime.entityCards[idx],
            ...candidate,
            id: oldId,
            createdAt: runtime.entityCards[idx].createdAt ?? candidate.createdAt,
            sourceEventIds: [...new Set([...(runtime.entityCards[idx].sourceEventIds || []), ...(candidate.sourceEventIds || [])])],
            conflictStatus: 'none',
            validUntilRound: candidate.validUntilRound ?? null,
            updatedAt: Date.now(),
          };
        } else if (conflictAction === 'keep_both') {
          const baseId = String(candidate.id || oldId);
          let branchId = `${baseId}@branch`;
          let branchIndex = 2;
          while (runtime.entityCards.some(item => item.id === branchId)) branchId = `${baseId}@branch${branchIndex++}`;
          runtime.entityCards.push({ ...candidate, id: branchId, previousVersionId: candidate.previousVersionId ?? oldId, createdAt: Date.now(), updatedAt: Date.now() });
        } else {
          runtime.entityCards[idx] = { ...runtime.entityCards[idx], id: uniqueVersionId(runtime.entityCards, oldId, currentRound), conflictStatus: 'superseded', validUntilRound: currentRound, updatedAt: Date.now() };
          runtime.entityCards.push({ ...candidate, id: String(patch.id || oldId), previousVersionId: oldId, createdAt: Date.now(), updatedAt: Date.now() });
        }
      } else runtime.entityCards.push({ ...candidate, createdAt: Date.now(), updatedAt: Date.now() });
    }
  }

  // stateSlotUpserts — 作用域状态变量
  const stateSlotUpserts = parsed.stateSlotUpserts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(stateSlotUpserts)) {
    for (const slot of stateSlotUpserts) {
      const incoming = normalizeIncomingObject(slot, sourceEventIds, currentRound) as unknown as typeof runtime.stateSlots[number];
      const existing = runtime.stateSlots.find(item => item.id === incoming.id && item.conflictStatus !== 'superseded' && item.validUntilRound == null);
      const history = existing && (existing.value !== incoming.value || existing.summary !== incoming.summary)
        ? [...(existing.history || []), { value: existing.value, summary: existing.summary, recordedAt: Date.now(), sourceType: existing.sourceType, layer: existing.layer, confidence: existing.confidence, sourceEventIds: existing.sourceEventIds }].slice(-12)
        : existing?.history;
      versionedUpsert(runtime.stateSlots, { ...incoming, ...(history ? { history } : {}) }, item => item.id === incoming.id, currentRound, { conflictAction: conflictDecisions?.get(slot) });
    }
  }

  // relationUpserts — 实体关系边
  const relationUpserts = parsed.relationUpserts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(relationUpserts)) {
    for (const edge of relationUpserts) {
      const incoming = normalizeIncomingObject(edge, sourceEventIds, currentRound) as unknown as typeof runtime.relationEdges[number];
      versionedUpsert(runtime.relationEdges, incoming, item => item.id === incoming.id || (item.sourceEntityId === incoming.sourceEntityId && item.targetEntityId === incoming.targetEntityId && item.relationType === incoming.relationType), currentRound, { conflictAction: conflictDecisions?.get(edge) });
    }
  }

  // relationNetworkUpserts — 高置信度关系网络
  const relationNetworkUpserts = parsed.relationNetworkUpserts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(relationNetworkUpserts)) {
    for (const item of relationNetworkUpserts) {
      const incoming = normalizeIncomingObject(item, sourceEventIds, currentRound) as unknown as typeof runtime.relationNetwork[number];
      versionedUpsert(runtime.relationNetwork, incoming, existing => existing.id === incoming.id || (existing.sourceEntityId === incoming.sourceEntityId && existing.targetEntityId === incoming.targetEntityId && existing.relationType === incoming.relationType), currentRound, { conflictAction: conflictDecisions?.get(item) });
    }
  }

  // archiveHints — 归档故事弧
  const archiveHints = parsed.archiveHints as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(archiveHints)) {
    for (const hint of archiveHints) {
      const id = (hint.id as string) || `arc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const normalizedHint = normalizeIncomingObject(hint, sourceEventIds, currentRound);
      const card: NarrativeArchiveCard = {
        ...normalizedHint,
        id,
        title: String(hint.title ?? ''),
        arcTitle: String(hint.arcTitle ?? hint.title ?? ''),
        summary: String(hint.summary ?? ''),
        timeSpan: String(hint.timeSpan ?? ''),
        keywords: Array.isArray(hint.keywords) ? hint.keywords.filter((value): value is string => typeof value === 'string') : [],
        entityRefs: Array.isArray(hint.entityRefs) ? hint.entityRefs.filter((value): value is string => typeof value === 'string') : [],
        sourceStartIndex: Number.isFinite(Number(hint.sourceStartIndex)) ? Number(hint.sourceStartIndex) : currentRound,
        sourceEndIndex: Number.isFinite(Number(hint.sourceEndIndex)) ? Number(hint.sourceEndIndex) : currentRound,
        sourceEventIds: [...new Set([...(Array.isArray(hint.sourceEventIds) ? hint.sourceEventIds : []), ...sourceEventIds])],
        createdAt: Number(hint.createdAt) || Date.now(),
        archivedAt: Date.now(),
      } as NarrativeArchiveCard;
      versionedUpsert(
        runtime.archiveCards,
        card as NarrativeArchiveCard & Record<string, unknown>,
        item => item.id === id || item.title === card.title,
        currentRound,
        { conflictAction: conflictDecisions?.get(hint) },
      );
    }
  }

  runtime.lastIngestSuccessAt = Date.now();
}

export function collectAllMemoriesFromRuntime(runtime: NarrativeMemoryRuntime) {
  return collectMemoryEntries(runtime);
}
