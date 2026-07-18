// ============================================================
//  规则图转换（React Flow 节点图 ↔ EventRule DSL / RuleFile）
//  核心职责：
//    graphToRuleFile  — 从 trigger/periodic 出发，沿 flow 边 BFS，
//                       沿途收集 condition 节点构建 when 条件树，
//                       到达 effect/event/worldState 收集 then 动作。
//    ruleFileToGraph  — 反向：把 EventRule.when 条件树拆解成
//                       trigger→condition 节点链，then 拆成 effect 节点。
//    graphToSimulationRules / simulationRulesToGraph — 世界演化专用，保持不变。
// ============================================================
import type {
  EventGraph,
  EventGraphNode,
  EventGraphEdge,
  EventRule,
  PeriodicRule,
  RuleFile,
  WorldDynamicsConfig,
  WorldStateRule,
  NarrativeGuardrails,
  Action,
  Condition,
  ModuleEffects,
} from './schema';

function defaultGuardrails(): NarrativeGuardrails {
  return {
    maxDeltaPerStat: {},
    maxDeltaPerResource: {},
    setAllowedVars: [],
    allowCreateResources: false,
  };
}

/**
 * 将旧版 ModuleEffects 转换为统一的 Action[] 格式。
 * 用于迁移旧数据（PeriodicRule.effects → actions）。
 */
export function moduleEffectsToActions(effects: ModuleEffects): Action[] {
  const actions: Action[] = [];

  // 生存资源 delta/set
  if (effects.survival?.resources) {
    for (const [name, cfg] of Object.entries(effects.survival.resources)) {
      if (cfg.delta != null) {
        actions.push({ modifyResource: { key: name, delta: cfg.delta } });
      } else if (cfg.set != null) {
        actions.push({ set: { path: `survival.resources.${name}.amount`, value: cfg.set } });
      }
    }
  }

  // 数值属性 delta/set
  if (effects.stats?.changes) {
    for (const [name, cfg] of Object.entries(effects.stats.changes)) {
      if (cfg.delta != null) {
        actions.push({ set: { path: `stats.${name}`, value: cfg.delta } });
      } else if (cfg.set != null) {
        actions.push({ set: { path: `stats.${name}`, value: cfg.set } });
      }
    }
  }

  // 经营资金
  if (effects.business?.fundsDelta != null) {
    actions.push({ set: { path: 'business.funds', value: effects.business.fundsDelta } });
  }

  // 成长经验
  if (effects.progression?.xpDelta != null) {
    actions.push({ set: { path: 'progression.xp', value: effects.progression.xpDelta } });
  }

  return actions;
}

/** 构建正向邻接表（只含 flow 边，排除 constraint 边） */
function buildAdjacency(nodes: EventGraphNode[], edges: EventGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (e.kind === 'constraint') continue;
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  }
  return adj;
}

/** 构建反向邻接表（target→source，用于收集入边条件） */
function buildReverseAdjacency(nodes: EventGraphNode[], edges: EventGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (e.kind === 'constraint') continue;
    if (adj.has(e.target)) adj.get(e.target)!.push(e.source);
  }
  return adj;
}

/** BFS：从 sourceId 出发，沿 flow 边收集所有可达节点 */
function reachableNodes(
  sourceId: string,
  adj: Map<string, string[]>,
  byId: Map<string, EventGraphNode>,
): EventGraphNode[] {
  const seen = new Set<string>([sourceId]);
  const queue = [...(adj.get(sourceId) ?? [])];
  const out: EventGraphNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) out.push(node);
    for (const nxt of adj.get(id) ?? []) if (!seen.has(nxt)) queue.push(nxt);
  }
  return out;
}

// ─── 条件树递归构建（核心算法） ───

/**
 * 递归构建 condition 节点的条件树。
 * 从 condition 节点出发，沿反向边收集上游入边条件，
 * 按 logicMode 组合（and/or/not），再与节点自身的 when 做 AND。
 */
function buildConditionFromNode(
  nodeId: string,
  byId: Map<string, EventGraphNode>,
  revAdj: Map<string, string[]>,
  adj: Map<string, string[]>,
  visited: Set<string> = new Set(),
): Condition {
  if (visited.has(nodeId)) return { all: [] }; // 防环
  visited.add(nodeId);

  const node = byId.get(nodeId);
  if (!node) return { all: [] };

  // 源节点（trigger/periodic）：返回自身 when
  if (node.kind === 'trigger' || node.kind === 'periodic') {
    return node.when ?? { all: [] };
  }

  // condition 节点：收集上游入边条件，按 logicMode 组合
  if (node.kind === 'condition') {
    const incomingSources = revAdj.get(nodeId) ?? [];
    const upstreamConditions = incomingSources
      .filter(srcId => {
        // 只收集 trigger/periodic/condition 上游（effect/event/worldState 不产出条件）
        const src = byId.get(srcId);
        return src && (src.kind === 'trigger' || src.kind === 'periodic' || src.kind === 'condition');
      })
      .map(srcId => buildConditionFromNode(srcId, byId, revAdj, adj, new Set(visited)));

    // 按 logicMode 组合上游条件
    let combined: Condition | null = null;
    const mode = node.logicMode ?? 'and';

    if (upstreamConditions.length === 0) {
      combined = null; // 无上游，不产出组合条件
    } else if (upstreamConditions.length === 1) {
      combined = upstreamConditions[0];
    } else if (mode === 'or') {
      combined = { any: upstreamConditions };
    } else if (mode === 'not') {
      // NOT 只取第一个（校验层保证只有 1 条入边）
      combined = { not: upstreamConditions[0] };
    } else {
      combined = { all: upstreamConditions };
    }

    // 节点自身的 when 与入边组合结果做 AND
    const selfWhen = node.when ?? null;
    if (selfWhen && combined) {
      return { all: [selfWhen, combined] };
    } else if (selfWhen) {
      return selfWhen;
    } else if (combined) {
      return combined;
    } else {
      return { all: [] };
    }
  }

  // effect/event/worldState：不产出条件
  return { all: [] };
}

/**
 * 从 trigger 出发，构建完整的 when 条件树。
 * 找到 trigger 直接连接的 condition 节点（第一道门），递归构建。
 */
function buildTriggerWhen(
  triggerNode: EventGraphNode,
  reachable: EventGraphNode[],
  byId: Map<string, EventGraphNode>,
  revAdj: Map<string, string[]>,
  adj: Map<string, string[]>,
): Condition {
  const triggerWhen = triggerNode.when ?? { all: [] };

  // 找到 trigger 直接后继中的 condition 节点
  const directConditions = reachable.filter(n =>
    n.kind === 'condition' && (revAdj.get(n.id) ?? []).includes(triggerNode.id),
  );

  if (directConditions.length === 0) {
    // 无 condition 节点，直接用 trigger 自身的 when
    return triggerWhen;
  }

  if (directConditions.length === 1) {
    // 单路径：trigger → condition → ... → effect
    const condWhen = buildConditionFromNode(directConditions[0].id, byId, revAdj, adj);
    return { all: [triggerWhen, condWhen] };
  }

  // 多路径（trigger 直连多个 condition）：隐式 AND
  const condWhens = directConditions.map(c => buildConditionFromNode(c.id, byId, revAdj, adj));
  return { all: [triggerWhen, ...condWhens] };
}

// ─── 图 → EventRule DSL 文件（编辑器持久化 rules.json） ───
export function graphToRuleFile(graph: EventGraph): RuleFile {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(graph.nodes, graph.edges);
  const revAdj = buildReverseAdjacency(graph.nodes, graph.edges);
  const rules: EventRule[] = [];
  const periodicRules: PeriodicRule[] = [];

  for (const node of graph.nodes) {
    if (node.kind === 'trigger') {
      // 1. BFS 找所有可达节点
      const reachable = reachableNodes(node.id, adj, byId);

      // 2. 构建 when 条件树（收集路径上的 condition 节点）
      const when = buildTriggerWhen(node, reachable, byId, revAdj, adj);

      // 3. 收集 then 动作（从 effect/event/worldState 节点）
      const then: Action[] = [];
      for (const n of reachable) {
        if (n.kind === 'effect') {
          then.push(...(n.actions ?? []));
        } else if (n.kind === 'event' && n.event) {
          then.push({ addEvent: { eventId: n.event.title ?? 'custom' } });
        } else if (n.kind === 'worldState' && n.updates) {
          for (const [axis, fields] of Object.entries(n.updates)) {
            for (const [field, value] of Object.entries(fields)) {
              then.push({ set: { path: `${axis}.${field}`, value } });
            }
          }
        }
      }

      // 4. 组装 EventRule
      const rule: EventRule = { id: node.id, when, then };
      if (node.priority != null) rule.priority = node.priority;
      if (node.once != null) rule.once = node.once;
      if (node.cooldownTicks != null) rule.cooldownTicks = node.cooldownTicks;
      rules.push(rule);

    } else if (node.kind === 'periodic') {
      // 周期节点：检查是否连接了 condition→effect 链
      const reachable = reachableNodes(node.id, adj, byId);
      const hasConditionChain = reachable.some(n => n.kind === 'condition');
      const reachableEffects = reachable.filter(n => n.kind === 'effect');

      // actions 来源：优先连线 effect 节点，其次节点自身，最后旧版 effects
      const allActions: Action[] = [];

      if (reachableEffects.length > 0) {
        // 有连线 effect 节点 → 只从 effect 节点收集（避免与节点自身 actions 重复）
        for (const en of reachableEffects) {
          allActions.push(...((en as EventGraphNode).actions ?? []));
        }
      } else {
        // 无连线 effect 节点 → 从节点自身收集
        if (node.actions && node.actions.length > 0) {
          allActions.push(...node.actions);
        } else if (node.effects && Object.keys(node.effects).length > 0) {
          allActions.push(...moduleEffectsToActions(node.effects));
        }
      }

      const pr: PeriodicRule = {
        id: node.id,
        name: node.label || '周期事件',
        intervalTicks: node.intervalTicks ?? 30,
      };
      if (node.offsetTicks != null) pr.offsetTicks = node.offsetTicks;
      if (node.description != null) pr.description = node.description;
      if (node.narrateToAI != null) pr.narrateToAI = node.narrateToAI;

      if (hasConditionChain) {
        // 有条件链 → 构建 when 守卫
        const conditionNodes = reachable.filter(n => n.kind === 'condition');
        // 找到 periodic 直接后继中的 condition 节点
        const directConditions = conditionNodes.filter(c =>
          (revAdj.get(c.id) ?? []).includes(node.id),
        );
        if (directConditions.length === 1) {
          pr.when = buildConditionFromNode(directConditions[0].id, byId, revAdj, adj);
        } else if (directConditions.length > 1) {
          const condWhens = directConditions.map(c => buildConditionFromNode(c.id, byId, revAdj, adj));
          pr.when = { all: condWhens };
        }
      }

      // 统一存储为 actions
      if (allActions.length > 0) {
        pr.actions = allActions;
      }

      periodicRules.push(pr);
    }
  }

  return { version: 1, rules, periodicRules: periodicRules.length > 0 ? periodicRules : undefined };
}

// ─── Condition 树 → condition 节点链（反向转换辅助） ───

/** 判断 Condition 是否是复合条件（all/any/not） */
function isCompoundCondition(c: Condition): c is { all: Condition[] } | { any: Condition[] } | { not: Condition } {
  return 'all' in c || 'any' in c || 'not' in c;
}

/**
 * 从 Condition 树递归生成 condition 节点 + 边。
 * 返回最外层 condition 节点 id（供 trigger 连接）。
 */
function conditionToNodes(
  condition: Condition,
  prefix: string,
  nodes: EventGraphNode[],
  edges: EventGraphEdge[],
): string | null {
  if (!isCompoundCondition(condition)) {
    // 叶子条件（state/event）→ 直接返回 null，由调用方决定是否嵌入 trigger.when
    return null;
  }

  if ('not' in condition) {
    const nodeId = `${prefix}_not`;
    nodes.push({ id: nodeId, kind: 'condition', label: 'NOT', logicMode: 'not', when: undefined });
    // 递归子条件
    const childId = conditionToNodes(condition.not, nodeId, nodes, edges);
    if (childId) {
      edges.push({ id: `${childId}->${nodeId}`, source: childId, target: nodeId, kind: 'flow' });
    } else if (!isCompoundCondition(condition.not)) {
      // 叶子：直接设为节点自身的 when
      const n = nodes.find(nn => nn.id === nodeId);
      if (n) n.when = condition.not;
    }
    return nodeId;
  }

  if ('all' in condition) {
    if (condition.all.length === 0) return null;
    if (condition.all.length === 1) return conditionToNodes(condition.all[0], prefix, nodes, edges);
    const nodeId = `${prefix}_and`;
    nodes.push({ id: nodeId, kind: 'condition', label: 'AND', logicMode: 'and', when: undefined });
    for (let i = 0; i < condition.all.length; i++) {
      const childId = conditionToNodes(condition.all[i], `${nodeId}_${i}`, nodes, edges);
      if (childId) {
        edges.push({ id: `${childId}->${nodeId}`, source: childId, target: nodeId, kind: 'flow' });
      } else if (!isCompoundCondition(condition.all[i])) {
        // 多个叶子条件：第一个嵌入节点 when，其余创建子 condition 节点
        const n = nodes.find(nn => nn.id === nodeId);
        if (n && !n.when) {
          n.when = condition.all[i];
        } else {
          const leafId = `${nodeId}_leaf${i}`;
          nodes.push({ id: leafId, kind: 'condition', label: '条件', logicMode: 'and', when: condition.all[i] });
          edges.push({ id: `${leafId}->${nodeId}`, source: leafId, target: nodeId, kind: 'flow' });
        }
      }
    }
    return nodeId;
  }

  if ('any' in condition) {
    if (condition.any.length === 0) return null;
    if (condition.any.length === 1) return conditionToNodes(condition.any[0], prefix, nodes, edges);
    const nodeId = `${prefix}_or`;
    nodes.push({ id: nodeId, kind: 'condition', label: 'OR', logicMode: 'or', when: undefined });
    for (let i = 0; i < condition.any.length; i++) {
      const childId = conditionToNodes(condition.any[i], `${nodeId}_${i}`, nodes, edges);
      if (childId) {
        edges.push({ id: `${childId}->${nodeId}`, source: childId, target: nodeId, kind: 'flow' });
      } else if (!isCompoundCondition(condition.any[i])) {
        const n = nodes.find(nn => nn.id === nodeId);
        if (n && !n.when) {
          n.when = condition.any[i];
        } else {
          const leafId = `${nodeId}_leaf${i}`;
          nodes.push({ id: leafId, kind: 'condition', label: '条件', logicMode: 'or', when: condition.any[i] });
          edges.push({ id: `${leafId}->${nodeId}`, source: leafId, target: nodeId, kind: 'flow' });
        }
      }
    }
    return nodeId;
  }

  return null;
}

// ─── EventRule DSL 文件 → 图（稳定 id = rule.id） ───
export function ruleFileToGraph(file: RuleFile): EventGraph {
  const nodes: EventGraphNode[] = [];
  const edges: EventGraphEdge[] = [];

  for (const rule of file.rules) {
    const triggerId = rule.id;

    // 分析 when 结构：提取 event 类型条件（适合做 trigger）和复合条件（适合做 condition 链）
    const { eventConditions, compoundCondition } = analyzeWhen(rule.when);

    // 创建 trigger 节点（持有 event 类型的 when）
    const triggerWhen = eventConditions.length === 1
      ? eventConditions[0]
      : eventConditions.length > 1
        ? { all: eventConditions } as Condition
        : rule.when; // 没有 event 条件时，把整个 when 放 trigger 上

    nodes.push({
      id: triggerId,
      kind: 'trigger',
      label: '触发器',
      when: triggerWhen,
      priority: rule.priority,
      once: rule.once,
      cooldownTicks: rule.cooldownTicks,
    });

    // 如果有复合条件（all/any/not），拆解成 condition 节点链
    let lastNodeId = triggerId;
    if (compoundCondition) {
      const condId = conditionToNodes(compoundCondition, triggerId, nodes, edges);
      if (condId) {
        edges.push({ id: `${triggerId}->${condId}`, source: triggerId, target: condId, kind: 'flow' });
        lastNodeId = condId;
      }
    }

    // 创建 effect 节点（承载 then 动作）
    const effectId = `${rule.id}__fx`;
    nodes.push({
      id: effectId,
      kind: 'effect',
      label: '效果',
      actions: rule.then,
    });
    edges.push({ id: `${lastNodeId}->${effectId}`, source: lastNodeId, target: effectId, kind: 'flow' });
  }

  // 周期规则 → periodic 节点 + 可选 condition 链
  for (const pr of file.periodicRules ?? []) {
    // 合并旧版 effects 和新版 actions 为统一的 actions
    const nodeActions: Action[] = [];
    if (pr.actions && pr.actions.length > 0) {
      nodeActions.push(...pr.actions);
    }
    // 向后兼容：如果只有 effects 没有 actions，迁移 effects → actions
    if ((!pr.actions || pr.actions.length === 0) && pr.effects && Object.keys(pr.effects).length > 0) {
      nodeActions.push(...moduleEffectsToActions(pr.effects));
    }

    // periodic 节点自身不存 actions（actions 只放在连线的 effect 节点上，避免重复收集）
    nodes.push({
      id: pr.id,
      kind: 'periodic',
      label: pr.name || '周期事件',
      intervalTicks: pr.intervalTicks,
      offsetTicks: pr.offsetTicks,
      when: pr.when,
      description: pr.description,
      narrateToAI: pr.narrateToAI,
    });

    // 创建 effect 节点承载 actions
    if (nodeActions.length > 0) {
      const effectId = `${pr.id}__fx`;
      nodes.push({
        id: effectId,
        kind: 'effect',
        label: '效果',
        actions: nodeActions,
      });

      // 如果有 when 条件链，插入 condition 节点
      if (pr.when) {
        const condId = conditionToNodes(pr.when, pr.id, nodes, edges);
        if (condId) {
          edges.push({ id: `${pr.id}->${condId}`, source: pr.id, target: condId, kind: 'flow' });
          edges.push({ id: `${condId}->${effectId}`, source: condId, target: effectId, kind: 'flow' });
        } else {
          // 叶子条件，直接连 periodic→effect
          edges.push({ id: `${pr.id}->${effectId}`, source: pr.id, target: effectId, kind: 'flow' });
        }
      } else {
        edges.push({ id: `${pr.id}->${effectId}`, source: pr.id, target: effectId, kind: 'flow' });
      }
    }
  }

  return { nodes, edges };
}

/**
 * 分析 when 条件树，拆分出 event 类型条件和复合条件。
 * event 条件适合放在 trigger 节点上，复合条件变成 condition 节点链。
 */
function analyzeWhen(when: Condition): { eventConditions: Condition[]; compoundCondition: Condition | null } {
  const eventConditions: Condition[] = [];
  let compoundCondition: Condition | null = null;

  if ('all' in when) {
    for (const child of when.all) {
      if ('event' in child) {
        eventConditions.push(child);
      } else if (isCompoundCondition(child)) {
        // 如果已有复合条件，合并到一个 all 中
        if (compoundCondition) {
          if ('all' in compoundCondition) {
            compoundCondition = { all: [...compoundCondition.all, child] };
          } else {
            compoundCondition = { all: [compoundCondition, child] };
          }
        } else {
          compoundCondition = child;
        }
      } else {
        // state 叶子条件 → 也归入复合条件
        if (compoundCondition) {
          if ('all' in compoundCondition) {
            compoundCondition = { all: [...compoundCondition.all, child] };
          } else {
            compoundCondition = { all: [compoundCondition, child] };
          }
        } else {
          compoundCondition = child;
        }
      }
    }
  } else if ('event' in when) {
    eventConditions.push(when);
  } else {
    // 纯 state/any/not 条件 → 整体作为复合条件
    compoundCondition = when;
  }

  return { eventConditions, compoundCondition };
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
