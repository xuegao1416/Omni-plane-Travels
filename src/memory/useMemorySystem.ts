// ============================================================
// 记忆系统 React Hook
// 完整管线：写入 → 摘要 → 查询改写 → 检索规划 → 多轮补充 → 精排 → 编译
// ============================================================

import { useCallback } from 'react';
import { useMemoryStore } from './memoryStore';
import type {
  MemorySystemConfig,
  NarrativeMemoryRuntime,
  SummaryMemoryItem,
  SummarySaveRecord,
  VectorFact,
  VectorMemoryItem,
} from './types';
import {
  parseNarrativePayload,
  parseNarrativeSummaryResult,
  parseNarrativeRetrievePlannerResult,
  parseNarrativeConflictJudgeResult,
  parseVectorQueryRewriteResult,
  parseRerankResult,
} from './narrativeParsers';
import { normalizeVectorFact } from './vectorUtils';
import { formatRuntimeToCompiledText, DEFAULT_COMPILE_BUDGET } from './compileFormatter';

// ─── 类型定义 ───

export interface MemoryEntry {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  type: 'player' | 'otherCharacter' | 'item';
  sourceFloor: number;
  savedAt: number;
}

export interface RetrieveResult {
  entries: MemoryEntry[];
  retrievalKeywords: string[];
  compiledContext: string;
  hitDetails: Array<{ title: string; hitRate: number; matchedKeywords: string[] }>;
}

/** 管线各阶段的输入输出 */
export interface MemoryPipelineContext {
  /** 当前楼层 */
  floor: number;
  /** 本层剧情文本 */
  batchText: string;
  /** 用户输入 */
  inputText: string;
  /** 最近上下文 */
  recentContext: string;
  /** 玩家名字 */
  playerName: string;
  /** API 配置（记忆系统默认） */
  apiConfig: { baseUrl: string; apiKey: string; model: string };
  /** 各阶段独立 API 配置（可选，未设置则回退到 apiConfig） */
  writeApiConfig?: { baseUrl: string; apiKey: string; model: string };
  summaryApiConfig?: { baseUrl: string; apiKey: string; model: string };
  conflictJudgeApiConfig?: { baseUrl: string; apiKey: string; model: string };
  retrievalApiConfig?: { baseUrl: string; apiKey: string; model: string };
  vectorApiConfig?: { baseUrl: string; apiKey: string; model: string };
  /** 管线间共享数据 */
  _queryRewriteResult?: ReturnType<typeof parseVectorQueryRewriteResult>;
  _plannerResult?: ReturnType<typeof parseNarrativeRetrievePlannerResult>;
  _rerankResult?: ReturnType<typeof parseRerankResult>;
  _selectedEntries?: MemoryEntry[];
  _compiledContext?: string;
  /** 查询改写阶段数据 */
  _retrievalKeywords?: string[];
  _semanticQuery?: string;
  /** 检索规划阶段数据 */
  _finalSelectedTitles?: string[];
  _candidateList?: string;
  _allMemories?: MemoryEntry[];
  /** 命中详情 */
  _hitDetails?: Array<{ title: string; hitRate: number; matchedKeywords: string[] }>;
  /** 降级阶段记录（标记哪些阶段执行失败后使用了降级策略） */
  _degradedStages?: string[];
}

export interface MemorySystemHook {
  config: MemorySystemConfig;
  setConfig: (patch: Partial<MemorySystemConfig>) => void;
  memoryRuntime: NarrativeMemoryRuntime | null;
  runtimeVersion: number;
  isLoading: boolean;

  initMemory: (bankId?: string) => void;
  resetMemory: () => void;

  // ─── 8 个管线阶段 ───
  /** 阶段1: 叙事记忆写入（热态对象提取 + 冲突裁决） */
  pipelineWrite: (ctx: MemoryPipelineContext) => Promise<void>;
  /** 阶段2: 摘要保存（3类记忆） */
  pipelineSummary: (ctx: MemoryPipelineContext) => Promise<MemoryEntry[]>;
  /** 阶段3: 查询改写 */
  pipelineQueryRewrite: (ctx: MemoryPipelineContext) => Promise<void>;
  /** 阶段4: 检索规划（AI规划） */
  pipelineRetrievePlan: (ctx: MemoryPipelineContext) => Promise<void>;
  /** 阶段5: 多轮补充 */
  pipelineMultiRound: (ctx: MemoryPipelineContext) => Promise<void>;
  /** 阶段6: 精排 */
  pipelineRerank: (ctx: MemoryPipelineContext) => Promise<void>;
  /** 阶段7: 检索收尾（本地匹配 + 去重） */
  pipelineRetrieveFinalize: (ctx: MemoryPipelineContext) => Promise<RetrieveResult>;
  /** 阶段8: 上下文编译（组装注入文本） */
  pipelineCompile: (ctx: MemoryPipelineContext) => Promise<string>;
  /** 阶段9: 向量事实提取（vectorExtract + vectorQueryRewrite + vectorRerank） */
  pipelineVector: (ctx: MemoryPipelineContext) => Promise<VectorFact[]>;

  toJSON: () => unknown;
  fromJSON: (data: unknown) => void;
}

// ─── 辅助函数 ───

function computeKeywordHitRate(memoryKeywords: string[], retrievalKeywords: string[]) {
  if (memoryKeywords.length === 0) return { hitRate: 0, matchedKeywords: [] as string[] };
  const normalizedMemory = memoryKeywords.map(k => (k ?? '').toLowerCase().trim());
  const normalizedRetrieval = retrievalKeywords.map(k => (k ?? '').toLowerCase().trim());
  const matched = normalizedMemory.filter(mk =>
    normalizedRetrieval.some(rk => rk.includes(mk) || mk.includes(rk))
  );
  return { hitRate: matched.length / memoryKeywords.length, matchedKeywords: matched };
}

function deduplicateByTitle(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = (e.title ?? '').toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortByFloorAsc(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => a.sourceFloor - b.sourceFloor);
}

function collectAllMemories(runtime: NarrativeMemoryRuntime): MemoryEntry[] {
  const memories: MemoryEntry[] = [];
  for (const record of runtime.summarySaveHistory) {
    if (!record.summaryData) continue;
    const floor = record.sourceStartIndex ?? 0;
    for (const item of record.summaryData.playerMemories ?? []) {
      memories.push({ id: item.id || `pm_${floor}_${memories.length}`, title: item.title, summary: item.summary, keywords: item.keywords ?? [], type: 'player', sourceFloor: floor, savedAt: item.savedAt ?? record.savedAt });
    }
    for (const item of record.summaryData.otherCharacterMemories ?? []) {
      memories.push({ id: item.id || `oc_${floor}_${memories.length}`, title: item.title, summary: item.summary, keywords: item.keywords ?? [], type: 'otherCharacter', sourceFloor: floor, savedAt: item.savedAt ?? record.savedAt });
    }
    for (const item of record.summaryData.itemMemories ?? []) {
      memories.push({ id: item.id || `im_${floor}_${memories.length}`, title: item.title, summary: item.summary, keywords: item.keywords ?? [], type: 'item', sourceFloor: floor, savedAt: item.savedAt ?? record.savedAt });
    }
  }
  return memories;
}

import { waitForRateLimit } from '../api/rateLimiter';

async function callAI(
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  systemPrompt: string,
  userContent: string,
  temperature = 0.3,
) {
  // 限流保护
  await waitForRateLimit();

  const { requestCompletion } = await import('../api/client');
  const result = await requestCompletion(
    { ...apiConfig, provider: 'openai' },
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    { responseFormat: 'json', temperature },
  );
  return result.text;
}

// ─── Hook 实现 ───

export function useMemorySystem(): MemorySystemHook {
  const store = useMemoryStore();

  const setConfig = useCallback((patch: Partial<MemorySystemConfig>) => {
    store.setConfig(patch);
  }, [store.setConfig]);

  const initMemory = useCallback((bankId = '') => {
    store.initMemoryRuntime(bankId);
  }, [store.initMemoryRuntime]);

  const resetMemory = useCallback(() => {
    store.resetMemoryRuntime();
  }, [store.resetMemoryRuntime]);

  // ═══════════════════════════════════════════
  // 阶段1: 叙事记忆写入（ingest + conflictJudge）
  // ═══════════════════════════════════════════

  const pipelineWrite = useCallback(async (ctx: MemoryPipelineContext) => {
    if (!store.config.enabled) return;

    const runtime = store.getMemoryRuntime();
    const templates = store.config.narrativePromptTemplates;

    try {
      store.setLoading(true, '正在写入叙事记忆...');

      // 1. 构建参考锚点
      const referenceBlock = buildIngestReferenceBlock(runtime, ctx.playerName);

      // 2. 调用 ingest 提示词
      const prompt = templates.ingest
        .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
        .replace(/\{\{叙事写入参考\}\}/g, referenceBlock)
        .replace(/\{\{剧情原文\}\}/g, ctx.batchText);

      const rawResult = await callAI(ctx.apiConfig, prompt, '请分析上述剧情并输出结构化叙事记忆 JSON。');
      const parsed = parseNarrativePayload(rawResult);

      // 3. 应用写入结果（如有冲突裁决则先裁决）
      if (store.config.writePipeline.conflictJudgeEnabled) {
        await applyIngestWithConflictJudge(runtime, parsed, ctx, templates);
      } else {
        applyIngestResult(runtime, parsed, ctx.playerName);
      }

      store.bumpRuntimeVersion();
      store.appendWriteDebugLog({
        kind: 'ingest',
        message: `写入完成`,
        sourceStartIndex: ctx.floor,
        sourceEndIndex: ctx.floor,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '写入失败';
      store.appendWriteDebugLog({ kind: 'ingest', message, mode: 'error' });
      console.warn('[记忆系统] 叙事写入失败:', message);
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段2: 摘要保存（summary prompt → 3类记忆）
  // ═══════════════════════════════════════════

  const pipelineSummary = useCallback(async (ctx: MemoryPipelineContext): Promise<MemoryEntry[]> => {
    if (!store.config.enabled || !store.config.writePipeline.saveSummaryAfterIngest) return [];

    const templates = store.config.narrativePromptTemplates;

    try {
      store.setLoading(true, '正在保存剧情摘要...');

      const prompt = templates.summary
        .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
        .replace(/\{\{batchText\}\}/g, ctx.batchText);

      const rawResult = await callAI(ctx.apiConfig, prompt, '请为当前剧情批次产出结构化摘要 JSON。');
      const parsed = parseNarrativeSummaryResult(rawResult);
      const savedAt = Date.now();

      const entries: MemoryEntry[] = [];

      for (const item of parsed.playerMemories) {
        entries.push({ id: item.id || `pm_${ctx.floor}_${entries.length}`, title: item.title, summary: item.summary, keywords: item.keywords, type: 'player', sourceFloor: ctx.floor, savedAt });
      }
      for (const item of parsed.otherCharacterMemories) {
        entries.push({ id: item.id || `oc_${ctx.floor}_${entries.length}`, title: item.title, summary: item.summary, keywords: item.keywords, type: 'otherCharacter', sourceFloor: ctx.floor, savedAt });
      }
      for (const item of parsed.itemMemories) {
        entries.push({ id: item.id || `im_${ctx.floor}_${entries.length}`, title: item.title, summary: item.summary, keywords: item.keywords, type: 'item', sourceFloor: ctx.floor, savedAt });
      }

      store.appendSummarySaveRecord({
        savedAt,
        status: 'success',
        sourceStartIndex: ctx.floor,
        sourceEndIndex: ctx.floor,
        applyResult: {
          otherCharacterCount: parsed.otherCharacterMemories.length,
          playerCount: parsed.playerMemories.length,
          itemCount: parsed.itemMemories.length,
        },
        summaryData: {
          otherCharacterMemories: parsed.otherCharacterMemories,
          playerMemories: parsed.playerMemories,
          itemMemories: parsed.itemMemories,
        },
      });

      store.bumpRuntimeVersion();
      return entries;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '摘要保存失败';
      store.appendWriteDebugLog({ kind: 'summary', message, mode: 'error' });
      console.warn('[记忆系统] 摘要保存失败:', message);
      return [];
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段3: 查询改写
  // ═══════════════════════════════════════════

  const pipelineQueryRewrite = useCallback(async (ctx: MemoryPipelineContext): Promise<void> => {
    if (!store.config.enabled) return;

    const templates = store.config.narrativePromptTemplates;
    const retrievalConfig = store.config.retrieval;

    if (!retrievalConfig.useQueryRewrite) return;

    try {
      store.setLoading(true, '正在查询改写...');

      const qrPrompt = templates.queryRewrite
        .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
        .replace(/\{\{inputText\}\}/g, ctx.inputText)
        .replace(/\{\{recentContext\}\}/g, ctx.recentContext.slice(-800))
        .replace(/\{\{entityTerms\}\}/g, '')
        .replace(/\{\{timeTerms\}\}/g, '');

      const qrRaw = await callAI(ctx.apiConfig, qrPrompt, '请分析当前输入并输出查询改写 JSON。');
      const qrResult = parseVectorQueryRewriteResult(qrRaw);
      ctx._queryRewriteResult = qrResult;
      ctx._retrievalKeywords = qrResult.retrievalKeywords;
      ctx._semanticQuery = qrResult.semanticQuery || ctx.inputText;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '查询改写失败';
      console.warn('[记忆系统] 查询改写失败:', message);
      // 失败时使用原始输入
      ctx._retrievalKeywords = [];
      ctx._semanticQuery = ctx.inputText;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段4: 检索规划
  // ═══════════════════════════════════════════

  const pipelineRetrievePlan = useCallback(async (ctx: MemoryPipelineContext): Promise<void> => {
    if (!store.config.enabled) return;

    const runtime = store.getMemoryRuntime();
    const allMemories = collectAllMemories(runtime);
    const templates = store.config.narrativePromptTemplates;
    const retrievalConfig = store.config.retrieval;

    if (allMemories.length === 0) return;

    try {
      store.setLoading(true, '正在检索规划...');

      const semanticQuery = ctx._semanticQuery || ctx.inputText;

      const candidateList = allMemories
        .slice(0, retrievalConfig.plannerCandidateLimit)
        .map((m, i) => `[${i}] ${m.title}（关键词：${m.keywords.join('、')}）`)
        .join('\n');

      const plannerPrompt = templates.retrievePlanner
        .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
        .replace(/\{\{inputText\}\}/g, ctx.inputText)
        .replace(/\{\{recentContext\}\}/g, ctx.recentContext.slice(-600))
        .replace(/\{\{compiledNarrativeContext\}\}/g, '无')
        .replace(/\{\{compiledNarrativeSections\}\}/g, '无')
        .replace(/\{\{semanticAnalysis\}\}/g, semanticQuery)
        .replace(/\{\{summaryHistory\}\}/g, `共 ${runtime.summarySaveHistory.length} 条摘要`)
        .replace(/\{\{memoryCandidates\}\}/g, candidateList || '无候选');

      const plannerRaw = await callAI(ctx.apiConfig, plannerPrompt, '请规划需要注入的记忆，输出 JSON。');
      const plannerResult = parseNarrativeRetrievePlannerResult(plannerRaw);
      ctx._plannerResult = plannerResult;
      ctx._finalSelectedTitles = [...plannerResult.items.map(i => i.title)];
      ctx._candidateList = candidateList;
      ctx._allMemories = allMemories;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '检索规划失败';
      store.appendRetrieveDebugLog({ kind: 'retrieve', message, mode: 'error' });
      console.warn('[记忆系统] 检索规划失败:', message);
      ctx._plannerResult = undefined;
      ctx._finalSelectedTitles = [];
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段5: 多轮补充
  // ═══════════════════════════════════════════

  const pipelineMultiRound = useCallback(async (ctx: MemoryPipelineContext): Promise<void> => {
    if (!store.config.enabled) return;

    const runtime = store.getMemoryRuntime();
    const templates = store.config.narrativePromptTemplates;
    const retrievalConfig = store.config.retrieval;

    if (!retrievalConfig.multiRoundEnabled || !ctx._plannerResult) return;

    try {
      store.setLoading(true, '正在多轮补充...');

      const semanticQuery = ctx._semanticQuery || ctx.inputText;
      const candidateList = ctx._candidateList || '';
      const maxRounds = retrievalConfig.multiRoundMaxRounds;
      let previousResults = ctx._plannerResult.items.map(item => `${item.title}: ${item.reason || ''}`).join('\n');

      for (let round = 2; round <= maxRounds; round++) {
        try {
          const isLast = round === maxRounds;
          const multiPrompt = isLast
            ? templates.multiRoundRetrievePlannerFinal
            : templates.multiRoundRetrievePlanner;

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

          const multiRaw = await callAI(ctx.apiConfig, multiFilled, '请补充遗漏的记忆，输出 JSON。');
          const multiResult = parseNarrativeRetrievePlannerResult(multiRaw);

          const multiTitles = multiResult.items.map(i => i.title);
          if (multiTitles.length === 0) break; // 没有新内容，提前退出

          if (!ctx._finalSelectedTitles) ctx._finalSelectedTitles = [];
          ctx._finalSelectedTitles.push(...multiTitles);
          previousResults += '\n' + multiResult.items.map(item => `${item.title}: ${item.reason || ''}`).join('\n');
        } catch {
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '多轮补充失败';
      console.warn('[记忆系统] 多轮补充失败:', message);
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段6: 精排
  // ═══════════════════════════════════════════

  const pipelineRerank = useCallback(async (ctx: MemoryPipelineContext): Promise<void> => {
    if (!store.config.enabled) return;

    const templates = store.config.narrativePromptTemplates;
    const retrievalConfig = store.config.retrieval;
    const allMemories = ctx._allMemories || collectAllMemories(store.getMemoryRuntime());
    const finalSelectedTitles = ctx._finalSelectedTitles || [];

    if (!retrievalConfig.useRerank || allMemories.length === 0) return;

    try {
      store.setLoading(true, '正在精排...');

      const retrievalKeywords = ctx._retrievalKeywords || [];
      const plannerKeywords = ctx._plannerResult?.retrievalKeywords || [];
      const allKeywords = [...new Set([...retrievalKeywords, ...plannerKeywords])];

      // 标题匹配
      const titleSelected = allMemories.filter(m =>
        finalSelectedTitles.some(title => title === m.title || (m.title ?? '').includes(title) || title.includes(m.title ?? ''))
      );

      // 关键词命中率补充
      const threshold = retrievalConfig.keywordRecallThreshold / 100;
      const keywordSelected = allMemories.filter(m => {
        if (titleSelected.some(t => t.id === m.id)) return false;
        const { hitRate } = computeKeywordHitRate(m.keywords, allKeywords);
        return hitRate >= threshold;
      });

      // 去重 + 排序
      const combined = [...titleSelected, ...keywordSelected];
      const deduped = deduplicateByTitle(combined);
      const sorted = sortByFloorAsc(deduped);

      // 精排
      const rerankPrompt = templates.rerank
        .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
        .replace(/\{\{query\}\}/g, ctx.inputText)
        .replace(/\{\{candidates\}\}/g,
          sorted.map((m, i) => `[${i}] ${m.title}: ${m.summary}`).join('\n'));

      const rerankRaw = await callAI(ctx.apiConfig, rerankPrompt, '请对候选记忆精排打分，输出 JSON。');
      const rerankResult = parseRerankResult(rerankRaw);
      ctx._rerankResult = rerankResult;

      // 按精排分数重新排序
      const scoreMap = new Map(rerankResult.rankings.map(r => [r.index, r.score]));
      const finalEntries = [...sorted]
        .map((entry, index) => ({ entry, score: scoreMap.get(index) ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .map(({ entry }) => entry);

      ctx._selectedEntries = finalEntries;

      // 命中详情
      const hitDetails = finalEntries.map(m => {
        const { hitRate, matchedKeywords } = computeKeywordHitRate(m.keywords, allKeywords);
        return { title: m.title, hitRate, matchedKeywords };
      });
      ctx._hitDetails = hitDetails;

      // 缓存检索规划
      store.setRetrievePlan({
        plannedAt: Date.now(),
        candidates: allMemories.map(m => ({ title: m.title })),
        selectedTitles: finalEntries.map(m => m.title),
        selectedModes: finalEntries.map(() => 'keyword_hit'),
        strategy: `查询改写 + AI规划 ${ctx._plannerResult?.items.length ?? 0} 条 + 关键词补充 ${keywordSelected.length} 条 + 精排 → ${finalEntries.length} 条`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '精排失败';
      console.warn('[记忆系统] 精排失败:', message);
      // 精排失败，使用原始排序
      ctx._selectedEntries = allMemories.filter(m =>
        finalSelectedTitles.some(title => title === m.title || (m.title ?? '').includes(title) || title.includes(m.title ?? ''))
      );
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段7: 检索收尾（本地匹配 + 去重）
  // ═══════════════════════════════════════════

  const pipelineRetrieveFinalize = useCallback(async (ctx: MemoryPipelineContext): Promise<RetrieveResult> => {
    const emptyResult: RetrieveResult = { entries: [], retrievalKeywords: [], compiledContext: '', hitDetails: [] };
    if (!store.config.enabled) return emptyResult;

    const runtime = store.getMemoryRuntime();
    const allMemories = collectAllMemories(runtime);
    const retrievalConfig = store.config.retrieval;

    if (allMemories.length === 0) return emptyResult;

    try {
      const finalSelectedTitles = ctx._finalSelectedTitles || [];
      const retrievalKeywords = ctx._retrievalKeywords || [];
      const plannerKeywords = ctx._plannerResult?.retrievalKeywords || [];
      const allKeywords = [...new Set([...retrievalKeywords, ...plannerKeywords])];

      // 标题匹配
      const titleSelected = allMemories.filter(m =>
        finalSelectedTitles.some(title => title === m.title || (m.title ?? '').includes(title) || title.includes(m.title ?? ''))
      );

      // 关键词命中率补充
      const threshold = retrievalConfig.keywordRecallThreshold / 100;
      const keywordSelected = allMemories.filter(m => {
        if (titleSelected.some(t => t.id === m.id)) return false;
        const { hitRate } = computeKeywordHitRate(m.keywords, allKeywords);
        return hitRate >= threshold;
      });

      // 去重 + 排序
      const combined = [...titleSelected, ...keywordSelected];
      const deduped = deduplicateByTitle(combined);
      const sorted = sortByFloorAsc(deduped);

      // 命中详情
      const hitDetails = sorted.map(m => {
        const { hitRate, matchedKeywords } = computeKeywordHitRate(m.keywords, allKeywords);
        return { title: m.title, hitRate, matchedKeywords };
      });

      ctx._selectedEntries = sorted;
      ctx._hitDetails = hitDetails;

      // 缓存检索规划
      store.setRetrievePlan({
        plannedAt: Date.now(),
        candidates: allMemories.map(m => ({ title: m.title })),
        selectedTitles: sorted.map(m => m.title),
        selectedModes: sorted.map(() => 'keyword_hit'),
        strategy: `查询改写 + AI规划 ${ctx._plannerResult?.items.length ?? 0} 条 + 关键词补充 ${keywordSelected.length} 条 → ${sorted.length} 条`,
      });

      return { entries: sorted, retrievalKeywords: allKeywords, compiledContext: '', hitDetails };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '检索失败';
      store.appendRetrieveDebugLog({ kind: 'retrieve', message, mode: 'error' });
      console.warn('[记忆系统] 检索失败:', message);
      return emptyResult;
    }
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段4: 上下文编译（组装注入文本）
  // ═══════════════════════════════════════════

  const pipelineCompile = useCallback(async (ctx: MemoryPipelineContext): Promise<string> => {
    if (!store.config.enabled) return '';

    const runtime = store.getMemoryRuntime();

    const queryKeywords = ctx._retrievalKeywords?.length
      ? ctx._retrievalKeywords
      : ctx.inputText.split(/[\s,，。！？、；：""''（）【】\n]+/).filter(w => w.length >= 2);

    const result = formatRuntimeToCompiledText(runtime, queryKeywords, DEFAULT_COMPILE_BUDGET);
    ctx._compiledContext = result.text;

    store.setCompiledContext({
      compiledAt: Date.now(),
      fullText: result.text,
      sections: result.sections,
      sceneAnchor: runtime.sceneAnchor,
    });

    store.bumpRuntimeVersion();
    return result.text;
  }, [store]);

  // ═══════════════════════════════════════════
  // 阶段5: 向量事实提取（vectorExtract → vectorQueryRewrite → vectorRerank）
  // ═══════════════════════════════════════════

  const pipelineVector = useCallback(async (ctx: MemoryPipelineContext): Promise<VectorFact[]> => {
    if (!store.config.enabled || !store.config.vectorEnabled) return [];

    const templates = store.config.narrativePromptTemplates;

    try {
      store.setLoading(true, '正在提取向量事实...');

      // ── 步骤1: 提取向量事实（vectorExtract）──
      const extractPrompt = templates.vectorExtract
        .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
        .replace(/\{\{剧情原文\}\}/g, ctx.batchText);

      const extractRaw = await callAI(ctx.apiConfig, extractPrompt, '请提取长期事实，输出 JSON 数组。');
      const extractParsed = parseNarrativePayload(extractRaw);

      const factsArray = Array.isArray(extractParsed) ? extractParsed
        : Array.isArray(extractParsed.facts) ? extractParsed.facts
        : Array.isArray(extractParsed.data) ? extractParsed.data
        : [];

      const normalized = factsArray
        .map((item: unknown, index: number) => {
          const fact = normalizeVectorFact(item);
          if (!fact) return null;
          return {
            ...fact,
            sourceStartIndex: ctx.floor,
            sourceEndIndex: ctx.floor,
            createdAt: Date.now(),
          } as VectorFact;
        })
        .filter((item): item is VectorFact => item != null);

      // 存入向量记忆
      const vectorItems: VectorMemoryItem[] = normalized.map((fact, i) => ({
        ...fact,
        id: `vec_${ctx.floor}_${i}`,
        searchText: [fact.fact, ...fact.keywords, ...fact.entities].join(' '),
      }));

      store.appendVectorMemories(vectorItems);

      // ── 步骤2: 向量查询改写（vectorQueryRewrite，供后续检索用）──
      if (store.config.semanticRetrieveEnabled) {
        try {
          const vqrPrompt = templates.vectorQueryRewrite
            .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
            .replace(/\{\{inputText\}\}/g, ctx.inputText)
            .replace(/\{\{recentContext\}\}/g, ctx.recentContext.slice(-600))
            .replace(/\{\{hotContextSummary\}\}/g, '')
            .replace(/\{\{entityTerms\}\}/g, '')
            .replace(/\{\{timeTerms\}\}/g, '');

          const vqrRaw = await callAI(ctx.apiConfig, vqrPrompt, '请分析语义查询，输出 JSON。');
          const vqrResult = parseVectorQueryRewriteResult(vqrRaw);

          // 存入上下文供后续使用
          ctx._queryRewriteResult = vqrResult;
        } catch {
          // 向量查询改写失败不影响主流程
        }
      }

      // ── 步骤3: 向量精排（vectorRerank，供后续检索用）──
      if (store.config.retrieval.useRerank && normalized.length > 2) {
        try {
          const vrPrompt = templates.vectorRerank
            .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
            .replace(/\{\{query\}\}/g, ctx.inputText)
            .replace(/\{\{candidates\}\}/g,
              normalized.map((f, i) => `[${i}] ${f.fact}`).join('\n'));

          const vrRaw = await callAI(ctx.apiConfig, vrPrompt, '请对向量事实精排，输出 JSON 数组。');
          const vrResult = parseRerankResult(vrRaw);

          // 按精排分数重排向量记忆
          const scoreMap = new Map(vrResult.rankings.map(r => [r.index, r.score]));
          const reranked = vectorItems
            .map((item, index) => ({ item, score: scoreMap.get(index) ?? 0 }))
            .sort((a, b) => b.score - a.score)
            .map(({ item }) => item);

          store.setVectorMemory(reranked);
        } catch {
          // 向量精排失败用原始顺序
        }
      }

      store.bumpRuntimeVersion();
      store.appendWriteDebugLog({
        kind: 'vector_extract',
        message: `提取 ${normalized.length} 条向量事实`,
        sourceStartIndex: ctx.floor,
        sourceEndIndex: ctx.floor,
      });

      return normalized;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '向量提取失败';
      store.appendWriteDebugLog({ kind: 'vector_extract', message, mode: 'error' });
      console.warn('[记忆系统] 向量提取失败:', message);
      return [];
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // ─── 序列化 ───
  const toJSON = useCallback(() => store.toJSON(), [store]);
  const fromJSON = useCallback((data: unknown) => {
    if (data && typeof data === 'object') {
      store.fromJSON(data as { memoryRuntime?: unknown; vectorMemory?: unknown[]; config?: unknown });
    }
  }, [store]);

  return {
    config: store.config,
    setConfig,
    memoryRuntime: store.memoryRuntime,
    runtimeVersion: store.runtimeVersion,
    isLoading: store.isLoading,
    initMemory,
    resetMemory,
    pipelineWrite,
    pipelineSummary,
    pipelineQueryRewrite,
    pipelineRetrievePlan,
    pipelineMultiRound,
    pipelineRerank,
    pipelineRetrieveFinalize,
    pipelineCompile,
    pipelineVector,
    toJSON,
    fromJSON,
  };
}

// ─── 内部辅助 ───

function buildIngestReferenceBlock(runtime: NarrativeMemoryRuntime, playerName: string): string {
  const parts: string[] = [];
  if (runtime.sceneAnchor) {
    const sa = runtime.sceneAnchor;
    parts.push(`场景：${sa.locationLabel || '未知'} | ${sa.timeLabel || '未知'} | 目标：${sa.immediateGoal || '无'} | 风险：${sa.immediateRisk || '无'}`);
  }
  const activeThreads = runtime.activeThreads.filter(t => t.status === 'open' || t.status === 'blocked');
  if (activeThreads.length > 0) {
    parts.push(`活跃线程：${activeThreads.map(t => `${t.title}(${t.status})`).join('、')}`);
  }
  const activeSlots = runtime.stateSlots.filter(s => s.status === 'active');
  if (activeSlots.length > 0) {
    parts.push(`状态槽：${activeSlots.map(s => `${s.slotType}(${s.scopeId})`).join('、')}`);
  }
  if (runtime.relationNetwork.length > 0) {
    const topRels = runtime.relationNetwork.slice(0, 5);
    parts.push(`关系网：${topRels.map(r => `${r.sourceEntityId}→${r.targetEntityId}(${r.relationType})`).join('、')}`);
  }
  return parts.length > 0 ? parts.join('\n') : '暂无已知参考锚点';
}

function applyIngestResult(runtime: NarrativeMemoryRuntime, parsed: Record<string, unknown>, _playerName: string): void {
  // 应用场景补丁
  const scenePatch = parsed.scenePatch as Record<string, string> | undefined;
  if (scenePatch && typeof scenePatch === 'object') {
    const existing = runtime.sceneAnchor;
    runtime.sceneAnchor = {
      timeLabel: scenePatch.timeLabel ?? existing?.timeLabel ?? '',
      locationLabel: scenePatch.locationLabel ?? existing?.locationLabel ?? '',
      presentEntities: (Array.isArray(scenePatch.presentEntities) ? scenePatch.presentEntities as string[] : Array.isArray(existing?.presentEntities) ? existing.presentEntities : []) ?? [],
      immediateGoal: scenePatch.immediateGoal ?? existing?.immediateGoal ?? '',
      immediateRisk: scenePatch.immediateRisk ?? existing?.immediateRisk ?? '',
      conversationFocus: scenePatch.conversationFocus ?? existing?.conversationFocus ?? '',
      recentChange: scenePatch.recentChange ?? existing?.recentChange ?? '',
      confidence: Number(scenePatch.confidence) || existing?.confidence || 0.5,
      updatedAt: Date.now(),
    };
  }

  // 应用线程更新
  const threadUpserts = parsed.threadUpserts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(threadUpserts)) {
    for (const thread of threadUpserts) {
      // 防御：数组字段归一化
      for (const f of ['relatedEntities', 'relatedItems', 'relatedLocations']) {
        if (thread[f] && !Array.isArray(thread[f])) thread[f] = [thread[f]];
      }
      const idx = runtime.activeThreads.findIndex(t => t.id === thread.id);
      const normalized = { ...thread, updatedAt: Date.now() } as NarrativeMemoryRuntime['activeThreads'][number];
      if (idx >= 0) runtime.activeThreads[idx] = { ...runtime.activeThreads[idx], ...normalized };
      else runtime.activeThreads.push(normalized);
    }
  }

  // 应用事件卡
  const eventCandidates = parsed.eventCandidates as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(eventCandidates)) {
    for (const card of eventCandidates) {
      for (const f of ['entityRefs', 'locationRefs', 'threadRefs', 'timeLabels', 'keywords']) {
        if (card[f] && !Array.isArray(card[f])) card[f] = [card[f]];
      }
      const idx = runtime.eventCards.findIndex(c => c.id === card.id);
      const normalized = { ...card, createdAt: Date.now(), updatedAt: Date.now() } as NarrativeMemoryRuntime['eventCards'][number];
      if (idx >= 0) runtime.eventCards[idx] = { ...runtime.eventCards[idx], ...normalized };
      else runtime.eventCards.push(normalized);
    }
  }

  // 应用实体档案
  const entityPatches = parsed.entityPatches as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(entityPatches)) {
    const ensureArr = (v: unknown): string[] => Array.isArray(v) ? v as string[] : (v ? [String(v)] : []);
    for (const patch of entityPatches) {
      // 防御：数组字段归一化
      for (const f of ['currentStatus', 'aliases', 'stableFacts', 'affiliations', 'relatedThreads', 'relatedEvents']) {
        if (patch[f] && !Array.isArray(patch[f])) patch[f] = [patch[f]];
      }
      const idx = runtime.entityCards.findIndex(c => c.id === patch.id || c.name === patch.name);
      if (idx >= 0) {
        const existing = runtime.entityCards[idx];
        runtime.entityCards[idx] = {
          ...existing, ...patch,
          stableFacts: [...new Set([...ensureArr(existing.stableFacts), ...ensureArr(patch.stableFacts)])].slice(-10),
          updatedAt: Date.now(),
        };
      } else {
        runtime.entityCards.push({ ...patch, createdAt: Date.now(), updatedAt: Date.now() } as NarrativeMemoryRuntime['entityCards'][number]);
      }
    }
  }

  runtime.lastIngestCursor = Number(parsed.sourceEndIndex) || runtime.lastIngestCursor;
  runtime.lastIngestSuccessAt = Date.now();
}

async function applyIngestWithConflictJudge(
  runtime: NarrativeMemoryRuntime,
  parsed: Record<string, unknown>,
  ctx: MemoryPipelineContext,
  templates: MemorySystemConfig['narrativePromptTemplates'],
): Promise<void> {
  // 冲突裁决：对每个新对象检查是否与旧对象冲突
  const eventCandidates = parsed.eventCandidates as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(eventCandidates)) {
    for (const newCard of eventCandidates) {
      const existing = runtime.eventCards.find(c => c.title === newCard.title || c.id === newCard.id);
      if (existing) {
        try {
          const judgePrompt = templates.conflictJudge
            .replace(/\{\{玩家名字\}\}/g, ctx.playerName)
            .replace(/\{\{currentObject\}\}/g, JSON.stringify(existing))
            .replace(/\{\{incomingObject\}\}/g, JSON.stringify(newCard));

          const judgeRaw = await callAI(ctx.apiConfig, judgePrompt, '请裁决冲突，输出 JSON。');
          const judgeResult = parseNarrativeConflictJudgeResult(judgeRaw);

          if (judgeResult.action === 'reject_incoming') continue;
          if (judgeResult.action === 'mark_expired') {
            (existing as unknown as Record<string, unknown>).status = 'cold';
            continue;
          }
        } catch {
          // 裁决失败，按默认行为处理
        }
      }
    }
  }

  // 应用写入结果
  applyIngestResult(runtime, parsed, ctx.playerName);
}
