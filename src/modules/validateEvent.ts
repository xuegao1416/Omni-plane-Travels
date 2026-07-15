// ============================================================
//  Mod 校验
//  - validateRuleGraph：连通性 / 循环（带 nodeId，便于 UI 点跳）
//
//  注：原 validateSimulationRules（引用完整性 / 护栏白名单）仅服务于已移除的
//  WorldDynamics.periodicEvents，随周期事件迁入事件系统一并删除，避免残留。
// ============================================================
import type { EventGraph, ValidationIssue } from './schema';

/** Tarjan 强连通分量（用于环检测），图规模小，递归实现 */
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

/** 图结构校验：未知引用 / 孤立效果 / 普通触发环（Periodic 自环除外） */
export function validateRuleGraph(graph: EventGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  for (const e of graph.edges) {
    if (!ids.has(e.source)) {
      issues.push({ code: 'EDGE_UNKNOWN_SOURCE', field: 'edges', message: `边 ${e.id} 引用了不存在的源节点 ${e.source}`, nodeId: e.source });
    }
    if (!ids.has(e.target)) {
      issues.push({ code: 'EDGE_UNKNOWN_TARGET', field: 'edges', message: `边 ${e.id} 引用了不存在的目标节点 ${e.target}`, nodeId: e.target });
    }
  }

  const incoming = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    incoming.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (e.kind === 'constraint') continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  // 孤立效果：无上游触发器
  for (const n of graph.nodes) {
    if (n.kind === 'effect' && (incoming.get(n.id) ?? 0) === 0) {
      issues.push({
        code: 'ISOLATED_EFFECT',
        nodeId: n.id,
        field: `nodes.${n.id}`,
        message: `效果节点「${n.label}」没有上游触发器，不会被触发`,
      });
    }
  }

  // 自环：禁止（任何节点自环都可能死循环）
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

  // 触发环（SCC size>1 一律禁止，以防死循环）
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

