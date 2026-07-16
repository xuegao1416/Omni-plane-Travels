// ============================================================
//  Mod 校验（工作流版）
//  - validateRuleGraph：连接合法性 / 循环 / 节点角色约束
//  - 参照 rule-canvas-workflow-spec.md §5 校验规则
// ============================================================
import type { EventGraph, ValidationIssue } from './schema';

/** 源节点（只有出边，无入边） */
const SOURCE_KINDS = new Set(['trigger', 'periodic']);
/** 汇节点（只有入边，无出边） */
const SINK_KINDS = new Set(['effect', 'event', 'worldState']);
/** 可以作为 flow 边目标的节点类型 */
const VALID_FLOW_TARGETS = new Set(['condition', 'effect', 'event', 'worldState']);

/** Tarjan 强连通分量（用于环检测） */
function tarjanSCC(nodes: string[], adj: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  };

  for (const v of nodes) if (!idx.has(v)) strongconnect(v);
  return sccs;
}

/** 计算从源节点到目标节点的最长条件链深度 */
function computeConditionDepth(nodeId: string, graph: EventGraph, adj: Map<string, string[]>): number {
  const visited = new Set<string>();
  let maxDepth = 0;

  const dfs = (id: string, depth: number): void => {
    if (visited.has(id)) return;
    visited.add(id);
    maxDepth = Math.max(maxDepth, depth);

    const node = graph.nodes.find(n => n.id === id);
    const nextDepth = node?.kind === 'condition' ? depth + 1 : depth;

    for (const next of adj.get(id) ?? []) {
      dfs(next, nextDepth);
    }
  };

  dfs(nodeId, 0);
  return maxDepth;
}

/** 图结构 + 工作流校验 */
export function validateRuleGraph(graph: EventGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  // ── 边引用完整性 ──
  for (const e of graph.edges) {
    if (!ids.has(e.source)) {
      issues.push({ code: 'EDGE_UNKNOWN_SOURCE', field: 'edges', message: `边 ${e.id} 引用了不存在的源节点 ${e.source}`, nodeId: e.source });
    }
    if (!ids.has(e.target)) {
      issues.push({ code: 'EDGE_UNKNOWN_TARGET', field: 'edges', message: `边 ${e.id} 引用了不存在的目标节点 ${e.target}`, nodeId: e.target });
    }
  }

  // ── 构建入边/出边计数（仅 flow 边） ──
  const inFlowCount = new Map<string, number>();
  const outFlowCount = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    inFlowCount.set(n.id, 0);
    outFlowCount.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (e.kind === 'constraint') continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    outFlowCount.set(e.source, (outFlowCount.get(e.source) ?? 0) + 1);
    inFlowCount.set(e.target, (inFlowCount.get(e.target) ?? 0) + 1);
  }

  for (const node of graph.nodes) {
    const inCount = inFlowCount.get(node.id) ?? 0;
    const outCount = outFlowCount.get(node.id) ?? 0;

    // ── ERROR: 汇节点有出边 ──
    if (SINK_KINDS.has(node.kind) && outCount > 0) {
      issues.push({
        code: 'SINK_HAS_OUT',
        nodeId: node.id,
        field: `nodes.${node.id}`,
        message: `「${node.label}」是${node.kind === 'effect' ? '效果' : node.kind === 'event' ? '事件' : '世界状态'}节点，不应有出边`,
      });
    }

    // ── ERROR: 源节点有入边 ──
    if (SOURCE_KINDS.has(node.kind) && inCount > 0) {
      issues.push({
        code: 'SOURCE_HAS_IN',
        nodeId: node.id,
        field: `nodes.${node.id}`,
        message: `「${node.label}」是${node.kind === 'trigger' ? '触发器' : '周期'}节点，不应有入边`,
      });
    }

    // ── ERROR: NOT condition 入边 > 1 ──
    if (node.kind === 'condition' && node.logicMode === 'not' && inCount > 1) {
      issues.push({
        code: 'CONDITION_NOT_MULTI_INPUT',
        nodeId: node.id,
        field: `nodes.${node.id}`,
        message: `「${node.label}」是 NOT 门，只允许 1 条入边，当前有 ${inCount} 条`,
      });
    }

    // ── WARNING: condition 节点无入边 ──
    if (node.kind === 'condition' && inCount === 0) {
      issues.push({
        code: 'CONDITION_NO_INPUT',
        nodeId: node.id,
        field: `nodes.${node.id}`,
        message: `条件门「${node.label}」没有输入，条件为空`,
      });
    }

    // ── WARNING: condition 节点无出边 ──
    if (node.kind === 'condition' && outCount === 0) {
      issues.push({
        code: 'CONDITION_NO_OUTPUT',
        nodeId: node.id,
        field: `nodes.${node.id}`,
        message: `条件门「${node.label}」没有下游，不起作用`,
      });
    }

    // ── WARNING: 孤立效果（无上游） ──
    if (node.kind === 'effect' && inCount === 0) {
      issues.push({
        code: 'ISOLATED_EFFECT',
        nodeId: node.id,
        field: `nodes.${node.id}`,
        message: `效果节点「${node.label}」没有上游触发器，不会被触发`,
      });
    }

    // ── INFO: 触发器直连效果（无条件） ──
    if (node.kind === 'trigger' && outCount > 0) {
      const hasDirectEffect = graph.edges.some(e => e.source === node.id && e.kind !== 'constraint');
      const directEffectTarget = graph.edges
        .filter(e => e.source === node.id && e.kind !== 'constraint')
        .map(e => graph.nodes.find(n => n.id === e.target))
        .find(n => n?.kind === 'effect');
      if (directEffectTarget) {
        issues.push({
          code: 'DIRECT_TRIGGER_EFFECT',
          nodeId: node.id,
          field: `nodes.${node.id}`,
          message: `触发器「${node.label}」直连效果节点，无条件守卫（合法但建议添加条件门）`,
        });
      }
    }

    // ── INFO: 周期直连效果（无条件） ──
    if (node.kind === 'periodic' && outCount > 0) {
      const directEffectTarget = graph.edges
        .filter(e => e.source === node.id && e.kind !== 'constraint')
        .map(e => graph.nodes.find(n => n.id === e.target))
        .find(n => n?.kind === 'effect');
      if (directEffectTarget) {
        issues.push({
          code: 'DIRECT_PERIODIC_EFFECT',
          nodeId: node.id,
          field: `nodes.${node.id}`,
          message: `周期节点「${node.label}」直连效果节点，无条件守卫（每轮无条件触发）`,
        });
      }
    }

    // ── INFO: 触发器无自身条件 ──
    if (node.kind === 'trigger') {
      const hasWhen = node.when && Object.keys(node.when).length > 0;
      const hasConditionDownstream = graph.edges.some(e => {
        if (e.source !== node.id || e.kind === 'constraint') return false;
        const target = graph.nodes.find(n => n.id === e.target);
        return target?.kind === 'condition';
      });
      if (!hasWhen && !hasConditionDownstream) {
        issues.push({
          code: 'EMPTY_TRIGGER_WHEN',
          nodeId: node.id,
          field: `nodes.${node.id}`,
          message: `触发器「${node.label}」无自身条件且无条件节点下游，将无条件触发`,
        });
      }
    }

    // ── ERROR: 条件链深度超限 ──
    if (node.kind === 'condition') {
      const depth = computeConditionDepth(node.id, graph, adj);
      if (depth > 6) {
        issues.push({
          code: 'CONDITION_DEPTH_EXCEEDED',
          nodeId: node.id,
          field: `nodes.${node.id}`,
          message: `条件链深度 ${depth} 超过上限 6，可能导致性能问题`,
        });
      }
    }

    // ── WARNING: addEvent 的 eventId 为空或占位符 ──
    if ((node.kind === 'effect' || node.kind === 'periodic') && node.actions) {
      for (const action of node.actions) {
        if ('addEvent' in action && (!action.addEvent.eventId || action.addEvent.eventId.trim() === '' || action.addEvent.eventId === 'new')) {
          issues.push({
            code: 'UNKNOWN_CARD_ID',
            nodeId: node.id,
            field: `nodes.${node.id}`,
            message: `事件 ID "${action.addEvent.eventId || '(空)'}" 看起来是占位符，请在下拉中选择实际事件`,
          });
        }
      }
    }
  }

  // ── ERROR: guardrail 只能通过 constraint 边连 effect ──
  for (const e of graph.edges) {
    if (e.kind === 'constraint') {
      const target = graph.nodes.find((n) => n.id === e.target);
      if (target && target.kind !== 'effect') {
        issues.push({
          code: 'GUARDRAIL_INVALID_TARGET',
          nodeId: e.source,
          field: 'edges',
          message: `护栏只能约束效果节点，当前连到了「${target.label}」`,
        });
      }
    }
    // guardrail 用 flow 边而非 constraint 边
    const source = graph.nodes.find((n) => n.id === e.source);
    if (source?.kind === 'guardrail' && e.kind !== 'constraint') {
      issues.push({
        code: 'GUARDRAIL_MUST_USE_CONSTRAINT',
        nodeId: e.source,
        field: 'edges',
        message: `护栏「${source.label}」必须使用 constraint 边（虚线），不能用 flow 边`,
      });
    }
  }

  // ── ERROR: 自环 ──
  for (const e of graph.edges) {
    if (e.source === e.target) {
      const node = graph.nodes.find((n) => n.id === e.source);
      issues.push({
        code: 'SELF_LOOP',
        nodeId: e.source,
        message: `节点「${node?.label ?? e.source}」存在自环，可能死循环`,
      });
    }
  }

  // ── ERROR: 触发环（SCC size>1） ──
  const sccs = tarjanSCC(
    graph.nodes.map((n) => n.id),
    adj,
  );
  for (const comp of sccs) {
    if (comp.length <= 1) continue;
    for (const id of comp) {
      const node = graph.nodes.find((n) => n.id === id);
      issues.push({
        code: 'CYCLE',
        nodeId: id,
        field: `nodes.${id}`,
        message: `检测到触发环，涉及「${node?.label ?? id}」，禁止以防死循环`,
      });
    }
  }

  return issues;
}

