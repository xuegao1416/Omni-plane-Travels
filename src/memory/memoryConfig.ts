// ============================================================
// 记忆系统配置 - 默认值与归一化
// ============================================================

import type {
  MemorySystemConfig,
  MemoryProtocolConfig,
  MemoryWritePipelineConfig,
  MemoryRetrievalConfig,
  MemoryCompilerConfig,
  MemoryRetentionConfig,
  MemoryDebugConfig,
  NarrativePromptTemplates,
} from './types';
import { createDefaultNarrativePromptTemplates, normalizeNarrativePromptTemplates } from './memoryPrompts';

// ─── 默认配置 ───

function createDefaultProtocolConfig(): MemoryProtocolConfig {
  return {
    recentTurnPairs: 3,
    minRecentTurnPairs: 2,
    maxRecentTurnPairs: 5,
    compiledContextTokenBudget: -1,
    injectAsSystemBlock: true,
    titleReplacementStrategy: 'title_to_summary',
    retrievalSummaryBudget: -1,
    retrievalExcerptBudget: -1,
  };
}

function createDefaultWritePipelineConfig(): MemoryWritePipelineConfig {
  return {
    trigger: 'post_assistant_turn',
    minBatchTurns: 1,
    maxBatchTurns: -1,
    minWriteScore: 0.68,
    dedupeWindow: 24,
    variableOverlapPolicy: 'prefer_variable_system',
    apiPresetId: null,
    summaryApiPresetId: null,
    conflictJudgeApiPresetId: null,
    saveSummaryAfterIngest: true,
    conflictJudgeEnabled: false,
    retryCount: 2,
    retryDelayMs: 1200,
  };
}

function createDefaultRetrievalConfig(): MemoryRetrievalConfig {
  return {
    useEmbedding: true,
    useRerank: true,
    useQueryRewrite: true,
    useGraphExpand: true,
    vectorFallbackEnabled: false,
    eventCandidateCount: 32,
    eventTopK: 8,
    entityTopK: 6,
    archiveTopK: 4,
    queryRewriteApiPresetId: null,
    rerankApiPresetId: null,
    rerankLlmApiPresetId: null,
    plannerApiPresetId: null,
    plannerEnabled: true,
    plannerReturnsTitlesOnly: true,
    plannerAutoReplaceEnabled: true,
    plannerCandidateLimit: 200,
    plannerTitleOnlyLimit: -1,
    multiRoundEnabled: false,
    multiRoundMaxRounds: 3,
    keywordRecallThreshold: 50,
  };
}

function createDefaultCompilerConfig(): MemoryCompilerConfig {
  return {
    sceneBudget: 120,
    threadBudget: 220,
    stateBudget: 220,
    relationBudget: 120,
    eventBudget: 320,
    entityBudget: 180,
    archiveBudget: 120,
    dedupeEnabled: true,
    hotThreadLimit: 4,
    hotStateLimit: 5,
    hotRelationLimit: 3,
    hotEventLimit: 3,
    hotEntityLimit: 4,
    threadCandidateLimit: 10,
    stateCandidateLimit: 14,
    relationCandidateLimit: 10,
    eventCandidateLimit: 16,
    entityCandidateLimit: 10,
    archiveCandidateLimit: 6,
    rerankCandidateTotalLimit: 24,
    rerankSelectedTotalLimit: 16,
    rerankSelectedThreadLimit: 4,
    rerankSelectedStateLimit: 4,
    rerankSelectedRelationLimit: 3,
    rerankSelectedEventLimit: 8,
    rerankSelectedEntityLimit: 6,
    rerankSelectedArchiveLimit: 4,
  };
}

function createDefaultRetentionConfig(): MemoryRetentionConfig {
  return {
    archiveResolvedThreadsAfter: 6,
    archiveColdEventsAfter: 20,
    agingMultiplier: 2,
    maxHotEventCards: 50,
    checkpointInterval: 12,
    maxVectorMemories: 500,
  };
}

function createDefaultDebugConfig(): MemoryDebugConfig {
  return {
    enabled: true,
    maxLogs: 200,
  };
}

export function createDefaultMemorySystemConfig(): MemorySystemConfig {
  return {
    enabled: true,
    mode: 'compiled_context_v1',
    bankScope: 'per_save',
    memoryMode: 'full',
    protocol: createDefaultProtocolConfig(),
    writePipeline: createDefaultWritePipelineConfig(),
    retrieval: createDefaultRetrievalConfig(),
    compiler: createDefaultCompilerConfig(),
    retention: createDefaultRetentionConfig(),
    narrativePromptTemplates: createDefaultNarrativePromptTemplates(),
    debug: createDefaultDebugConfig(),

    apiPresetId: null,
    summaryApiPresetId: null,
    retrievalApiPresetId: null,
    vectorEnabled: false,
    vectorExtractInterval: 3,
    vectorRetrieveMode: 'bi_encoder',
    vectorRetrieveCandidateCount: 24,
    vectorRetrieveTopK: 6,
    vectorScoreThreshold: 0.3,
    vectorQueryContextWindow: 6,
    vectorRetrieveUseContextQuery: true,
    vectorRetrieveUseEntityQuery: true,
    vectorRetrieveDuplicateWindow: 6,
    vectorRetrieveMinImportance: 1,
    vectorRetrieveMaxPerType: 1,
    semanticRetrieveEnabled: false,
    vectorRetrieveEnhanceEnabled: false,
    vectorRetrieveEnhanceApiPresetId: null,
    vectorExtractApiPresetId: null,
    vectorApiUrl: '',
    vectorApiKey: '',
    vectorApiModel: 'text-embedding-3-small',
    vectorRerankApiUrl: '',
    vectorRerankApiKey: '',
    vectorRerankModel: '',
    vectorRerankUseLlmFallback: true,
    vectorRerankLlmApiPresetId: null,
  };
}

// ─── 配置归一化 ───

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMemorySystemConfig(rawConfig: unknown): MemorySystemConfig {
  const defaults = createDefaultMemorySystemConfig();
  const safe = isPlainObject(rawConfig) ? rawConfig : {};
  const safeRetrieval = isPlainObject(safe.retrieval) ? safe.retrieval as Record<string, unknown> : {};
  const safeMigrations = isPlainObject(safe._migrations) ? safe._migrations as Record<string, boolean> : {};

  const normalizedMemoryMode = String(safe.memoryMode ?? defaults.memoryMode).trim().toLowerCase() === 'simple'
    ? 'simple' as const
    : 'full' as const;

  const hasPlannerCandidateLimit = 'plannerCandidateLimit' in safeRetrieval;
  const rawPlannerLimit = Number(safeRetrieval.plannerCandidateLimit);
  const shouldMigrate = safeMigrations.plannerCandidateLimitDefault200 !== true && (
    !hasPlannerCandidateLimit ||
    (Number.isFinite(rawPlannerLimit) && Math.floor(rawPlannerLimit) === 100)
  );
  const migratedPlannerLimit = shouldMigrate
    ? defaults.retrieval.plannerCandidateLimit
    : (Number.isFinite(rawPlannerLimit) && rawPlannerLimit > 0)
      ? Math.floor(rawPlannerLimit)
      : defaults.retrieval.plannerCandidateLimit;

  const shouldResetTemplates = safeMigrations.forceDefaultNarrativePromptTemplates !== true;

  const normalized: MemorySystemConfig = {
    ...defaults,
    ...safe,
    memoryMode: normalizedMemoryMode,
    protocol: { ...defaults.protocol, ...(isPlainObject(safe.protocol) ? safe.protocol : {}) },
    writePipeline: { ...defaults.writePipeline, ...(isPlainObject(safe.writePipeline) ? safe.writePipeline : {}) },
    retrieval: {
      ...defaults.retrieval,
      ...safeRetrieval,
      vectorFallbackEnabled: (safeRetrieval.vectorFallbackEnabled ?? safe.vectorEnabled ?? defaults.retrieval.vectorFallbackEnabled) as boolean,
      plannerCandidateLimit: migratedPlannerLimit,
    },
    compiler: { ...defaults.compiler, ...(isPlainObject(safe.compiler) ? safe.compiler : {}) },
    retention: { ...defaults.retention, ...(isPlainObject(safe.retention) ? safe.retention : {}) },
    debug: { ...defaults.debug, ...(isPlainObject(safe.debug) ? safe.debug : {}) },
    _migrations: {
      ...safeMigrations,
      plannerCandidateLimitDefault200: true,
      forceDefaultNarrativePromptTemplates: true,
    },
    narrativePromptTemplates: shouldResetTemplates
      ? createDefaultNarrativePromptTemplates()
      : normalizeNarrativePromptTemplates(safe.narrativePromptTemplates),
  };

  // 顶层 apiPresetId 兜底
  if (!normalized.apiPresetId && normalized.writePipeline.apiPresetId) {
    normalized.apiPresetId = normalized.writePipeline.apiPresetId;
  }
  if (!normalized.writePipeline.summaryApiPresetId && normalized.summaryApiPresetId) {
    normalized.writePipeline.summaryApiPresetId = normalized.summaryApiPresetId;
  }
  if (!normalized.retrieval.plannerApiPresetId && normalized.retrievalApiPresetId) {
    normalized.retrieval.plannerApiPresetId = normalized.retrievalApiPresetId;
  }

  return normalized;
}

export function mergeMemorySystemConfig(
  base: Partial<MemorySystemConfig>,
  override: Partial<MemorySystemConfig>,
): MemorySystemConfig {
  const normalizedBase = normalizeMemorySystemConfig(base);
  const safe = isPlainObject(override) ? override : {};

  // 浅合并
  const merged = { ...normalizedBase, ...safe };

  // 子对象深合并
  if (isPlainObject(safe.protocol)) {
    merged.protocol = { ...normalizedBase.protocol, ...safe.protocol };
  }
  if (isPlainObject(safe.writePipeline)) {
    merged.writePipeline = { ...normalizedBase.writePipeline, ...safe.writePipeline };
  }
  if (isPlainObject(safe.retrieval)) {
    merged.retrieval = { ...normalizedBase.retrieval, ...safe.retrieval };
  }
  if (isPlainObject(safe.compiler)) {
    merged.compiler = { ...normalizedBase.compiler, ...safe.compiler };
  }
  if (isPlainObject(safe.retention)) {
    merged.retention = { ...normalizedBase.retention, ...safe.retention };
  }
  if (isPlainObject(safe.debug)) {
    merged.debug = { ...normalizedBase.debug, ...safe.debug };
  }
  if (isPlainObject(safe.narrativePromptTemplates)) {
    merged.narrativePromptTemplates = normalizeNarrativePromptTemplates(safe.narrativePromptTemplates);
  }

  return normalizeMemorySystemConfig(merged);
}
