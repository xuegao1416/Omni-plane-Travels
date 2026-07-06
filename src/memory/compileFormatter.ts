// 双层编译格式化器 — 将 NarrativeMemoryRuntime 编译为主AI可消费的上下文文本

import type {
  NarrativeMemoryRuntime,
  NarrativeThread,
  NarrativeEventCard,
  NarrativeEntityCard,
  NarrativeRelationEdge,
  NarrativeRelationNetworkItem,
  NarrativeArchiveCard,
  SceneAnchor,
} from './types';

// ─── 配置 ───

export interface CompileSectionBudget {
  scene: number;
  threads: number;
  relations: number;
  relationNetwork: number;
  events: number;
  entities: number;
  archives: number;
  hotThreadLimit: number;
  hotRelationLimit: number;
  hotEventLimit: number;
  hotEntityLimit: number;
  focusedThreadLimit: number;
  focusedEventLimit: number;
  focusedEntityLimit: number;
  focusedArchiveLimit: number;
}

export const DEFAULT_COMPILE_BUDGET: CompileSectionBudget = {
  scene: 120,
  threads: 220,
  relations: 120,
  relationNetwork: 120,
  events: 320,
  entities: 180,
  archives: 120,
  hotThreadLimit: 4,
  hotRelationLimit: 3,
  hotEventLimit: 3,
  hotEntityLimit: 4,
  focusedThreadLimit: 3,
  focusedEventLimit: 4,
  focusedEntityLimit: 3,
  focusedArchiveLimit: 3,
};

// ─── Token 估算 ───

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 2.5);
}

function trimToTokenBudget(text: string, budget: number): string {
  if (!text || budget <= 0) return '';
  if (estimateTokens(text) <= budget) return text;
  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const lineTokens = estimateTokens(line) + 1;
    if (kept.length === 0 || used + lineTokens <= budget) {
      kept.push(line);
      used += lineTokens;
    } else break;
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── 关键词匹配 ───

function countKeywordHits(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  return keywords.reduce((hits, kw) => kw && lower.includes(kw.toLowerCase()) ? hits + 1 : hits, 0);
}

const asArr = (v: unknown): unknown[] => Array.isArray(v) ? v : (v ? [v] : []);

function threadSearchText(t: NarrativeThread): string {
  return [t.title, t.summary, t.goal, t.blockingReason, ...asArr(t.relatedEntities), ...asArr(t.relatedLocations)].filter(Boolean).join(' ');
}
function eventSearchText(e: NarrativeEventCard): string {
  return [e.title, e.summary, e.excerpt, ...asArr(e.entityRefs), ...asArr(e.locationRefs)].filter(Boolean).join(' ');
}
function entitySearchText(e: NarrativeEntityCard): string {
  return [e.name, ...asArr(e.aliases), ...asArr(e.currentStatus), ...asArr(e.stableFacts), e.currentStance, ...asArr(e.affiliations)].filter(Boolean).join(' ');
}

// ─── 排序与选择 ───

const THREAD_STATUS_BOOST: Record<string, number> = { open: 3, blocked: 2, suspended: 1, resolved: 0, failed: 0, superseded: 0 };
const EVENT_STATUS_BOOST: Record<string, number> = { hot: 3, warm: 1, cold: 0 };

function selectHotThreads(threads: NarrativeThread[], limit: number): NarrativeThread[] {
  return [...threads].sort((a, b) => {
    const d = (THREAD_STATUS_BOOST[b.status] ?? 0) - (THREAD_STATUS_BOOST[a.status] ?? 0);
    return d !== 0 ? d : (b.priority ?? 0) - (a.priority ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  }).slice(0, limit);
}

function selectHotRelations(edges: NarrativeRelationEdge[], limit: number, currentLocation?: string): NarrativeRelationEdge[] {
  return [...edges]
    .filter(e => e.status === 'active' || e.status === 'changed')
    .sort((a, b) => {
      // 当前地点的关系优先
      const aLoc = a.locationScope === currentLocation ? 1 : 0;
      const bLoc = b.locationScope === currentLocation ? 1 : 0;
      if (aLoc !== bLoc) return bLoc - aLoc;
      // active 优先于 changed
      const aStatus = a.status === 'active' ? 1 : 0;
      const bStatus = b.status === 'active' ? 1 : 0;
      if (aStatus !== bStatus) return bStatus - aStatus;
      return (b.strength ?? 0) - (a.strength ?? 0);
    })
    .slice(0, limit);
}

function selectHotRelationNetwork(items: NarrativeRelationNetworkItem[], limit: number, currentLocation?: string): NarrativeRelationNetworkItem[] {
  return [...items]
    .filter(i => i.status === 'active' || i.status === 'changed')
    .sort((a, b) => {
      // 当前地点的关系优先
      const aLoc = a.locationScope === currentLocation ? 1 : 0;
      const bLoc = b.locationScope === currentLocation ? 1 : 0;
      if (aLoc !== bLoc) return bLoc - aLoc;
      // active 优先于 changed
      const aStatus = a.status === 'active' ? 1 : 0;
      const bStatus = b.status === 'active' ? 1 : 0;
      if (aStatus !== bStatus) return bStatus - aStatus;
      return (b.confidence ?? 0) - (a.confidence ?? 0) || (b.strength ?? 0) - (a.strength ?? 0);
    })
    .slice(0, limit);
}

function selectHotEvents(events: NarrativeEventCard[], limit: number): NarrativeEventCard[] {
  return [...events].sort((a, b) => {
    const d = (EVENT_STATUS_BOOST[b.status] ?? 0) - (EVENT_STATUS_BOOST[a.status] ?? 0);
    return d !== 0 ? d : (b.importance ?? 0) - (a.importance ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  }).slice(0, limit);
}

function selectHotEntities(entities: NarrativeEntityCard[], limit: number): NarrativeEntityCard[] {
  return [...entities].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, limit);
}

function selectFocused<T>(items: T[], keywords: string[], limit: number, excludeIds: Set<string>, getSearchText: (item: T) => string, getId: (item: T) => string): T[] {
  if (keywords.length === 0 || limit <= 0) return [];
  return items
    .filter(item => !excludeIds.has(getId(item)))
    .map(item => ({ item, hits: countKeywordHits(getSearchText(item), keywords) }))
    .filter(s => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map(s => s.item);
}

// ─── 格式化 ───

function formatSceneAnchor(sa: SceneAnchor): string {
  const lines: string[] = [];
  if (sa.locationLabel) lines.push(`地点：${sa.locationLabel}`);
  if (sa.timeLabel) lines.push(`时间：${sa.timeLabel}`);
  if (sa.immediateGoal) lines.push(`当前目标：${sa.immediateGoal}`);
  if (sa.immediateRisk) lines.push(`当前风险：${sa.immediateRisk}`);
  if (sa.conversationFocus) lines.push(`对话焦点：${sa.conversationFocus}`);
  if (sa.recentChange) lines.push(`近期变化：${sa.recentChange}`);
  return lines.join('\n');
}

function formatThreadLine(t: NarrativeThread): string {
  const parts = [`- ${t.title}（${t.status}）`];
  if (t.goal) parts.push(`｜目标：${t.goal}`);
  if (t.blockingReason) parts.push(`｜阻塞：${t.blockingReason}`);
  if (t.deadline) parts.push(`｜期限：${t.deadline}`);
  return parts.join('');
}

function formatRelationLine(r: NarrativeRelationEdge): string {
  const loc = r.locationScope ? ` [${r.locationScope}]` : '';
  return `- ${r.sourceEntityId} → ${r.targetEntityId}：${r.relationType}${loc}｜${r.summary}`;
}

function formatRelationNetworkLine(r: NarrativeRelationNetworkItem): string {
  const loc = r.locationScope ? ` [${r.locationScope}]` : '';
  return `- ${r.sourceEntityId} ↔ ${r.targetEntityId}：${r.relationType}${loc}｜${r.summary}`;
}

function formatEventLine(e: NarrativeEventCard): string {
  const locs = asArr(e.locationRefs);
  const loc = locs.length > 0 ? ` [${locs.join('/')}]` : '';
  return `- ${e.title}${loc}｜${e.summary}`;
}

function formatEntityLine(e: NarrativeEntityCard): string {
  const parts = [`- ${e.name}（${e.entityType}）`];
  const status = asArr(e.currentStatus);
  if (status.length > 0) parts.push(`｜状态：${status.join(', ')}`);
  if (e.currentStance) parts.push(`｜立场：${e.currentStance}`);
  const facts = asArr(e.stableFacts);
  if (facts.length > 0) parts.push(`｜${facts[0]}`);
  // 带地点的事实（优先显示当前场景相关的）
  const locFacts = e.locationFacts;
  if (locFacts && locFacts.length > 0) {
    parts.push(`｜地点事实：${locFacts[0].location} - ${locFacts[0].fact}`);
  }
  return parts.join('');
}

function formatArchiveLine(a: NarrativeArchiveCard): string {
  const parts = [`- ${a.arcTitle}`];
  if (a.summary) parts.push(`｜${a.summary}`);
  if (a.timeSpan) parts.push(`｜${a.timeSpan}`);
  return parts.join('');
}

// ─── 主编译函数 ───

export interface CompiledOutput {
  text: string;
  tokenEstimate: number;
  sections: Record<string, string>;
  hotIds: { threads: string[]; relations: string[]; relationNetwork: string[]; events: string[]; entities: string[] };
}

export function formatRuntimeToCompiledText(
  runtime: NarrativeMemoryRuntime,
  queryKeywords: string[],
  budget: CompileSectionBudget = DEFAULT_COMPILE_BUDGET,
): CompiledOutput {
  const hotSections: string[] = [];
  const focusedSections: string[] = [];
  const sections: Record<string, string> = {};
  const hotIds = { threads: [] as string[], relations: [] as string[], relationNetwork: [] as string[], events: [] as string[], entities: [] as string[] };

  // ─── 热态常驻层 ───

  if (runtime.sceneAnchor) {
    const sceneText = formatSceneAnchor(runtime.sceneAnchor);
    if (sceneText) {
      const trimmed = trimToTokenBudget(sceneText, budget.scene);
      hotSections.push(`【当前场景】\n${trimmed}`);
      sections.scene = trimmed;
    }
  }

  const hotThreads = selectHotThreads(runtime.activeThreads, budget.hotThreadLimit);
  if (hotThreads.length > 0) {
    const text = hotThreads.map(formatThreadLine).join('\n');
    const trimmed = trimToTokenBudget(text, budget.threads);
    hotSections.push(`【热态线程】\n${trimmed}`);
    sections.threads = trimmed;
    hotIds.threads = hotThreads.map(t => t.id);
  }

  const currentLocation = runtime.sceneAnchor?.locationLabel || '';

  const hotRelations = selectHotRelations(runtime.relationEdges, budget.hotRelationLimit, currentLocation);
  if (hotRelations.length > 0) {
    const text = hotRelations.map(formatRelationLine).join('\n');
    const trimmed = trimToTokenBudget(text, budget.relations);
    hotSections.push(`【热态关系】\n${trimmed}`);
    sections.relations = trimmed;
    hotIds.relations = hotRelations.map(r => r.id);
  }

  const hotNetwork = selectHotRelationNetwork(runtime.relationNetwork, budget.hotRelationLimit, currentLocation);
  if (hotNetwork.length > 0) {
    const text = hotNetwork.map(formatRelationNetworkLine).join('\n');
    const trimmed = trimToTokenBudget(text, budget.relationNetwork);
    hotSections.push(`【人物关系网】\n${trimmed}`);
    sections.relationNetwork = trimmed;
    hotIds.relationNetwork = hotNetwork.map(r => r.id);
  }

  const hotEvents = selectHotEvents(runtime.eventCards, budget.hotEventLimit);
  if (hotEvents.length > 0) {
    const text = hotEvents.map(formatEventLine).join('\n');
    const trimmed = trimToTokenBudget(text, budget.events);
    hotSections.push(`【热态事件】\n${trimmed}`);
    sections.events = trimmed;
    hotIds.events = hotEvents.map(e => e.id);
  }

  const hotEntities = selectHotEntities(runtime.entityCards, budget.hotEntityLimit);
  if (hotEntities.length > 0) {
    const text = hotEntities.map(formatEntityLine).join('\n');
    const trimmed = trimToTokenBudget(text, budget.entities);
    hotSections.push(`【热态实体】\n${trimmed}`);
    sections.entities = trimmed;
    hotIds.entities = hotEntities.map(e => e.id);
  }

  // ─── 查询扩展层 ───

  const threadHotIds = new Set(hotIds.threads);
  const eventHotIds = new Set(hotIds.events);
  const entityHotIds = new Set(hotIds.entities);

  const focusedThreads = selectFocused(runtime.activeThreads, queryKeywords, budget.focusedThreadLimit, threadHotIds, threadSearchText, t => t.id);
  if (focusedThreads.length > 0) {
    focusedSections.push(`【查询相关线程】\n${trimToTokenBudget(focusedThreads.map(formatThreadLine).join('\n'), budget.threads)}`);
  }

  const focusedEvents = selectFocused(runtime.eventCards, queryKeywords, budget.focusedEventLimit, eventHotIds, eventSearchText, e => e.id);
  if (focusedEvents.length > 0) {
    focusedSections.push(`【查询相关事件】\n${trimToTokenBudget(focusedEvents.map(formatEventLine).join('\n'), budget.events)}`);
  }

  const focusedEntities = selectFocused(runtime.entityCards, queryKeywords, budget.focusedEntityLimit, entityHotIds, entitySearchText, e => e.id);
  if (focusedEntities.length > 0) {
    focusedSections.push(`【查询相关实体】\n${trimToTokenBudget(focusedEntities.map(formatEntityLine).join('\n'), budget.entities)}`);
  }

  if (runtime.archiveCards.length > 0) {
    const sorted = [...runtime.archiveCards].sort((a, b) => (b.archivedAt ?? b.createdAt ?? 0) - (a.archivedAt ?? a.createdAt ?? 0)).slice(0, budget.focusedArchiveLimit);
    const trimmed = trimToTokenBudget(sorted.map(formatArchiveLine).join('\n'), budget.archives);
    focusedSections.push(`【远历史补充】\n${trimmed}`);
    sections.archives = trimmed;
  }

  // ─── 组装 ───

  const compiledBlocks = [
    hotSections.length > 0 ? `【热态常驻层】\n${hotSections.join('\n\n')}` : '',
    focusedSections.length > 0 ? `【查询扩展层】\n${focusedSections.join('\n\n')}` : '',
  ].filter(Boolean);

  const text = compiledBlocks.length > 0 ? `[叙事运行时上下文]\n\n${compiledBlocks.join('\n\n')}` : '';

  return { text, tokenEstimate: estimateTokens(text), sections, hotIds };
}
