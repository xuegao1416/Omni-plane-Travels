// ============================================================
// 记忆系统 Mermaid 图谱生成器
// 移植自 yijiekkk/src/utils/memory-mermaid.js
// 生成记忆运行态的 Mermaid 流程图定义
// ============================================================

import type {
  SceneAnchor,
  NarrativeThread,
  NarrativeStateSlot,
  NarrativeRelationEdge,
  NarrativeRelationNetworkItem,
  NarrativeEventCard,
  NarrativeEntityCard,
  NarrativeArchiveCard,
  NarrativeMutation,
  NarrativeCheckpoint,
  NarrativeMemoryRuntime,
  VectorFact,
  SummarySaveRecord,
  RetrievePlanSnapshot,
  DebugLog,
} from './types';

// ============================================================
//  常量
// ============================================================

export const TAB_LABELS: Record<string, string> = {
  scene: '场景',
  threads: '线程',
  states: '状态',
  relations: '关系',
  relationNetwork: '关系网',
  events: '事件',
  entities: '实体',
  archives: '归档',
  vector: '向量',
  summary: '摘要',
  mutations: '变更',
  checkpoints: '检查点',
  logs: '日志',
};

// ============================================================
//  工具函数
// ============================================================

function normalizeText(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function truncateText(text: string, maxLen: number): string {
  const str = String(text ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function sanitizeMermaidText(text: unknown): string {
  const str = normalizeText(text);
  // Mermaid 对特殊字符敏感，需要转义
  return str
    .replace(/[\n\r]+/g, ' ')
    .replace(/[""]/g, "'")
    .replace(/[<>\[\]{}|#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatShortDateTime(timestamp: unknown): string {
  const num = Number(timestamp);
  if (!Number.isFinite(num) || num <= 0) return '';
  const d = new Date(num);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRange(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null && end == null) return '';
  const s = start ?? '?';
  const e = end ?? '?';
  return `[${s}, ${e}]`;
}

function takeItems<T>(arr: T[] | null | undefined, limit: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, limit);
}

function createIdFactory(prefix: string) {
  let counter = 0;
  return (): string => {
    counter += 1;
    return `${prefix}_${counter}`;
  };
}

// ─── 详情字段构建 ───

interface DetailField {
  label: string;
  value: string;
}

function createDetailFields(fields: DetailField[]): string {
  return fields
    .filter((f) => f.value)
    .map((f) => `**${f.label}:** ${f.value}`)
    .join('<br/>');
}

function createNodeDetail(title: string, fields: DetailField[]): Record<string, unknown> {
  return { title, fields };
}

function createFallbackNodeDetail(title: string, content: string): Record<string, unknown> {
  return {
    title,
    fields: [{ label: '内容', value: content }],
  };
}

function buildInfoNodeDetail(
  title: string,
  subtitle: string,
  extra?: DetailField[],
): Record<string, unknown> {
  const fields: DetailField[] = [{ label: '信息', value: subtitle }];
  if (extra) fields.push(...extra);
  return { title, fields };
}

function buildCollectionNodeDetail(
  title: string,
  items: string[],
  maxItems = 6,
): Record<string, unknown> {
  const shown = takeItems(items, maxItems);
  const value = shown.join(', ') + (items.length > maxItems ? ` (+${items.length - maxItems})` : '');
  return {
    title,
    fields: [{ label: '列表', value }],
  };
}

function buildTruncatedNodeDetail(
  title: string,
  text: string,
  maxLen = 120,
): Record<string, unknown> {
  return {
    title,
    fields: [{ label: '内容', value: truncateText(text, maxLen) }],
  };
}

// ============================================================
//  图谱构建器
// ============================================================

interface GraphNode {
  id: string;
  label: string;
  shape: 'rect' | 'rounded' | 'stadium' | 'diamond' | 'circle' | 'subroutine';
  class: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dotted' | 'dashed';
}

interface GraphBuilderResult {
  definition: string;
  nodeDetails: Record<string, unknown>;
}

function createGraphBuilder(direction: 'TB' | 'LR' = 'TB') {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeDetails: Record<string, unknown> = {};

  function addNode(
    id: string,
    label: string,
    shape: GraphNode['shape'] = 'rounded',
    cls = '',
    detail?: Record<string, unknown>,
  ): string {
    nodes.push({ id, label: sanitizeMermaidText(label), shape, class: cls });
    if (detail) {
      nodeDetails[id] = detail;
    }
    return id;
  }

  function addEdge(
    from: string,
    to: string,
    label?: string,
    style: GraphEdge['style'] = 'solid',
  ): void {
    edges.push({ from, to, label: label ? sanitizeMermaidText(label) : undefined, style });
  }

  function getNodeDetail(id: string): Record<string, unknown> | undefined {
    return nodeDetails[id] as Record<string, unknown> | undefined;
  }

  function getResult(): GraphBuilderResult {
    // 构建 Mermaid 定义
    const lines: string[] = [];
    lines.push(`graph ${direction}`);

    // 节点
    for (const node of nodes) {
      const safeLabel = node.label.replace(/"/g, "'");
      switch (node.shape) {
        case 'rect':
          lines.push(`  ${node.id}["${safeLabel}"]`);
          break;
        case 'rounded':
          lines.push(`  ${node.id}("${safeLabel}")`);
          break;
        case 'stadium':
          lines.push(`  ${node.id}(["${safeLabel}"])`);
          break;
        case 'diamond':
          lines.push(`  ${node.id}{"${safeLabel}"}`);
          break;
        case 'circle':
          lines.push(`  ${node.id}(("${safeLabel}"))`);
          break;
        case 'subroutine':
          lines.push(`  ${node.id}[["${safeLabel}"]]`);
          break;
      }
    }

    // 空行分隔
    if (nodes.length > 0 && edges.length > 0) {
      lines.push('');
    }

    // 边
    for (const edge of edges) {
      const labelPart = edge.label ? `|${edge.label}|` : '';
      if (edge.style === 'dotted') {
        lines.push(`  ${edge.from} -.${labelPart}.-> ${edge.to}`);
      } else if (edge.style === 'dashed') {
        lines.push(`  ${edge.from} ==${labelPart}==> ${edge.to}`);
      } else {
        lines.push(`  ${edge.from} -->${labelPart} ${edge.to}`);
      }
    }

    // 样式类定义（匹配项目浅色主题）
    lines.push('');
    lines.push('  classDef center fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e293b;');
    lines.push('  classDef scene fill:#dbeafe,stroke:#3b82f6,stroke-width:1.6px,color:#1e293b;');
    lines.push('  classDef thread fill:#ede9fe,stroke:#8b5cf6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef state fill:#d1fae5,stroke:#10b981,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef relation fill:#ffedd5,stroke:#f97316,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef event fill:#fce7f3,stroke:#ec4899,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef entity fill:#dbeafe,stroke:#3b82f6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef archive fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef vector fill:#ccfbf1,stroke:#14b8a6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef summary fill:#fef3c7,stroke:#f59e0b,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef mutation fill:#fef9c3,stroke:#eab308,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef checkpoint fill:#dbeafe,stroke:#3b82f6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef log fill:#d1fae5,stroke:#10b981,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef accent fill:#dbeafe,stroke:#3b82f6,stroke-width:1.4px,color:#1e293b;');
    lines.push('  classDef muted fill:#f1f5f9,stroke:#94a3b8,stroke-width:1.1px,color:#475569,stroke-dasharray:5 3;');
    lines.push('  classDef rootNode fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e293b;');
    lines.push('  classDef infoNode fill:#dbeafe,stroke:#3b82f6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef goalNode fill:#d1fae5,stroke:#10b981,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef riskNode fill:#fce7f3,stroke:#ec4899,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef focusNode fill:#ede9fe,stroke:#8b5cf6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef changeNode fill:#ffedd5,stroke:#f97316,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef metricNode fill:#ccfbf1,stroke:#14b8a6,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef timeNode fill:#fef3c7,stroke:#f59e0b,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef collectionNode fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#1e293b;');
    lines.push('  classDef emptyNode fill:#f1f5f9,stroke:#94a3b8,stroke-width:1.1px,color:#475569;');
    lines.push('  classDef filterNode fill:#dbeafe,stroke:#3b82f6,stroke-width:1.4px,color:#1e293b;');

    // 应用样式类到节点
    const classNodes = nodes.filter((n) => n.class);
    if (classNodes.length > 0) {
      lines.push('');
      const classGroups = new Map<string, string[]>();
      for (const node of classNodes) {
        const existing = classGroups.get(node.class) || [];
        existing.push(node.id);
        classGroups.set(node.class, existing);
      }
      for (const [cls, ids] of classGroups) {
        lines.push(`  class ${ids.join(',')} ${cls}`);
      }
    }

    return {
      definition: lines.join('\n'),
      nodeDetails: { ...nodeDetails },
    };
  }

  return { addNode, addEdge, getNodeDetail, getResult };
}

// ============================================================
//  图谱构建辅助函数
// ============================================================

function addInfoNode(
  builder: ReturnType<typeof createGraphBuilder>,
  id: string,
  title: string,
  content: string,
  shape: GraphNode['shape'] = 'rounded',
  cls = '',
): string {
  const displayLabel = `${title}: ${truncateText(content, 60)}`;
  return builder.addNode(id, displayLabel, shape, cls, buildInfoNodeDetail(title, content));
}

function addCollectionNodes(
  builder: ReturnType<typeof createGraphBuilder>,
  parentId: string,
  items: string[],
  prefix: string,
  maxItems = 6,
  label = '包含',
): void {
  const shown = takeItems(items, maxItems);
  for (let i = 0; i < shown.length; i++) {
    const nodeId = `${prefix}_${i}`;
    builder.addNode(nodeId, shown[i], 'rounded', '', buildTruncatedNodeDetail(shown[i], shown[i]));
    builder.addEdge(parentId, nodeId, label);
  }
  if (items.length > maxItems) {
    const moreId = `${prefix}_more`;
    builder.addNode(moreId, `+${items.length - maxItems} 更多...`, 'rounded', '');
    builder.addEdge(parentId, moreId, label);
  }
}

function attachQueryNode(
  builder: ReturnType<typeof createGraphBuilder>,
  parentId: string,
  query: string,
): void {
  if (!query) return;
  const queryId = 'query_filter';
  builder.addNode(queryId, `筛选: ${truncateText(query, 30)}`, 'stadium', 'filterNode');
  builder.addEdge(parentId, queryId, '筛选');
}

// ============================================================
//  各图谱构建器
// ============================================================

function buildEmptyGraph(tabLabel: string): GraphBuilderResult {
  const builder = createGraphBuilder('TB');
  const emptyId = 'empty_state';
  builder.addNode(emptyId, `${tabLabel} - 暂无数据`, 'stadium', 'emptyNode', {
    title: tabLabel,
    fields: [{ label: '状态', value: '当前没有任何数据可展示。请在游戏中发送消息后查看。' }],
  });
  return builder.getResult();
}

// ─── 场景图谱 ───

interface SceneGraphOptions {
  sceneAnchor: SceneAnchor | null;
  query?: string;
}

function buildSceneGraph(options: SceneGraphOptions): GraphBuilderResult {
  const { sceneAnchor, query } = options;
  if (!sceneAnchor) return buildEmptyGraph(TAB_LABELS.scene);

  const builder = createGraphBuilder('TB');
  const rootId = 'scene_root';
  builder.addNode(rootId, '当前场景', 'stadium', 'rootNode', buildInfoNodeDetail('当前场景', sceneAnchor.locationLabel || '未知地点'));

  // 时间
  if (sceneAnchor.timeLabel) {
    addInfoNode(builder, 'scene_time', '时间', sceneAnchor.timeLabel, 'rounded', 'infoNode');
    builder.addEdge(rootId, 'scene_time');
  }

  // 地点
  if (sceneAnchor.locationLabel) {
    addInfoNode(builder, 'scene_location', '地点', sceneAnchor.locationLabel, 'rounded', 'infoNode');
    builder.addEdge(rootId, 'scene_location');
  }

  // 在场实体
  if (sceneAnchor.presentEntities?.length) {
    const presentId = 'scene_present';
    builder.addNode(presentId, `在场 (${sceneAnchor.presentEntities.length})`, 'rounded', 'collectionNode',
      buildCollectionNodeDetail('在场实体', sceneAnchor.presentEntities));
    builder.addEdge(rootId, presentId);
    addCollectionNodes(builder, presentId, sceneAnchor.presentEntities, 'scene_entity', 8, '出场');
  }

  // 目标
  if (sceneAnchor.immediateGoal) {
    addInfoNode(builder, 'scene_goal', '当前目标', sceneAnchor.immediateGoal, 'rounded', 'goalNode');
    builder.addEdge(rootId, 'scene_goal');
  }

  // 风险
  if (sceneAnchor.immediateRisk) {
    addInfoNode(builder, 'scene_risk', '当前风险', sceneAnchor.immediateRisk, 'rounded', 'riskNode');
    builder.addEdge(rootId, 'scene_risk');
  }

  // 对话焦点
  if (sceneAnchor.conversationFocus) {
    addInfoNode(builder, 'scene_focus', '对话焦点', sceneAnchor.conversationFocus, 'rounded', 'focusNode');
    builder.addEdge(rootId, 'scene_focus');
  }

  // 近期变化
  if (sceneAnchor.recentChange) {
    addInfoNode(builder, 'scene_change', '近期变化', sceneAnchor.recentChange, 'rounded', 'changeNode');
    builder.addEdge(rootId, 'scene_change');
  }

  // 置信度
  if (sceneAnchor.confidence != null) {
    const pct = `${(sceneAnchor.confidence * 100).toFixed(0)}%`;
    addInfoNode(builder, 'scene_confidence', '置信度', pct, 'circle', 'metricNode');
    builder.addEdge(rootId, 'scene_confidence');
  }

  // 更新时间
  if (sceneAnchor.updatedAt) {
    addInfoNode(builder, 'scene_updated', '更新于', formatShortDateTime(sceneAnchor.updatedAt), 'rounded', 'timeNode');
    builder.addEdge(rootId, 'scene_updated');
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 线程图谱 ───

interface ThreadsGraphOptions {
  threads: NarrativeThread[];
  query?: string;
}

function buildThreadsGraph(options: ThreadsGraphOptions): GraphBuilderResult {
  const { threads, query } = options;
  if (!threads || threads.length === 0) return buildEmptyGraph(TAB_LABELS.threads);

  const builder = createGraphBuilder('TB');
  const rootId = 'threads_root';
  builder.addNode(rootId, `叙事线程 (${threads.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('叙事线程', `共 ${threads.length} 条`));

  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    const nodeId = `thread_${i}`;
    const statusIcon = t.status === 'open' ? '[O]' : t.status === 'blocked' ? '[B]' : t.status === 'resolved' ? '[R]' : t.status === 'failed' ? '[F]' : `[${t.status.charAt(0).toUpperCase()}]`;
    const label = `${statusIcon} ${truncateText(t.title || t.id, 40)}`;

    builder.addNode(nodeId, label, 'rounded', `thread_${t.status}`,
      createNodeDetail(t.title || t.id, [
        { label: 'ID', value: t.id },
        { label: '状态', value: t.status },
        { label: '优先级', value: String(t.priority) },
        { label: '目标', value: t.goal },
        { label: '摘要', value: truncateText(t.summary, 100) },
        { label: '阻塞原因', value: t.blockingReason },
        { label: '截止时间', value: t.deadline },
        { label: '关联实体', value: Array.isArray(t.relatedEntities) ? t.relatedEntities.join(', ') : '' },
        { label: '关联物品', value: Array.isArray(t.relatedItems) ? t.relatedItems.join(', ') : '' },
        { label: '关联地点', value: Array.isArray(t.relatedLocations) ? t.relatedLocations.join(', ') : '' },
        { label: '来源范围', value: formatRange(t.sourceStartIndex, t.sourceEndIndex) },
        { label: '创建时间', value: formatShortDateTime(t.createdAt) },
        { label: '更新时间', value: formatShortDateTime(t.updatedAt) },
      ]));
    builder.addEdge(rootId, nodeId, t.status);

    // 关联实体子节点
    if (t.relatedEntities?.length) {
      addCollectionNodes(builder, nodeId, t.relatedEntities, `thread_${i}_entity`, 4, '关联');
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 状态槽图谱 ───

interface StatesGraphOptions {
  states: NarrativeStateSlot[];
  query?: string;
}

function buildStatesGraph(options: StatesGraphOptions): GraphBuilderResult {
  const { states, query } = options;
  if (!states || states.length === 0) return buildEmptyGraph(TAB_LABELS.states);

  const builder = createGraphBuilder('TB');
  const rootId = 'states_root';
  builder.addNode(rootId, `状态槽 (${states.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('状态槽', `共 ${states.length} 个`));

  // 按 scopeType 分组
  const groups = new Map<string, NarrativeStateSlot[]>();
  for (const s of states) {
    const key = s.scopeType || 'other';
    const arr = groups.get(key) || [];
    arr.push(s);
    groups.set(key, arr);
  }

  const scopeLabels: Record<string, string> = {
    player: '玩家',
    npc: 'NPC',
    location: '地点',
    world: '世界',
  };

  for (const [scope, items] of groups) {
    const groupId = `state_group_${scope}`;
    builder.addNode(groupId, `${scopeLabels[scope] || scope} (${items.length})`, 'rounded', 'groupNode');
    builder.addEdge(rootId, groupId);

    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const nodeId = `state_${scope}_${i}`;
      const statusIcon = s.status === 'active' ? '[A]' : s.status === 'resolved' ? '[R]' : '[E]';
      const label = `${statusIcon} ${truncateText(s.slotType || s.summary || s.id, 36)}`;

      builder.addNode(nodeId, label, 'rounded', `state_${s.status}`,
        createNodeDetail(s.slotType || s.id, [
          { label: 'ID', value: s.id },
          { label: '范围', value: `${s.scopeType}/${s.scopeId}` },
          { label: '类型', value: s.slotType },
          { label: '状态', value: s.status },
          { label: '优先级', value: String(s.priority) },
          { label: '当前值', value: truncateText(s.value, 100) },
          { label: '摘要', value: truncateText(s.summary, 100) },
          { label: '来源范围', value: formatRange(s.sourceStartIndex, s.sourceEndIndex) },
          { label: '创建时间', value: formatShortDateTime(s.createdAt) },
          { label: '更新时间', value: formatShortDateTime(s.updatedAt) },
        ]));
      builder.addEdge(groupId, nodeId, s.slotType);
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 关系图谱 ───

interface RelationsGraphOptions {
  relations: NarrativeRelationEdge[];
  query?: string;
}

function buildRelationsGraph(options: RelationsGraphOptions): GraphBuilderResult {
  const { relations, query } = options;
  if (!relations || relations.length === 0) return buildEmptyGraph(TAB_LABELS.relations);

  const builder = createGraphBuilder('LR');
  const rootId = 'relations_root';
  builder.addNode(rootId, `关系边 (${relations.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('关系边', `共 ${relations.length} 条`));

  // 收集所有实体
  const entitySet = new Set<string>();
  for (const r of relations) {
    if (r.sourceEntityId) entitySet.add(r.sourceEntityId);
    if (r.targetEntityId) entitySet.add(r.targetEntityId);
  }

  // 创建实体节点
  let entityIdx = 0;
  const entityNodeIdMap = new Map<string, string>();
  for (const entity of entitySet) {
    const nodeId = `entity_${entityIdx}`;
    entityNodeIdMap.set(entity, nodeId);
    builder.addNode(nodeId, truncateText(entity, 24), 'circle', 'entityNode');
    builder.addEdge(rootId, nodeId);
    entityIdx++;
  }

  // 创建关系边
  for (let i = 0; i < relations.length; i++) {
    const r = relations[i];
    const sourceNode = entityNodeIdMap.get(r.sourceEntityId);
    const targetNode = entityNodeIdMap.get(r.targetEntityId);

    if (sourceNode && targetNode) {
      const relId = `rel_${i}`;
      const stanceIcon = r.stance === 'ally' ? '+' : r.stance === 'enemy' ? '-' : '~';
      const label = `${r.relationType} ${stanceIcon} (${r.strength.toFixed(1)})`;

      builder.addNode(relId, `${r.relationType}: ${truncateText(r.summary, 40)}`, 'rect', `rel_${r.status}`,
        createNodeDetail(`${r.sourceEntityId} - ${r.targetEntityId}`, [
          { label: 'ID', value: r.id },
          { label: '关系类型', value: r.relationType },
          { label: '立场', value: r.stance },
          { label: '强度', value: r.strength.toFixed(2) },
          { label: '状态', value: r.status },
          { label: '摘要', value: truncateText(r.summary, 100) },
          { label: '来源范围', value: formatRange(r.sourceStartIndex, r.sourceEndIndex) },
        ]));
      builder.addEdge(sourceNode, relId);
      builder.addEdge(relId, targetNode, label, r.status === 'broken' ? 'dashed' : 'solid');
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 关系网图谱 ───

interface RelationNetworkGraphOptions {
  relationNetwork: NarrativeRelationNetworkItem[];
  query?: string;
}

function buildRelationNetworkGraph(options: RelationNetworkGraphOptions): GraphBuilderResult {
  const { relationNetwork, query } = options;
  if (!relationNetwork || relationNetwork.length === 0) return buildEmptyGraph(TAB_LABELS.relationNetwork);

  const builder = createGraphBuilder('LR');
  const rootId = 'network_root';
  builder.addNode(rootId, `关系网络 (${relationNetwork.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('关系网络', `共 ${relationNetwork.length} 条关系`));

  // 收集实体
  const entitySet = new Set<string>();
  for (const r of relationNetwork) {
    if (r.sourceEntityId) entitySet.add(r.sourceEntityId);
    if (r.targetEntityId) entitySet.add(r.targetEntityId);
  }

  let entityIdx = 0;
  const entityNodeIdMap = new Map<string, string>();
  for (const entity of entitySet) {
    const nodeId = `net_entity_${entityIdx}`;
    entityNodeIdMap.set(entity, nodeId);
    builder.addNode(nodeId, truncateText(entity, 24), 'circle', 'entityNode');
    builder.addEdge(rootId, nodeId);
    entityIdx++;
  }

  for (let i = 0; i < relationNetwork.length; i++) {
    const r = relationNetwork[i];
    const sourceNode = entityNodeIdMap.get(r.sourceEntityId);
    const targetNode = entityNodeIdMap.get(r.targetEntityId);

    if (sourceNode && targetNode) {
      const edgeStyle: GraphEdge['style'] = r.status === 'broken' ? 'dashed' : r.status === 'superseded' ? 'dotted' : 'solid';
      const label = `${r.relationType} (${r.strength.toFixed(1)})`;

      builder.addNode(`net_rel_${i}`, `${r.relationType}: ${truncateText(r.summary, 36)}`, 'rect', `net_rel_${r.status}`,
        createNodeDetail(`${r.sourceEntityId} -> ${r.targetEntityId}`, [
          { label: 'ID', value: r.id },
          { label: '关系类型', value: r.relationType },
          { label: '强度', value: r.strength.toFixed(2) },
          { label: '置信度', value: r.confidence.toFixed(2) },
          { label: '状态', value: r.status },
          { label: '摘要', value: truncateText(r.summary, 100) },
          { label: '来源范围', value: formatRange(r.sourceStartIndex, r.sourceEndIndex) },
        ]));
      builder.addEdge(sourceNode, `net_rel_${i}`);
      builder.addEdge(`net_rel_${i}`, targetNode, label, edgeStyle);
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 事件图谱 ───

interface EventsGraphOptions {
  events: NarrativeEventCard[];
  query?: string;
}

function buildEventsGraph(options: EventsGraphOptions): GraphBuilderResult {
  const { events, query } = options;
  if (!events || events.length === 0) return buildEmptyGraph(TAB_LABELS.events);

  const builder = createGraphBuilder('TB');
  const rootId = 'events_root';
  builder.addNode(rootId, `事件卡 (${events.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('事件卡', `共 ${events.length} 个事件`));

  // 按状态分组
  const hotEvents = events.filter((e) => e.status === 'hot');
  const warmEvents = events.filter((e) => e.status === 'warm');
  const coldEvents = events.filter((e) => e.status === 'cold');
  const otherEvents = events.filter((e) => !['hot', 'warm', 'cold'].includes(e.status));

  function addEventGroup(groupEvents: NarrativeEventCard[], groupLabel: string, groupId: string) {
    if (groupEvents.length === 0) return;
    builder.addNode(groupId, `${groupLabel} (${groupEvents.length})`, 'rounded', 'groupNode');
    builder.addEdge(rootId, groupId);

    for (let i = 0; i < groupEvents.length; i++) {
      const e = groupEvents[i];
      const nodeId = `${groupId}_${i}`;
      const importanceBar = '★'.repeat(Math.min(e.importance, 5));
      const label = `${importanceBar} ${truncateText(e.title, 36)}`;

      builder.addNode(nodeId, label, 'rounded', `event_${e.status}`,
        createNodeDetail(e.title, [
          { label: 'ID', value: e.id },
          { label: '状态', value: e.status },
          { label: '重要度', value: `${e.importance}/5` },
          { label: '摘要', value: truncateText(e.summary, 120) },
          { label: '摘录', value: truncateText(e.excerpt, 80) },
          { label: '时间标签', value: Array.isArray(e.timeLabels) ? e.timeLabels.join(', ') : '' },
          { label: '关联实体', value: Array.isArray(e.entityRefs) ? e.entityRefs.join(', ') : '' },
          { label: '关联地点', value: Array.isArray(e.locationRefs) ? e.locationRefs.join(', ') : '' },
          { label: '关联线程', value: Array.isArray(e.threadRefs) ? e.threadRefs.join(', ') : '' },
          { label: '来源范围', value: formatRange(e.sourceStartIndex, e.sourceEndIndex) },
          { label: '创建时间', value: formatShortDateTime(e.createdAt) },
        ]));
      builder.addEdge(groupId, nodeId);

      // 关联实体
      if (e.entityRefs?.length) {
        addCollectionNodes(builder, nodeId, e.entityRefs, `${nodeId}_ent`, 3, '涉及');
      }
    }
  }

  addEventGroup(hotEvents, '热点事件', 'events_hot');
  addEventGroup(warmEvents, '温态事件', 'events_warm');
  addEventGroup(coldEvents, '冷态事件', 'events_cold');
  if (otherEvents.length > 0) addEventGroup(otherEvents, '其他事件', 'events_other');

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 实体图谱 ───

interface EntitiesGraphOptions {
  entities: NarrativeEntityCard[];
  query?: string;
}

function buildEntitiesGraph(options: EntitiesGraphOptions): GraphBuilderResult {
  const { entities, query } = options;
  if (!entities || entities.length === 0) return buildEmptyGraph(TAB_LABELS.entities);

  const builder = createGraphBuilder('TB');
  const rootId = 'entities_root';
  builder.addNode(rootId, `实体卡 (${entities.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('实体卡', `共 ${entities.length} 个实体`));

  // 按类型分组
  const groups = new Map<string, NarrativeEntityCard[]>();
  for (const e of entities) {
    const key = e.entityType || 'other';
    const arr = groups.get(key) || [];
    arr.push(e);
    groups.set(key, arr);
  }

  const typeLabels: Record<string, string> = {
    character: '角色',
    location: '地点',
    faction: '阵营',
    item: '物品',
    ability: '能力',
    other: '其他',
  };

  for (const [type, items] of groups) {
    const groupId = `entity_group_${type}`;
    builder.addNode(groupId, `${typeLabels[type] || type} (${items.length})`, 'rounded', 'groupNode');
    builder.addEdge(rootId, groupId);

    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      const nodeId = `ent_${type}_${i}`;
      const label = `${truncateText(e.name, 30)}`;

      builder.addNode(nodeId, label, 'rounded', 'entityCard',
        createNodeDetail(e.name, [
          { label: 'ID', value: e.id },
          { label: '类型', value: typeLabels[e.entityType] || e.entityType },
          { label: '别名', value: Array.isArray(e.aliases) ? e.aliases.join(', ') : '' },
          { label: '当前状态', value: Array.isArray(e.currentStatus) ? e.currentStatus.join(', ') : '' },
          { label: '稳定事实', value: truncateText(Array.isArray(e.stableFacts) ? e.stableFacts.join('; ') : '', 120) },
          { label: '当前立场', value: e.currentStance },
          { label: '从属关系', value: Array.isArray(e.affiliations) ? e.affiliations.join(', ') : '' },
          { label: '关联线程', value: Array.isArray(e.relatedThreads) ? e.relatedThreads.join(', ') : '' },
          { label: '关联事件', value: Array.isArray(e.relatedEvents) ? e.relatedEvents.join(', ') : '' },
          { label: '来源范围', value: formatRange(e.sourceStartIndex, e.sourceEndIndex) },
          { label: '创建时间', value: formatShortDateTime(e.createdAt) },
          { label: '更新时间', value: formatShortDateTime(e.updatedAt) },
        ]));
      builder.addEdge(groupId, nodeId);

      // 关联线程
      if (e.relatedThreads?.length) {
        addCollectionNodes(builder, nodeId, e.relatedThreads, `${nodeId}_thread`, 3, '线程');
      }

      // 关联事件
      if (e.relatedEvents?.length) {
        addCollectionNodes(builder, nodeId, e.relatedEvents, `${nodeId}_event`, 3, '事件');
      }
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 归档图谱 ───

interface ArchivesGraphOptions {
  archives: NarrativeArchiveCard[];
  query?: string;
}

function buildArchivesGraph(options: ArchivesGraphOptions): GraphBuilderResult {
  const { archives, query } = options;
  if (!archives || archives.length === 0) return buildEmptyGraph(TAB_LABELS.archives);

  const builder = createGraphBuilder('TB');
  const rootId = 'archives_root';
  builder.addNode(rootId, `归档卡 (${archives.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('归档卡', `共 ${archives.length} 个归档`));

  for (let i = 0; i < archives.length; i++) {
    const a = archives[i];
    const nodeId = `archive_${i}`;
    const label = truncateText(a.title || a.arcTitle || a.id, 40);

    builder.addNode(nodeId, label, 'rounded', 'archiveCard',
      createNodeDetail(a.title || a.id, [
        { label: 'ID', value: a.id },
        { label: '篇章标题', value: a.arcTitle },
        { label: '摘要', value: truncateText(a.summary, 120) },
        { label: '时间跨度', value: a.timeSpan },
        { label: '关键词', value: Array.isArray(a.keywords) ? a.keywords.join(', ') : '' },
        { label: '关联实体', value: Array.isArray(a.entityRefs) ? a.entityRefs.join(', ') : '' },
        { label: '来源范围', value: formatRange(a.sourceStartIndex, a.sourceEndIndex) },
        { label: '创建时间', value: formatShortDateTime(a.createdAt) },
        { label: '归档时间', value: formatShortDateTime(a.archivedAt) },
      ]));
    builder.addEdge(rootId, nodeId);

    // 关键词
    if (a.keywords?.length) {
      addCollectionNodes(builder, nodeId, a.keywords, `archive_${i}_kw`, 5, '标签');
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 向量记忆图谱 ───

interface VectorGraphOptions {
  vectorMemories: VectorFact[];
  query?: string;
}

function buildVectorGraph(options: VectorGraphOptions): GraphBuilderResult {
  const { vectorMemories, query } = options;
  if (!vectorMemories || vectorMemories.length === 0) return buildEmptyGraph(TAB_LABELS.vector);

  const builder = createGraphBuilder('TB');
  const rootId = 'vector_root';
  builder.addNode(rootId, `向量记忆 (${vectorMemories.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('向量记忆', `共 ${vectorMemories.length} 条事实`));

  // 按 primaryType 分组
  const groups = new Map<string, VectorFact[]>();
  for (const v of vectorMemories) {
    const key = v.primaryType || 'other';
    const arr = groups.get(key) || [];
    arr.push(v);
    groups.set(key, arr);
  }

  const typeLabels: Record<string, string> = {
    task: '任务',
    character: '角色',
    relationship: '关系',
    location: '地点',
    faction: '阵营',
    event: '事件',
    clue: '线索',
    item: '物品',
    ability: '能力',
    status: '状态',
    rule: '规则',
    world: '世界',
    other: '其他',
  };

  for (const [type, items] of groups) {
    const groupId = `vec_group_${type}`;
    builder.addNode(groupId, `${typeLabels[type] || type} (${items.length})`, 'rounded', 'groupNode');
    builder.addEdge(rootId, groupId);

    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      const nodeId = `vec_${type}_${i}`;
      const title = v.title || truncateText(v.fact, 30);
      const importanceBar = '★'.repeat(Math.min(Math.round(v.importance), 5));
      const label = `${importanceBar} ${truncateText(title, 36)}`;

      builder.addNode(nodeId, label, 'rounded', `vec_${v.state}`,
        createNodeDetail(title, [
          { label: '事实', value: truncateText(v.fact, 120) },
          { label: '标题', value: v.title || '' },
          { label: '摘要', value: truncateText(v.summary || '', 80) },
          { label: '主类型', value: typeLabels[v.primaryType] || v.primaryType },
          { label: '副类型', value: Array.isArray(v.secondaryTypes) ? v.secondaryTypes.map((t) => typeLabels[t] || t).join(', ') : '' },
          { label: '关键词', value: Array.isArray(v.keywords) ? v.keywords.join(', ') : '' },
          { label: '角色', value: Array.isArray(v.characters) ? v.characters.join(', ') : '' },
          { label: '地点', value: Array.isArray(v.locations) ? v.locations.join(', ') : '' },
          { label: '阵营', value: Array.isArray(v.factions) ? v.factions.join(', ') : '' },
          { label: '物品', value: Array.isArray(v.items) ? v.items.join(', ') : '' },
          { label: '能力', value: Array.isArray(v.abilities) ? v.abilities.join(', ') : '' },
          { label: '事件', value: Array.isArray(v.events) ? v.events.join(', ') : '' },
          { label: '规则', value: Array.isArray(v.rules) ? v.rules.join(', ') : '' },
          { label: '时间标记', value: Array.isArray(v.timeMarkers) ? v.timeMarkers.join(', ') : '' },
          { label: '重要度', value: `${v.importance}/5` },
          { label: '时间范围', value: v.timeScope },
          { label: '状态', value: v.state },
          { label: '来源范围', value: formatRange(v.sourceStartIndex ?? null, v.sourceEndIndex ?? null) },
        ]));
      builder.addEdge(groupId, nodeId);
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 摘要历史图谱 ───

interface SummaryGraphOptions {
  summaryHistory: SummarySaveRecord[];
  lastRetrievePlan: RetrievePlanSnapshot | null;
  query?: string;
}

function buildSummaryGraph(options: SummaryGraphOptions): GraphBuilderResult {
  const { summaryHistory, lastRetrievePlan, query } = options;
  if ((!summaryHistory || summaryHistory.length === 0) && !lastRetrievePlan) {
    return buildEmptyGraph(TAB_LABELS.summary);
  }

  const builder = createGraphBuilder('TB');
  const rootId = 'summary_root';
  builder.addNode(rootId, '摘要与检索', 'stadium', 'rootNode',
    buildInfoNodeDetail('摘要与检索', `保存历史: ${summaryHistory?.length || 0} 次`));

  // 保存历史
  if (summaryHistory?.length) {
    const historyId = 'summary_history';
    builder.addNode(historyId, `保存历史 (${summaryHistory.length})`, 'rounded', 'groupNode');
    builder.addEdge(rootId, historyId);

    // 只显示最近几条
    const recent = takeItems(summaryHistory, 8);
    for (let i = 0; i < recent.length; i++) {
      const s = recent[i];
      const nodeId = `summary_save_${i}`;
      const statusIcon = s.status === 'success' ? '[OK]' : '[ERR]';
      const timeStr = formatShortDateTime(s.savedAt);
      const counts = s.applyResult;
      const label = `${statusIcon} ${timeStr} (${counts.otherCharacterCount + counts.playerCount + counts.itemCount}条)`;

      builder.addNode(nodeId, label, 'rounded', `summary_${s.status}`,
        createNodeDetail(`摘要保存 ${timeStr}`, [
          { label: '状态', value: s.status === 'success' ? '成功' : '失败' },
          { label: '保存时间', value: formatShortDateTime(s.savedAt) },
          { label: '来源范围', value: formatRange(s.sourceStartIndex, s.sourceEndIndex) },
          { label: '角色记忆', value: String(counts.otherCharacterCount) },
          { label: '玩家记忆', value: String(counts.playerCount) },
          { label: '物品记忆', value: String(counts.itemCount) },
          ...(counts.eventCount != null ? [{ label: '事件记忆', value: String(counts.eventCount) }] : []),
          ...(counts.archiveCount != null ? [{ label: '归档记忆', value: String(counts.archiveCount) }] : []),
          ...(counts.vectorCount != null ? [{ label: '向量记忆', value: String(counts.vectorCount) }] : []),
        ]));
      builder.addEdge(historyId, nodeId);
    }

    if (summaryHistory.length > 8) {
      builder.addNode('summary_more', `+${summaryHistory.length - 8} 更多...`, 'rounded', '');
      builder.addEdge(historyId, 'summary_more');
    }
  }

  // 最近检索计划
  if (lastRetrievePlan) {
    const planId = 'retrieve_plan';
    builder.addNode(planId, '最近检索计划', 'rounded', 'planNode',
      createNodeDetail('检索计划', [
        { label: '时间', value: formatShortDateTime(lastRetrievePlan.plannedAt) },
        { label: '策略', value: lastRetrievePlan.strategy },
        { label: '候选数', value: String(lastRetrievePlan.candidates?.length || 0) },
        { label: '已选标题', value: Array.isArray(lastRetrievePlan.selectedTitles) ? lastRetrievePlan.selectedTitles.join(', ') : '' },
        { label: '检索模式', value: Array.isArray(lastRetrievePlan.selectedModes) ? lastRetrievePlan.selectedModes.join(', ') : '' },
      ]));
    builder.addEdge(rootId, planId);

    // 候选项
    if (lastRetrievePlan.candidates?.length) {
      const cands = takeItems(lastRetrievePlan.candidates, 6);
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        const candId = `plan_cand_${i}`;
        builder.addNode(candId, truncateText(c.title, 36), 'rounded', 'candidateNode',
          createFallbackNodeDetail(c.title, c.source || ''));
        builder.addEdge(planId, candId, c.source);
      }
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 变更日志图谱 ───

interface MutationsGraphOptions {
  mutations: NarrativeMutation[];
  query?: string;
}

function buildMutationsGraph(options: MutationsGraphOptions): GraphBuilderResult {
  const { mutations, query } = options;
  if (!mutations || mutations.length === 0) return buildEmptyGraph(TAB_LABELS.mutations);

  const builder = createGraphBuilder('TB');
  const rootId = 'mutations_root';
  builder.addNode(rootId, `变更记录 (${mutations.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('变更记录', `共 ${mutations.length} 条变更`));

  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    const nodeId = `mutation_${i}`;
    const timeStr = formatShortDateTime(m.createdAt);
    const label = `${m.type} - ${timeStr} (应用${m.appliedCount}条)`;

    builder.addNode(nodeId, label, 'rounded', 'mutationNode',
      createNodeDetail(`变更 ${m.type}`, [
        { label: '类型', value: m.type },
        { label: '时间', value: timeStr },
        { label: '来源范围', value: formatRange(m.sourceStartIndex, m.sourceEndIndex) },
        { label: '应用数量', value: String(m.appliedCount) },
        { label: '最后游标', value: String(m.lastIngestCursor) },
      ]));
    builder.addEdge(rootId, nodeId);
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 检查点图谱 ───

interface CheckpointsGraphOptions {
  checkpoints: NarrativeCheckpoint[];
  query?: string;
}

function buildCheckpointsGraph(options: CheckpointsGraphOptions): GraphBuilderResult {
  const { checkpoints, query } = options;
  if (!checkpoints || checkpoints.length === 0) return buildEmptyGraph(TAB_LABELS.checkpoints);

  const builder = createGraphBuilder('TB');
  const rootId = 'checkpoints_root';
  builder.addNode(rootId, `检查点 (${checkpoints.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('检查点', `共 ${checkpoints.length} 个检查点`));

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const nodeId = `checkpoint_${i}`;
    const timeStr = formatShortDateTime(cp.createdAt);
    const label = `${cp.id} - ${timeStr}`;

    builder.addNode(nodeId, label, 'rounded', 'checkpointNode',
      createNodeDetail(`检查点 ${cp.id}`, [
        { label: 'ID', value: cp.id },
        { label: '创建时间', value: timeStr },
        { label: '最后游标', value: String(cp.lastIngestCursor) },
        { label: '活跃线程', value: String(cp.activeThreadCount) },
        { label: '事件数', value: String(cp.eventCount) },
        { label: '实体数', value: String(cp.entityCount) },
      ]));
    builder.addEdge(rootId, nodeId);

    // 快照信息（如果有）
    if (cp.snapshot) {
      const snapId = `checkpoint_${i}_snap`;
      builder.addNode(snapId, '快照数据', 'subroutine', 'snapshotNode',
        createNodeDetail('检查点快照', [
          { label: '版本', value: cp.snapshot.version },
          { label: '银行ID', value: cp.snapshot.bankId },
          { label: '线程数', value: String(cp.snapshot.activeThreads?.length || 0) },
          { label: '状态槽', value: String(cp.snapshot.stateSlots?.length || 0) },
          { label: '事件卡', value: String(cp.snapshot.eventCards?.length || 0) },
          { label: '实体卡', value: String(cp.snapshot.entityCards?.length || 0) },
        ]));
      builder.addEdge(nodeId, snapId, '含快照');
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ─── 调试日志图谱 ───

interface LogsGraphOptions {
  writeLogs: DebugLog[];
  retrieveLogs: DebugLog[];
  compileLogs: DebugLog[];
  query?: string;
}

function buildLogsGraph(options: LogsGraphOptions): GraphBuilderResult {
  const { writeLogs, retrieveLogs, compileLogs, query } = options;
  const allLogs = [
    ...(writeLogs || []).map((l) => ({ ...l, _category: 'write' as const })),
    ...(retrieveLogs || []).map((l) => ({ ...l, _category: 'retrieve' as const })),
    ...(compileLogs || []).map((l) => ({ ...l, _category: 'compile' as const })),
  ];

  if (allLogs.length === 0) return buildEmptyGraph(TAB_LABELS.logs);

  const builder = createGraphBuilder('TB');
  const rootId = 'logs_root';
  builder.addNode(rootId, `调试日志 (${allLogs.length})`, 'stadium', 'rootNode',
    buildInfoNodeDetail('调试日志', `写入: ${writeLogs?.length || 0} | 检索: ${retrieveLogs?.length || 0} | 编译: ${compileLogs?.length || 0}`));

  const categoryLabels: Record<string, string> = {
    write: '写入日志',
    retrieve: '检索日志',
    compile: '编译日志',
  };

  // 按类别分组
  const categories = ['write', 'retrieve', 'compile'] as const;
  for (const cat of categories) {
    const catLogs = allLogs.filter((l) => l._category === cat);
    if (catLogs.length === 0) continue;

    const groupId = `logs_${cat}`;
    builder.addNode(groupId, `${categoryLabels[cat]} (${catLogs.length})`, 'rounded', 'groupNode');
    builder.addEdge(rootId, groupId);

    // 最近 N 条
    const recent = takeItems(catLogs, 10);
    for (let i = 0; i < recent.length; i++) {
      const log = recent[i];
      const nodeId = `log_${cat}_${i}`;
      const timeStr = formatShortDateTime(log.timestamp);
      const kindLabel = log.kind || 'unknown';
      const label = `${kindLabel} ${timeStr ? `(${timeStr})` : ''}`;

      builder.addNode(nodeId, truncateText(label, 48), 'rounded', 'logNode',
        createNodeDetail(`日志: ${kindLabel}`, [
          { label: '类别', value: categoryLabels[cat] },
          { label: '类型', value: log.kind },
          { label: '模式', value: log.mode || '' },
          { label: '消息', value: truncateText(log.message || '', 120) },
          { label: '来源范围', value: formatRange(log.sourceStartIndex ?? null, log.sourceEndIndex ?? null) },
          { label: '应用数量', value: log.appliedCount != null ? String(log.appliedCount) : '' },
          { label: '丢弃原因', value: Array.isArray(log.dropReasons) ? log.dropReasons.join(', ') : '' },
          { label: '时间', value: timeStr },
        ]));
      builder.addEdge(groupId, nodeId);
    }

    if (catLogs.length > 10) {
      const moreId = `log_${cat}_more`;
      builder.addNode(moreId, `+${catLogs.length - 10} 更多...`, 'rounded', '');
      builder.addEdge(groupId, moreId);
    }
  }

  if (query) attachQueryNode(builder, rootId, query);

  return builder.getResult();
}

// ============================================================
//  选项接口
// ============================================================

export interface GraphPayloadOptions {
  tabKey: string;
  query?: string;
  sceneAnchor?: SceneAnchor | null;
  threads?: NarrativeThread[];
  states?: NarrativeStateSlot[];
  relations?: NarrativeRelationEdge[];
  relationNetwork?: NarrativeRelationNetworkItem[];
  events?: NarrativeEventCard[];
  entities?: NarrativeEntityCard[];
  archives?: NarrativeArchiveCard[];
  vectorMemories?: VectorFact[];
  summaryHistory?: SummarySaveRecord[];
  lastRetrievePlan?: RetrievePlanSnapshot | null;
  mutations?: NarrativeMutation[];
  checkpoints?: NarrativeCheckpoint[];
  writeLogs?: DebugLog[];
  retrieveLogs?: DebugLog[];
  compileLogs?: DebugLog[];
  runtime?: NarrativeMemoryRuntime | null;
}

// ============================================================
//  主函数：生成图谱负载
// ============================================================

export function buildMemoryRuntimeGraphPayload(
  options: GraphPayloadOptions,
): { definition: string; nodeDetails: Record<string, unknown> } {
  const { tabKey, query } = options;

  switch (tabKey) {
    case 'scene':
      return buildSceneGraph({
        sceneAnchor: options.sceneAnchor ?? null,
        query,
      });

    case 'threads':
      return buildThreadsGraph({
        threads: options.threads ?? [],
        query,
      });

    case 'states':
      return buildStatesGraph({
        states: options.states ?? [],
        query,
      });

    case 'relations':
      return buildRelationsGraph({
        relations: options.relations ?? [],
        query,
      });

    case 'relationNetwork':
      return buildRelationNetworkGraph({
        relationNetwork: options.relationNetwork ?? [],
        query,
      });

    case 'events':
      return buildEventsGraph({
        events: options.events ?? [],
        query,
      });

    case 'entities':
      return buildEntitiesGraph({
        entities: options.entities ?? [],
        query,
      });

    case 'archives':
      return buildArchivesGraph({
        archives: options.archives ?? [],
        query,
      });

    case 'vector':
      return buildVectorGraph({
        vectorMemories: options.vectorMemories ?? [],
        query,
      });

    case 'summary':
      return buildSummaryGraph({
        summaryHistory: options.summaryHistory ?? [],
        lastRetrievePlan: options.lastRetrievePlan ?? null,
        query,
      });

    case 'mutations':
      return buildMutationsGraph({
        mutations: options.mutations ?? [],
        query,
      });

    case 'checkpoints':
      return buildCheckpointsGraph({
        checkpoints: options.checkpoints ?? [],
        query,
      });

    case 'logs':
      return buildLogsGraph({
        writeLogs: options.writeLogs ?? [],
        retrieveLogs: options.retrieveLogs ?? [],
        compileLogs: options.compileLogs ?? [],
        query,
      });

    default: {
      // 未知 tab，返回空图
      const fallbackLabel = TAB_LABELS[tabKey] || tabKey;
      return buildEmptyGraph(fallbackLabel);
    }
  }
}

// ============================================================
//  便捷包装：仅返回 definition 字符串
// ============================================================

export function buildMemoryRuntimeMermaidGraph(options: GraphPayloadOptions): string {
  return buildMemoryRuntimeGraphPayload(options).definition;
}
