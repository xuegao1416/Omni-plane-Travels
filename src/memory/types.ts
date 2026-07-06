// ============================================================
// 记忆系统类型定义
// 移植自 yijiekkk/src/composables/useMemorySystem.js
// 适配 TypeScript + 世界漫游指南项目结构
// ============================================================

// ─── 记忆系统配置 ───

export interface MemoryProtocolConfig {
  recentTurnPairs: number;
  minRecentTurnPairs: number;
  maxRecentTurnPairs: number;
  compiledContextTokenBudget: number;
  injectAsSystemBlock: boolean;
  titleReplacementStrategy: 'raw' | 'title_only' | 'title_to_summary';
  retrievalSummaryBudget: number;
  retrievalExcerptBudget: number;
}

export interface MemoryWritePipelineConfig {
  trigger: 'post_assistant_turn';
  minBatchTurns: number;
  maxBatchTurns: number;
  minWriteScore: number;
  dedupeWindow: number;
  variableOverlapPolicy: 'prefer_variable_system' | 'prefer_memory' | 'merge';
  apiPresetId: string | null;
  summaryApiPresetId: string | null;
  conflictJudgeApiPresetId: string | null;
  saveSummaryAfterIngest: boolean;
  conflictJudgeEnabled: boolean;
  retryCount: number;
  retryDelayMs: number;
}

export interface MemoryRetrievalConfig {
  useEmbedding: boolean;
  useRerank: boolean;
  useQueryRewrite: boolean;
  useGraphExpand: boolean;
  vectorFallbackEnabled: boolean;
  eventCandidateCount: number;
  eventTopK: number;
  entityTopK: number;
  archiveTopK: number;
  queryRewriteApiPresetId: string | null;
  rerankApiPresetId: string | null;
  rerankLlmApiPresetId: string | null;
  plannerApiPresetId: string | null;
  plannerEnabled: boolean;
  plannerReturnsTitlesOnly: boolean;
  plannerAutoReplaceEnabled: boolean;
  plannerCandidateLimit: number;
  plannerTitleOnlyLimit: number;
  multiRoundEnabled: boolean;
  multiRoundMaxRounds: number;
  keywordRecallThreshold: number;
}

export interface MemoryCompilerConfig {
  sceneBudget: number;
  threadBudget: number;
  stateBudget: number;
  relationBudget: number;
  eventBudget: number;
  entityBudget: number;
  archiveBudget: number;
  dedupeEnabled: boolean;
  hotThreadLimit: number;
  hotStateLimit: number;
  hotRelationLimit: number;
  hotEventLimit: number;
  hotEntityLimit: number;
  threadCandidateLimit: number;
  stateCandidateLimit: number;
  relationCandidateLimit: number;
  eventCandidateLimit: number;
  entityCandidateLimit: number;
  archiveCandidateLimit: number;
  rerankCandidateTotalLimit: number;
  rerankSelectedTotalLimit: number;
  rerankSelectedThreadLimit: number;
  rerankSelectedStateLimit: number;
  rerankSelectedRelationLimit: number;
  rerankSelectedEventLimit: number;
  rerankSelectedEntityLimit: number;
  rerankSelectedArchiveLimit: number;
}

export interface MemoryRetentionConfig {
  archiveResolvedThreadsAfter: number;
  archiveColdEventsAfter: number;
  agingMultiplier: number;
  maxHotEventCards: number;
  checkpointInterval: number;
  maxVectorMemories: number;
}

export interface MemoryDebugConfig {
  enabled: boolean;
  maxLogs: number;
}

export interface MemorySystemConfig {
  enabled: boolean;
  mode: 'compiled_context_v1';
  bankScope: 'per_save';
  memoryMode: 'full' | 'simple';
  protocol: MemoryProtocolConfig;
  writePipeline: MemoryWritePipelineConfig;
  retrieval: MemoryRetrievalConfig;
  compiler: MemoryCompilerConfig;
  retention: MemoryRetentionConfig;
  narrativePromptTemplates: NarrativePromptTemplates;
  debug: MemoryDebugConfig;

  apiPresetId: string | null;
  summaryApiPresetId: string | null;
  retrievalApiPresetId: string | null;
  vectorEnabled: boolean;
  vectorExtractInterval: number;
  vectorRetrieveMode: 'bi_encoder' | 'cross_encoder' | 'hybrid';
  vectorRetrieveCandidateCount: number;
  vectorRetrieveTopK: number;
  vectorScoreThreshold: number;
  vectorQueryContextWindow: number;
  vectorRetrieveUseContextQuery: boolean;
  vectorRetrieveUseEntityQuery: boolean;
  vectorRetrieveDuplicateWindow: number;
  vectorRetrieveMinImportance: number;
  vectorRetrieveMaxPerType: number;
  semanticRetrieveEnabled: boolean;
  vectorRetrieveEnhanceEnabled: boolean;
  vectorRetrieveEnhanceApiPresetId: string | null;
  vectorExtractApiPresetId: string | null;
  vectorApiUrl: string;
  vectorApiKey: string;
  vectorApiModel: string;
  vectorRerankApiUrl: string;
  vectorRerankApiKey: string;
  vectorRerankModel: string;
  vectorRerankUseLlmFallback: boolean;
  vectorRerankLlmApiPresetId: string | null;

  _migrations?: Record<string, boolean>;
}

// ─── 提示词模板 ───

export interface NarrativePromptTemplates {
  ingest: string;
  summary: string;
  retrievePlanner: string;
  multiRoundRetrievePlanner: string;
  multiRoundRetrievePlannerFinal: string;
  queryRewrite: string;
  rerank: string;
  conflictJudge: string;
  vectorExtract: string;
  vectorQueryRewrite: string;
  vectorRerank: string;
  _version?: number;
}

// ─── 记忆运行态 ───

export interface MemoryIngestFailure {
  occurredAt: number;
  message: string;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  cursor: number;
  pendingCount: number;
  attempt: number;
  maxAttempts: number;
  source: string;
  status: 'active' | 'resolved';
  resolvedAt: number;
}

export interface SceneAnchor {
  timeLabel: string;
  locationLabel: string;
  presentEntities: string[];
  immediateGoal: string;
  immediateRisk: string;
  conversationFocus: string;
  recentChange: string;
  confidence: number;
  updatedAt?: number;
}

export interface NarrativeThread {
  id: string;
  title: string;
  summary: string;
  goal: string;
  status: 'open' | 'blocked' | 'suspended' | 'resolved' | 'failed' | 'superseded';
  priority: number;
  blockingReason: string;
  relatedEntities: string[];
  relatedItems: string[];
  relatedLocations: string[];
  deadline: string;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  category?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface NarrativeStateSlot {
  id: string;
  scopeType: 'player' | 'npc' | 'location' | 'world';
  scopeId: string;
  slotType: string;
  value: string;
  summary: string;
  status: 'active' | 'resolved' | 'expired';
  priority: number;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface NarrativeRelationEdge {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  stance: string;
  strength: number;
  status: 'active' | 'broken' | 'changed';
  summary: string;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt?: number;
  updatedAt?: number;
  /** 关系生效的地点范围，如"公寓"、"公司"、"袁小安家"。不确定时填"全局" */
  locationScope?: string;
}

export interface NarrativeRelationNetworkItem {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  summary: string;
  strength: number;
  status: 'active' | 'changed' | 'broken' | 'superseded';
  confidence: number;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt?: number;
  updatedAt?: number;
  /** 关系生效的地点范围，如"公寓"、"公司"、"袁小安家"。不确定时填"全局" */
  locationScope?: string;
}

export interface NarrativeEventCard {
  id: string;
  title: string;
  summary: string;
  excerpt: string;
  importance: number;
  status: 'hot' | 'warm' | 'cold';
  entityRefs: string[];
  locationRefs: string[];
  threadRefs: string[];
  timeLabels: string[];
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export type NarrativeEntityType = 'character' | 'location' | 'faction' | 'item' | 'ability' | 'other';

export interface NarrativeEntityCard {
  id: string;
  name: string;
  entityType: NarrativeEntityType;
  aliases: string[];
  currentStatus: string[];
  stableFacts: string[];
  currentStance: string;
  affiliations: string[];
  relatedThreads: string[];
  relatedEvents: string[];
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt?: number;
  updatedAt?: number;
  /** 带地点标注的事实，用于空间感知记忆。如 { location: "袁小安家", fact: "在此处与赖方杭发生关系" } */
  locationFacts?: Array<{ location: string; fact: string }>;
}

export interface NarrativeArchiveCard {
  id: string;
  title: string;
  arcTitle: string;
  summary: string;
  timeSpan: string;
  keywords: string[];
  entityRefs: string[];
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt?: number;
  archivedAt?: number;
}

export interface NarrativeMutation {
  type: string;
  createdAt: number;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  appliedCount: number;
  lastIngestCursor: number;
}

export interface NarrativeCheckpoint {
  id: string;
  createdAt: number;
  lastIngestCursor: number;
  activeThreadCount: number;
  eventCount: number;
  entityCount: number;
  snapshot?: NarrativeMemoryRuntime;
}

export interface SummarySaveRecord {
  savedAt: number;
  status: 'success' | 'error';
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  applyResult: {
    otherCharacterCount: number;
    playerCount: number;
    itemCount: number;
    eventCount?: number;
    archiveCount?: number;
    vectorCount?: number;
  };
  summaryData?: {
    otherCharacterMemories: SummaryMemoryItem[];
    playerMemories: SummaryMemoryItem[];
    itemMemories: SummaryMemoryItem[];
  };
}

export interface SummaryMemoryItem {
  id?: string;
  title: string;
  summary: string;
  keywords: string[];
  sourceStartIndex?: number | null;
  sourceEndIndex?: number | null;
  savedAt?: number;
}

export interface RetrievePlanSnapshot {
  plannedAt: number;
  candidates: Array<{ title: string; source?: string }>;
  selectedTitles: string[];
  selectedModes: string[];
  strategy: string;
}

export interface CompiledContextSnapshot {
  compiledAt: number;
  fullText: string;
  sections: Record<string, string>;
  sceneAnchor?: SceneAnchor | null;
  runtimeFlow?: RuntimeFlowSnapshot | null;
}

export interface RuntimeFlowSnapshot {
  savedAt: number;
  sourceLabel: string;
  stages: RuntimeFlowStage[];
  auxiliaryDetails?: Record<string, unknown>;
}

export interface RuntimeFlowStage {
  id: string;
  label: string;
  caption?: string;
  status: 'success' | 'fallback' | 'suggestion' | 'idle' | 'error';
  statusLabel?: string;
  icon?: string;
  kicker?: string;
  durationMs?: number;
  chips?: string[];
  metrics?: Array<{ label: string; value: string | number }>;
  blocks?: Array<{
    label: string;
    content: string;
    tone?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
    summary?: string;
  }>;
}

export interface DebugLog {
  kind: string;
  mode?: string;
  sourceStartIndex?: number | null;
  sourceEndIndex?: number | null;
  appliedCount?: number;
  message?: string;
  dropReasons?: string[];
  timestamp?: number;
  [key: string]: unknown;
}

export interface NarrativeMemoryRuntime {
  version: string;
  bankId: string;
  lastIngestCursor: number;
  lastIngestAttemptAt: number;
  lastIngestSuccessAt: number;
  lastIngestFailure: MemoryIngestFailure | null;
  lastRebuildAt: number;
  entityCanonicalVersion: number;
  sceneAnchor: SceneAnchor | null;
  activeThreads: NarrativeThread[];
  stateSlots: NarrativeStateSlot[];
  relationEdges: NarrativeRelationEdge[];
  relationNetwork: NarrativeRelationNetworkItem[];
  eventCards: NarrativeEventCard[];
  entityCards: NarrativeEntityCard[];
  archiveCards: NarrativeArchiveCard[];
  mutationLog: NarrativeMutation[];
  checkpoints: NarrativeCheckpoint[];
  lastCompiledContext: CompiledContextSnapshot | null;
  lastRuntimeFlow: RuntimeFlowSnapshot | null;
  lastSummarySave: SummarySaveRecord | null;
  summarySaveHistory: SummarySaveRecord[];
  lastRetrievePlan: RetrievePlanSnapshot | null;
  writeDebugLogs: DebugLog[];
  retrieveDebugLogs: DebugLog[];
  compileDebugLogs: DebugLog[];
  vectorMemory?: VectorFact[];
}

// ─── 向量记忆 ───

export type VectorFactType =
  | 'task' | 'character' | 'relationship' | 'location' | 'faction'
  | 'event' | 'clue' | 'item' | 'ability' | 'status' | 'rule' | 'world'
  | 'other';

export interface VectorFact {
  fact: string;
  title?: string;
  summary?: string;
  keywords: string[];
  entities: string[];
  primaryType: VectorFactType;
  secondaryTypes: VectorFactType[];
  characters: string[];
  locations: string[];
  factions: string[];
  items: string[];
  abilities: string[];
  events: string[];
  rules: string[];
  timeMarkers: string[];
  importance: number;
  timeScope: 'short' | 'mid' | 'long';
  state: 'active' | 'resolved' | 'expired' | 'unknown';
  sourceStartIndex?: number | null;
  sourceEndIndex?: number | null;
  createdAt?: number;
  embedding?: number[];
}

export interface VectorMemoryItem extends VectorFact {
  id: string;
  searchText?: string;
  embeddingTimestamp?: number;
}

// ─── 查询包 ───

export interface NarrativeQueryPackage {
  intent: string;
  semanticQuery: string;
  entityTerms: string[];
  timeTerms: string[];
  locationTerms: string[];
  threadHints: string[];
  stateHints: string[];
  needRecentConversation: boolean;
  needHistoricalCause: boolean;
  needRelationshipFocus: boolean;
  inputText?: string;
  recentContext?: string;
}

// ─── 检索候选 ───

export interface NarrativeRetrieveCandidate {
  title: string;
  summary: string;
  mode: 'summary' | 'excerpt' | 'full';
  source: 'hot_thread' | 'hot_state' | 'hot_relation' | 'hot_event' | 'hot_entity'
    | 'archive' | 'summary_history' | 'vector' | 'scene';
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  keywords: string[];
  retrievalKeywords?: string[];
  hitKeywords?: string[];
  keywordCoverage?: number;
  hitReasons?: string[];
  importance?: number;
  type?: string;
  [key: string]: unknown;
}

// ─── 编译结果 ───

export interface CompiledNarrativeContext {
  fullText: string;
  sections: {
    scene?: string;
    threads?: string;
    states?: string;
    relations?: string;
    events?: string;
    entities?: string;
    archives?: string;
    vector?: string;
    retrieval?: string;
  };
  sceneAnchor: SceneAnchor | null;
  runtimeFlow: RuntimeFlowSnapshot;
  meta: {
    compiledAt: number;
    recentWindowStartIndex: number;
    retrievalItems: NarrativeRetrieveCandidate[];
    retrievalKeywords: string[];
    sourceRange: { start: number; end: number };
  };
}

// ─── 热态写入结果 ───

export interface NarrativeIngestResult {
  success: boolean;
  sourceStartIndex: number;
  sourceEndIndex: number;
  appliedCount: number;
  dropReasons: string[];
  scenePatch?: Partial<SceneAnchor>;
  threadUpserts?: NarrativeThread[];
  stateSlotUpserts?: NarrativeStateSlot[];
  relationUpserts?: NarrativeRelationEdge[];
  relationNetworkUpserts?: NarrativeRelationNetworkItem[];
  eventCandidates?: NarrativeEventCard[];
  entityPatches?: NarrativeEntityCard[];
  archiveHints?: Array<{ id?: string; title?: string; summary?: string; keywords?: string[] }>;
}

// ─── 摘要保存结果 ───

export interface NarrativeSummaryResult {
  otherCharacterMemories: SummaryMemoryItem[];
  playerMemories: SummaryMemoryItem[];
  itemMemories: SummaryMemoryItem[];
}

// ─── 检索规划结果 ───

export interface NarrativeRetrievePlannerResult {
  items: Array<{ title: string; reason?: string }>;
  retrievalKeywords: string[];
  notes?: string;
}

// ─── 冲突裁决结果 ───

export interface NarrativeConflictJudgeResult {
  action: 'keep_both' | 'update_current' | 'supersede_current' | 'mark_expired' | 'reject_incoming';
  reason: string;
  confidence: number;
}

// ─── 向量检索元信息 ───

export interface VectorRetrieveMeta {
  query: string;
  entityTerms: string[];
  timeTerms: string[];
  locationTerms: string[];
  intent: string;
  candidateCount: number;
  topK: number;
  scoreThreshold: number;
  timestamp: number;
  retrievalKeywords?: string[];
  [key: string]: unknown;
}
