// ============================================================
//  工作流转换器 — 新旧格式双向互转
//  WorkflowDefinition ↔ RuleFile / EventGraph
// ============================================================
import type {
  WorkflowDefinition, WorkflowConnection, NodeInstance,
} from './workflowSchema';
import type {
  EventGraph, EventGraphNode, EventGraphEdge, EventRule, PeriodicRule, RuleFile, Condition, Action,
} from './schema';

// ─── EventNodeKind → Workflow typeId 映射 ───

const KIND_TO_TYPE: Record<string, string> = {
  trigger: 'triggers.world_event',
  condition: 'conditions.and',  // 默认 and，实际由 logicMode 决定
  effect: 'actions.set_value',  // 默认 set，实际由 actions 决定
  event: 'actions.add_event',
  worldState: 'actions.set_world_state',
  guardrail: 'output.log',
  periodic: 'triggers.periodic',
};

const LOGIC_TO_TYPE: Record<string, string> = {
  and: 'conditions.and',
  or: 'conditions.or',
  not: 'conditions.not',
};

// ─── EventGraph → WorkflowDefinition ───

export function eventGraphToWorkflow(graph: EventGraph, workflowId?: string): WorkflowDefinition {
  const nodes: NodeInstance[] = [];
  const connections: WorkflowConnection[] = [];
  let connCounter = 0;

  for (const node of graph.nodes) {
    const wfNode = eventNodeToWorkflowNode(node);
    nodes.push(wfNode);
  }

  for (const edge of graph.edges) {
    if (edge.kind === 'constraint') continue; // 跳过约束边
    connections.push({
      id: `conn-${++connCounter}`,
      sourceNodeId: edge.source,
      sourceSocketKey: 'flow_out',
      targetNodeId: edge.target,
      targetSocketKey: 'flow_in',
    });
  }

  return {
    version: 1,
    id: workflowId ?? `wf-${Date.now().toString(36)}`,
    name: '导入的工作流',
    nodes,
    connections,
  };
}

function eventNodeToWorkflowNode(node: EventGraphNode): NodeInstance {
  const typeId = resolveTypeId(node);
  const widgetValues: Record<string, unknown> = {};

  // 提取 widget 值
  if (node.trigger?.eventType) widgetValues.match_type = node.trigger.eventType;
  if (node.priority != null) widgetValues.priority = node.priority;
  if (node.once != null) widgetValues.once = node.once;
  if (node.cooldownTicks != null) widgetValues.cooldown = node.cooldownTicks;
  if (node.logicMode) widgetValues.op = node.logicMode;
  if (node.when && 'state' in node.when) {
    widgetValues.path = node.when.state.path;
    widgetValues.threshold = node.when.state.value;
  }
  if (node.intervalTicks != null) widgetValues.interval = node.intervalTicks;
  if (node.offsetTicks != null) widgetValues.offset = node.offsetTicks;
  if (node.description) widgetValues.description = node.description;
  if (node.narrateToAI != null) widgetValues.narrate = node.narrateToAI;

  // effect 节点：提取第一个 action 的信息
  if (node.actions && node.actions.length > 0) {
    const first = node.actions[0];
    if ('addEvent' in first) {
      widgetValues.event_id = first.addEvent.eventId;
    } else if ('modifyResource' in first) {
      widgetValues.resource_key = first.modifyResource.key;
      widgetValues.delta = first.modifyResource.delta;
    } else if ('set' in first) {
      widgetValues.path = first.set.path;
      widgetValues.value = first.set.value;
    }
  }

  return {
    id: node.id,
    typeId,
    label: node.label,
    position: node.position ?? { x: 0, y: 0 },
    widgetValues,
  };
}

function resolveTypeId(node: EventGraphNode): string {
  if (node.kind === 'condition' && node.logicMode) {
    return LOGIC_TO_TYPE[node.logicMode] ?? 'conditions.and';
  }
  if (node.kind === 'effect' && node.actions && node.actions.length > 0) {
    const first = node.actions[0];
    if ('addEvent' in first) return 'actions.add_event';
    if ('modifyResource' in first) return 'actions.modify_resource';
    if ('scheduleTick' in first) return 'actions.schedule_tick';
    return 'actions.set_value';
  }
  return KIND_TO_TYPE[node.kind] ?? 'data.constant';
}

// ─── WorkflowDefinition → EventGraph ───

export function workflowToEventGraph(workflow: WorkflowDefinition): EventGraph {
  const nodes: EventGraphNode[] = [];
  const edges: EventGraphEdge[] = [];

  for (const wfNode of workflow.nodes) {
    const eventNode = workflowNodeToEventNode(wfNode);
    if (eventNode) nodes.push(eventNode);
  }

  for (const conn of workflow.connections) {
    edges.push({
      id: conn.id,
      source: conn.sourceNodeId,
      target: conn.targetNodeId,
      kind: 'flow',
    });
  }

  return { nodes, edges };
}

function workflowNodeToEventNode(node: NodeInstance): EventGraphNode | null {
  const wv = node.widgetValues ?? {};

  // 触发器类型 → trigger
  if (node.typeId.startsWith('triggers.')) {
    const kind = node.typeId === 'triggers.periodic' ? 'periodic' as const : 'trigger' as const;
    const result: EventGraphNode = {
      id: node.id,
      kind,
      label: node.label ?? '',
      position: node.position,
    };

    if (node.typeId === 'triggers.world_event' || node.typeId === 'triggers.state_change') {
      result.trigger = { eventType: wv.match_type as string };
      if (wv.match_type) {
        result.when = { event: { type: wv.match_type as string } };
      }
      if (wv.priority != null) result.priority = wv.priority as number;
      if (wv.once) result.once = true;
      if (wv.cooldown != null) result.cooldownTicks = wv.cooldown as number;
    }

    if (node.typeId === 'triggers.periodic') {
      result.intervalTicks = (wv.interval as number) ?? 30;
      if (wv.offset != null) result.offsetTicks = wv.offset as number;
      if (wv.description) result.description = wv.description as string;
      if (wv.narrate != null) result.narrateToAI = wv.narrate as boolean;
    }

    return result;
  }

  // 条件类型 → condition
  if (node.typeId.startsWith('conditions.')) {
    const mode = node.typeId === 'conditions.not' ? 'not' as const
      : node.typeId === 'conditions.or' ? 'or' as const
      : 'and' as const;

    const result: EventGraphNode = {
      id: node.id,
      kind: 'condition',
      label: node.label ?? (mode === 'and' ? 'AND' : mode === 'or' ? 'OR' : 'NOT'),
      position: node.position,
      logicMode: mode,
    };

    // 如果有 path/threshold widget，构建 when 条件
    if (wv.path && wv.threshold != null) {
      result.when = {
        state: { path: wv.path as string, op: (wv.op as string as Condition extends { state: infer S } ? S extends { op: infer O } ? O : never : never) ?? '>=', value: wv.threshold as number },
      };
    }

    return result;
  }

  // 动作类型 → effect
  if (node.typeId.startsWith('actions.')) {
    const actions: Action[] = [];

    if (node.typeId === 'actions.add_event' && wv.event_id) {
      actions.push({ addEvent: { eventId: wv.event_id as string } });
    } else if (node.typeId === 'actions.modify_resource') {
      actions.push({ modifyResource: { key: (wv.resource_key as string) ?? '', delta: (wv.delta as number) ?? 0 } });
    } else if (node.typeId === 'actions.schedule_tick') {
      actions.push({ scheduleTick: { after: (wv.after as number) ?? 1 } });
    } else if (wv.path) {
      actions.push({ set: { path: wv.path as string, value: (wv.value as string | number | boolean) ?? '' } });
    }

    return {
      id: node.id,
      kind: 'effect',
      label: node.label ?? '效果',
      position: node.position,
      actions,
    };
  }

  // 其他节点类型（data/flow/output）→ 跳过或转为 effect
  return null;
}

// ─── RuleFile → WorkflowDefinition ───

export function ruleFileToWorkflow(file: RuleFile, workflowId?: string): WorkflowDefinition {
  // 先转成 EventGraph，再转成 WorkflowDefinition
  const graph = ruleFileToEventGraph(file);
  return eventGraphToWorkflow(graph, workflowId);
}

function ruleFileToEventGraph(file: RuleFile): EventGraph {
  const nodes: EventGraphNode[] = [];
  const edges: EventGraphEdge[] = [];
  const positions = file.nodePositions ?? {};

  for (const rule of file.rules) {
    const triggerId = rule.id;
    const { eventConditions, compoundCondition } = analyzeWhen(rule.when);

    const triggerWhen = eventConditions.length === 1
      ? eventConditions[0]
      : eventConditions.length > 1
        ? { all: eventConditions } as Condition
        : rule.when;

    nodes.push({
      id: triggerId,
      kind: 'trigger',
      label: '触发器',
      when: triggerWhen,
      priority: rule.priority,
      once: rule.once,
      cooldownTicks: rule.cooldownTicks,
      position: positions[triggerId],
    });

    let lastNodeId = triggerId;
    if (compoundCondition) {
      const condId = conditionToNodes(compoundCondition, triggerId, nodes, edges);
      if (condId) {
        edges.push({ id: `${triggerId}->${condId}`, source: triggerId, target: condId, kind: 'flow' });
        lastNodeId = condId;
      }
    }

    const effectId = `${rule.id}__fx`;
    nodes.push({ id: effectId, kind: 'effect', label: '效果', actions: rule.then, position: positions[effectId] });
    edges.push({ id: `${lastNodeId}->${effectId}`, source: lastNodeId, target: effectId, kind: 'flow' });
  }

  for (const pr of file.periodicRules ?? []) {
    const nodeActions: Action[] = [];
    if (pr.actions && pr.actions.length > 0) nodeActions.push(...pr.actions);

    nodes.push({
      id: pr.id,
      kind: 'periodic',
      label: pr.name || '周期事件',
      intervalTicks: pr.intervalTicks,
      offsetTicks: pr.offsetTicks,
      when: pr.when,
      description: pr.description,
      narrateToAI: pr.narrateToAI,
      position: positions[pr.id],
    });

    if (nodeActions.length > 0) {
      const effectId = `${pr.id}__fx`;
      nodes.push({ id: effectId, kind: 'effect', label: '效果', actions: nodeActions, position: positions[effectId] });

      if (pr.when) {
        const condId = conditionToNodes(pr.when, pr.id, nodes, edges);
        if (condId) {
          edges.push({ id: `${pr.id}->${condId}`, source: pr.id, target: condId, kind: 'flow' });
          edges.push({ id: `${condId}->${effectId}`, source: condId, target: effectId, kind: 'flow' });
        } else {
          edges.push({ id: `${pr.id}->${effectId}`, source: pr.id, target: effectId, kind: 'flow' });
        }
      } else {
        edges.push({ id: `${pr.id}->${effectId}`, source: pr.id, target: effectId, kind: 'flow' });
      }
    }
  }

  return { nodes, edges };
}

// ─── WorkflowDefinition → RuleFile ───

export function workflowToRuleFile(workflow: WorkflowDefinition): RuleFile {
  // 找到所有触发器节点，BFS 收集下游
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const connMap = new Map<string, WorkflowConnection[]>();
  for (const conn of workflow.connections) {
    const list = connMap.get(conn.sourceNodeId) ?? [];
    list.push(conn);
    connMap.set(conn.sourceNodeId, list);
  }

  const rules: EventRule[] = [];
  const periodicRules: PeriodicRule[] = [];
  const nodePositions: Record<string, { x: number; y: number }> = {};

  // 收集所有节点位置
  for (const node of workflow.nodes) {
    nodePositions[node.id] = node.position;
  }

  for (const node of workflow.nodes) {
    if (!node.typeId.startsWith('triggers.')) continue;

    const reachable = bfs(node.id, connMap, nodeMap);
    const actions = collectActions(reachable, nodeMap);
    const when = buildWhenFromConditionNodes(node, reachable, connMap, nodeMap);

    if (node.typeId === 'triggers.periodic') {
      const pr: PeriodicRule = {
        id: node.id,
        name: node.label ?? '周期事件',
        intervalTicks: (node.widgetValues?.interval as number) ?? 30,
      };
      if (node.widgetValues?.offset) pr.offsetTicks = node.widgetValues.offset as number;
      if (node.widgetValues?.description) pr.description = node.widgetValues.description as string;
      if (node.widgetValues?.narrate != null) pr.narrateToAI = node.widgetValues.narrate as boolean;
      if (Object.keys(when).length > 0) pr.when = when;
      if (actions.length > 0) pr.actions = actions;
      periodicRules.push(pr);
    } else {
      const rule: EventRule = {
        id: node.id,
        when,
        then: actions,
      };
      if (node.widgetValues?.priority != null) rule.priority = node.widgetValues.priority as number;
      if (node.widgetValues?.once) rule.once = true;
      if (node.widgetValues?.cooldown) rule.cooldownTicks = node.widgetValues.cooldown as number;
      rules.push(rule);
    }
  }

  const result: RuleFile = { version: 1, rules };
  if (periodicRules.length > 0) result.periodicRules = periodicRules;
  if (Object.keys(nodePositions).length > 0) result.nodePositions = nodePositions;
  return result;
}

// ─── 辅助函数 ───

function bfs(
  startId: string,
  connMap: Map<string, WorkflowConnection[]>,
  nodeMap: Map<string, NodeInstance>,
): NodeInstance[] {
  const visited = new Set<string>([startId]);
  const queue = [startId];
  const result: NodeInstance[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const conn of connMap.get(id) ?? []) {
      if (visited.has(conn.targetNodeId)) continue;
      visited.add(conn.targetNodeId);
      const node = nodeMap.get(conn.targetNodeId);
      if (node) {
        result.push(node);
        queue.push(conn.targetNodeId);
      }
    }
  }
  return result;
}

function collectActions(nodes: NodeInstance[], nodeMap: Map<string, NodeInstance>): Action[] {
  const actions: Action[] = [];
  for (const node of nodes) {
    if (!node.typeId.startsWith('actions.')) continue;
    const wv = node.widgetValues ?? {};

    if (node.typeId === 'actions.add_event' && wv.event_id) {
      actions.push({ addEvent: { eventId: wv.event_id as string } });
    } else if (node.typeId === 'actions.modify_resource') {
      actions.push({ modifyResource: { key: (wv.resource_key as string) ?? '', delta: (wv.delta as number) ?? 0 } });
    } else if (node.typeId === 'actions.modify_stat') {
      actions.push({ set: { path: `stats.${wv.stat_key ?? ''}`, value: (wv.delta as number) ?? 0 } });
    } else if (node.typeId === 'actions.schedule_tick') {
      actions.push({ scheduleTick: { after: (wv.after as number) ?? 1 } });
    } else if (node.typeId === 'actions.set_value' && wv.path) {
      actions.push({ set: { path: wv.path as string, value: (wv.value as string | number | boolean) ?? '' } });
    } else if (node.typeId === 'actions.set_world_state') {
      const axis = wv.axis as string ?? '';
      const field = wv.field as string ?? '';
      const value = wv.value as string ?? '';
      if (axis && field) actions.push({ set: { path: `${axis}.${field}`, value } });
    } else if (node.typeId === 'actions.modify_currency') {
      actions.push({ modifyResource: { key: '主货币', delta: (wv.delta as number) ?? 0 } });
    }
  }
  return actions;
}

function buildWhenFromConditionNodes(
  triggerNode: NodeInstance,
  reachable: NodeInstance[],
  connMap: Map<string, WorkflowConnection[]>,
  nodeMap: Map<string, NodeInstance>,
): Condition {
  const conditions: Condition[] = [];

  // 从 trigger 的 widget 值提取条件
  const tw = triggerNode.widgetValues ?? {};
  if (tw.match_type) {
    conditions.push({ event: { type: tw.match_type as string } });
  }
  if (tw.path && tw.threshold != null) {
    conditions.push({ state: { path: tw.path as string, op: (tw.op as string as Condition extends { state: infer S } ? S extends { op: infer O } ? O : never : never) ?? '>=', value: tw.threshold as number } });
  }

  // 从条件节点提取
  for (const node of reachable) {
    if (!node.typeId.startsWith('conditions.')) continue;
    const wv = node.widgetValues ?? {};

    if (node.typeId === 'conditions.and' || node.typeId === 'conditions.or' || node.typeId === 'conditions.not') {
      // 逻辑门：从输入收集子条件
      continue; // 逻辑门的子条件通过连接传递，不直接产生 Condition
    }

    if (wv.path && wv.threshold != null) {
      conditions.push({ state: { path: wv.path as string, op: (wv.op as string as Condition extends { state: infer S } ? S extends { op: infer O } ? O : never : never) ?? '>=', value: wv.threshold as number } });
    }
  }

  if (conditions.length === 0) return { all: [] };
  if (conditions.length === 1) return conditions[0];
  return { all: conditions };
}

function isCompoundCondition(c: Condition): c is { all: Condition[] } | { any: Condition[] } | { not: Condition } {
  return 'all' in c || 'any' in c || 'not' in c;
}

function conditionToNodes(
  condition: Condition,
  prefix: string,
  nodes: EventGraphNode[],
  edges: EventGraphEdge[],
): string | null {
  if (!isCompoundCondition(condition)) return null;

  if ('not' in condition) {
    const nodeId = `${prefix}_not`;
    nodes.push({ id: nodeId, kind: 'condition', label: 'NOT', logicMode: 'not' });
    const childId = conditionToNodes(condition.not, nodeId, nodes, edges);
    if (childId) {
      edges.push({ id: `${childId}->${nodeId}`, source: childId, target: nodeId, kind: 'flow' });
    } else if (!isCompoundCondition(condition.not)) {
      const n = nodes.find((nn) => nn.id === nodeId);
      if (n) n.when = condition.not;
    }
    return nodeId;
  }

  if ('all' in condition) {
    if (condition.all.length === 0) return null;
    if (condition.all.length === 1) return conditionToNodes(condition.all[0], prefix, nodes, edges);
    const nodeId = `${prefix}_and`;
    nodes.push({ id: nodeId, kind: 'condition', label: 'AND', logicMode: 'and' });
    for (let i = 0; i < condition.all.length; i++) {
      const childId = conditionToNodes(condition.all[i], `${nodeId}_${i}`, nodes, edges);
      if (childId) {
        edges.push({ id: `${childId}->${nodeId}`, source: childId, target: nodeId, kind: 'flow' });
      } else if (!isCompoundCondition(condition.all[i])) {
        const n = nodes.find((nn) => nn.id === nodeId);
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
    nodes.push({ id: nodeId, kind: 'condition', label: 'OR', logicMode: 'or' });
    for (let i = 0; i < condition.any.length; i++) {
      const childId = conditionToNodes(condition.any[i], `${nodeId}_${i}`, nodes, edges);
      if (childId) {
        edges.push({ id: `${childId}->${nodeId}`, source: childId, target: nodeId, kind: 'flow' });
      } else if (!isCompoundCondition(condition.any[i])) {
        const n = nodes.find((nn) => nn.id === nodeId);
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

function analyzeWhen(when: Condition): { eventConditions: Condition[]; compoundCondition: Condition | null } {
  const eventConditions: Condition[] = [];
  let compoundCondition: Condition | null = null;

  if ('all' in when) {
    for (const child of when.all) {
      if ('event' in child) {
        eventConditions.push(child);
      } else if (isCompoundCondition(child)) {
        compoundCondition = compoundCondition
          ? ('all' in compoundCondition ? { all: [...compoundCondition.all, child] } : { all: [compoundCondition, child] })
          : child;
      } else {
        compoundCondition = compoundCondition
          ? ('all' in compoundCondition ? { all: [...compoundCondition.all, child] } : { all: [compoundCondition, child] })
          : child;
      }
    }
  } else if ('event' in when) {
    eventConditions.push(when);
  } else {
    compoundCondition = when;
  }

  return { eventConditions, compoundCondition };
}
