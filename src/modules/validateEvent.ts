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

