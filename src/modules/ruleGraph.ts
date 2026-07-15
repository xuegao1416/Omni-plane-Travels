// ============================================================
//  规则图转换（React Flow 节点图 ↔ SimulationRules / RuleFile）
//  语义对齐 UIUX §5.3 / §5.4：
//    Trigger+Effect → EventEffect
//    Effect         → WorldState（落地）
//    Guardrail      → 全局 narrativeGuardrails（约束边）
//  注：周期事件已独立为事件系统（eventWorldEvolution），规则图不再产出 periodicEvents。
//  稳定 node id = 节点 UUID，便于可视化回显与双向往返。
// ============================================================
import type {
  EventGraph,
  EventGraphNode,
  EventGraphEdge,
  EventRule,
  RuleFile,
  WorldDynamicsConfig,
  WorldStateRule,
  NarrativeGuardrails,
  Action,
} from './schema';

function defaultGuardrails(): NarrativeGuardrails {
  return {
    maxDeltaPerStat: {},
    maxDeltaPerResource: {},
    setAllowedVars: [],
    allowCreateResources: false,
  };
}

function buildAdjacency(nodes: EventGraphNode[], edges: EventGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (e.kind === 'constraint') continue;
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  }
  return adj;
}

/** 收集从 trigger 出发、沿 flow 边可达的 effect 节点（BFS） */
function reachableEffectNodes(
  triggerId: string,
  adj: Map<string, string[]>,
  byId: Map<string, EventGraphNode>,
): EventGraphNode[] {
  const seen = new Set<string>([triggerId]);
  const queue = [...(adj.get(triggerId) ?? [])];
  const out: EventGraphNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node && node.kind === 'effect') out.push(node);
    for (const nxt of adj.get(id) ?? []) if (!seen.has(nxt)) queue.push(nxt);
  }
  return out;
}

// ─── 图 → EventRule DSL 文件（编辑器持久化 rules.json） ───
export function graphToRuleFile(graph: EventGraph): RuleFile {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(graph.nodes, graph.edges);
  const rules: EventRule[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'trigger') continue;
    const effects = reachableEffectNodes(node.id, adj, byId);
    const then: Action[] = effects.flatMap((e) => e.actions ?? []);
    const rule: EventRule = {
      id: node.id,
      when: node.when ?? { all: [] },
      then,
    };
    if (node.priority != null) rule.priority = node.priority;
    if (node.once != null) rule.once = node.once;
    if (node.cooldownTicks != null) rule.cooldownTicks = node.cooldownTicks;
    rules.push(rule);
  }

  return { version: 1, rules };
}

// ─── EventRule DSL 文件 → 图（稳定 id = rule.id） ───
export function ruleFileToGraph(file: RuleFile): EventGraph {
  const nodes: EventGraphNode[] = [];
  const edges: EventGraphEdge[] = [];

  for (const rule of file.rules) {
    const triggerId = rule.id;
    nodes.push({
      id: triggerId,
      kind: 'trigger',
      label: '触发器',
      when: rule.when,
      priority: rule.priority,
      once: rule.once,
      cooldownTicks: rule.cooldownTicks,
    });
    const effectId = `${rule.id}__fx`;
    nodes.push({
      id: effectId,
      kind: 'effect',
      label: '效果',
      actions: rule.then,
    });
    edges.push({ id: `${triggerId}->${effectId}`, source: triggerId, target: effectId, kind: 'flow' });
  }

  return { nodes, edges };
}

// ─── 图 → 世界演化 SimulationRules（任务 D 映射） ───
export function graphToSimulationRules(graph: EventGraph): WorldDynamicsConfig {
  const worldStateRules: WorldStateRule[] = [];
  const guardrails = defaultGuardrails();

  for (const node of graph.nodes) {
    if (node.kind === 'worldState') {
      worldStateRules.push({
        id: node.id,
        trigger: { tags: node.trigger?.tags, eventType: node.trigger?.eventType, keywords: node.trigger?.keywords },
        updates: node.updates ?? {},
      });
    } else if (node.kind === 'guardrail') {
      if (node.guardrail?.maxDeltaPerStat) Object.assign(guardrails.maxDeltaPerStat, node.guardrail.maxDeltaPerStat);
      if (node.guardrail?.maxDeltaPerResource)
        Object.assign(guardrails.maxDeltaPerResource, node.guardrail.maxDeltaPerResource);
      if (node.guardrail?.setAllowedVars) guardrails.setAllowedVars.push(...node.guardrail.setAllowedVars);
      if (node.guardrail?.allowCreateResources) guardrails.allowCreateResources = true;
      if (node.guardrail?.newResourceDefaultMax != null)
        guardrails.newResourceDefaultMax = node.guardrail.newResourceDefaultMax;
    }
    // trigger / condition / effect / event / periodic 节点不产出世界演化配置
    // （周期事件已独立为事件系统，trigger.intervalTicks 仅作可视化节奏提示）
  }

  return {
    worldStateRules,
    narrativeGuardrails: guardrails,
  };
}

// ─── 世界演化 SimulationRules → 图（导入 / 回显） ───
export function simulationRulesToGraph(rules: WorldDynamicsConfig): EventGraph {
  const nodes: EventGraphNode[] = [];
  const edges: EventGraphEdge[] = [];

  // 注：eventEffects 已从世界演化内核移除（事件触发由事件包系统负责），
  // 故此处不再将 eventEffects 反序列化为图节点。

  for (const ws of rules.worldStateRules) {
    nodes.push({
      id: ws.id,
      kind: 'worldState',
      label: '世界状态',
      trigger: { tags: ws.trigger.tags, eventType: ws.trigger.eventType, keywords: ws.trigger.keywords },
      updates: ws.updates,
    });
  }

  const g = rules.narrativeGuardrails;
  if (g && (Object.keys(g.maxDeltaPerStat).length || Object.keys(g.maxDeltaPerResource).length || g.setAllowedVars.length)) {
    nodes.push({
      id: 'narrative-guardrails',
      kind: 'guardrail',
      label: '叙事护栏',
      guardrail: {
        maxDeltaPerStat: g.maxDeltaPerStat,
        maxDeltaPerResource: g.maxDeltaPerResource,
        setAllowedVars: g.setAllowedVars,
        allowCreateResources: g.allowCreateResources,
        newResourceDefaultMax: g.newResourceDefaultMax,
      },
    });
  }

  return { nodes, edges };
}
