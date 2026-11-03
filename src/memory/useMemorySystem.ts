// Shared pipeline contracts. The former duplicate React hook had no runtime callers.
import type { MemoryEntry, VectorMemoryItem } from './types';
import type { MemoryApiPort } from '../api/presets';
import type { parseVectorQueryRewriteResult, parseNarrativeRetrievePlannerResult, parseRerankResult } from './narrativeParsers';

export type { MemoryEntry } from './types';

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
  /** 回合取消信号，贯穿 AI、Embedding 和等待。 */
  signal?: AbortSignal;
  /** 本层剧情文本 */
  batchText: string;
  /** 用户输入 */
  inputText: string;
  /** 本轮 AI 原文；首轮准备阶段可能尚未填充。 */
  assistantText?: string;
  /** 最近上下文 */
  recentContext: string;
  /** 玩家名字 */
  playerName: string;
  /** API 配置（记忆系统默认） */
  apiConfig: MemoryApiPort;
  /** 各阶段独立 API 配置（可选，未设置则回退到 apiConfig） */
  writeApiConfig?: MemoryApiPort;
  summaryApiConfig?: MemoryApiPort;
  conflictJudgeApiConfig?: MemoryApiPort;
  retrievalApiConfig?: MemoryApiPort;
  vectorApiConfig?: MemoryApiPort;
  /** 管线间共享数据 */
  _queryRewriteResult?: ReturnType<typeof parseVectorQueryRewriteResult>;
  _plannerResult?: ReturnType<typeof parseNarrativeRetrievePlannerResult>;
  _rerankResult?: ReturnType<typeof parseRerankResult>;
  _selectedEntries?: MemoryEntry[];
  /** 当前输入通过真实 embedding 召回的长期事实 */
  _selectedVectorFacts?: Array<VectorMemoryItem & { similarity?: number }>;
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
  /** 资源状态快照（从 GameState 提取，供编译阶段注入 AI 上下文） */
  resourceState?: import('./compileFormatter').ResourceSnapshot[];
}
