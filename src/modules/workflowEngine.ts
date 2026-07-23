// ============================================================
//  工作流执行引擎 — DAG 拓扑排序 + 逐节点求值
// ============================================================
import type {
  WorkflowDefinition, WorkflowExecutionContext, WorkflowExecutionResult,
  NodeInstance, WorkflowConnection, PendingAction, EvaluateLimits,
  NodeExecutorContext, NodeExecutorResult,
} from './workflowSchema';
import { DEFAULT_LIMITS } from './workflowSchema';
import { getNodeDefinition, getNodeExecutor } from './nodeRegistry';

// ─── NodeOutputCache（基于 hash 的简单缓存） ───

class NodeOutputCache {
  private cache = new Map<string, Record<string, unknown>>();

  computeKey(typeId: string, inputs: Record<string, unknown>): string {
    return `${typeId}:${JSON.stringify(inputs)}`;
  }

  get(key: string): Record<string, unknown> | undefined {
    return this.cache.get(key);
  }

  set(key: string, outputs: Record<string, unknown>): void {
    this.cache.set(key, outputs);
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─── 主执行函数 ───

export function executeWorkflow(
  workflow: WorkflowDefinition,
  ctx: WorkflowExecutionContext,
): WorkflowExecutionResult {
  const limits: EvaluateLimits = { ...DEFAULT_LIMITS, ...ctx.limits };
  const startTime = performance.now();

  // 1. 安全限制检查
  if (workflow.nodes.length > limits.maxNodes) {
    return failResult(`节点数 ${workflow.nodes.length} 超过上限 ${limits.maxNodes}`);
  }
  if (workflow.connections.length > limits.maxConnections) {
    return failResult(`连接数 ${workflow.connections.length} 超过上限 ${limits.maxConnections}`);
  }

  // 2. 构建邻接表
  const adj = new Map<string, Array<{ target: string; sourceSocket: string; targetSocket: string }>>();
  const revAdj = new Map<string, Array<{ source: string; sourceSocket: string; targetSocket: string }>>();
  const nodeMap = new Map<string, NodeInstance>();

  for (const node of workflow.nodes) {
    nodeMap.set(node.id, node);
    adj.set(node.id, []);
    revAdj.set(node.id, []);
  }

  for (const conn of workflow.connections) {
    if (!nodeMap.has(conn.sourceNodeId) || !nodeMap.has(conn.targetNodeId)) continue;
    adj.get(conn.sourceNodeId)!.push({
      target: conn.targetNodeId,
      sourceSocket: conn.sourceSocketKey,
      targetSocket: conn.targetSocketKey,
    });
    revAdj.get(conn.targetNodeId)!.push({
      source: conn.sourceNodeId,
      sourceSocket: conn.sourceSocketKey,
      targetSocket: conn.targetSocketKey,
    });
  }

  // 3. 拓扑排序（Kahn 算法）
  const inDegree = new Map<string, number>();
  for (const node of workflow.nodes) {
    inDegree.set(node.id, (revAdj.get(node.id) ?? []).length);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const edge of adj.get(id) ?? []) {
      const deg = inDegree.get(edge.target)! - 1;
      inDegree.set(edge.target, deg);
      if (deg === 0) queue.push(edge.target);
    }
  }

  // 环检测
  if (sorted.length !== workflow.nodes.length) {
    return failResult('检测到循环依赖，工作流无法执行');
  }

  // 4. 逐节点执行
  const nodeOutputs = new Map<string, Record<string, unknown>>();
  const allActions: PendingAction[] = [];
  const warnings: string[] = [];
  const cache = new NodeOutputCache();
  let executedCount = 0;

  const execCtx: NodeExecutorContext = {
    tick: ctx.tick,
    events: ctx.events,
    permissions: ctx.permissions,
    gameState: ctx.gameState,
    signalCache: ctx.signalCache,
  };

  for (const nodeId of sorted) {
    // 超时检查
    if (performance.now() - startTime > limits.maxWallMs) {
      return {
        success: false,
        pendingActions: allActions,
        nodeOutputs,
        executionOrder: sorted.slice(0, executedCount),
        warnings,
        aborted: true,
        abortReason: `执行超时（${limits.maxWallMs}ms）`,
        totalExecutedNodes: executedCount,
        totalWallMs: performance.now() - startTime,
      };
    }

    // 执行次数限制
    if (executedCount >= limits.maxExecutedNodes) {
      return {
        success: false,
        pendingActions: allActions,
        nodeOutputs,
        executionOrder: sorted.slice(0, executedCount),
        warnings,
        aborted: true,
        abortReason: `执行节点数超过上限 ${limits.maxExecutedNodes}`,
        totalExecutedNodes: executedCount,
        totalWallMs: performance.now() - startTime,
      };
    }

    const node = nodeMap.get(nodeId)!;
    const def = getNodeDefinition(node.typeId);

    if (!def) {
      warnings.push(`节点 ${nodeId} 的类型 ${node.typeId} 未注册，跳过`);
      nodeOutputs.set(nodeId, {});
      continue;
    }

    // 收集输入：从上游输出或 widget 默认值
    const inputs: Record<string, unknown> = {};
    for (const inputDef of def.inputs) {
      // 查找连接到此输入的上游
      const incoming = (revAdj.get(nodeId) ?? []).find((e) => e.targetSocket === inputDef.key);
      if (incoming) {
        const upstreamOutputs = nodeOutputs.get(incoming.source);
        if (upstreamOutputs && incoming.sourceSocket in upstreamOutputs) {
          inputs[inputDef.key] = upstreamOutputs[incoming.sourceSocket];
          continue;
        }
      }
      // 没有连接，使用 widget 默认值
      if (node.widgetValues && inputDef.key in node.widgetValues) {
        inputs[inputDef.key] = node.widgetValues[inputDef.key];
      } else if (inputDef.defaultValue !== undefined) {
        inputs[inputDef.key] = inputDef.defaultValue;
      } else if (inputDef.required) {
        // flow 类型的 required 不报错（可能从源节点直接触发）
        if (inputDef.type !== 'flow') {
          warnings.push(`节点 ${node.label ?? nodeId} 的必填输入 ${inputDef.key} 未连接`);
        }
      }
    }

    // 合并 widget 值到 inputs（widget 值作为额外上下文）
    const widgetValues = node.widgetValues ?? {};

    // 获取执行器
    const executor = getNodeExecutor(node.typeId);
    if (!executor) {
      // 没有执行器的节点（如纯 UI 节点），透传 flow
      const outputs: Record<string, unknown> = {};
      for (const outDef of def.outputs) {
        if (outDef.type === 'flow') outputs[outDef.key] = true;
      }
      nodeOutputs.set(nodeId, outputs);
      executedCount++;
      node.runtimeState = { executed: true, outputs };
      continue;
    }

    // 执行
    try {
      const result: NodeExecutorResult = executor(inputs, execCtx, widgetValues);
      nodeOutputs.set(nodeId, result.outputs);
      if (result.actions) allActions.push(...result.actions);
      if (result.warnings) warnings.push(...result.warnings);
      node.runtimeState = { executed: true, outputs: result.outputs };
    } catch (err) {
      const msg = `节点 ${node.label ?? nodeId} 执行失败: ${err instanceof Error ? err.message : String(err)}`;
      warnings.push(msg);
      nodeOutputs.set(nodeId, {});
      node.runtimeState = { executed: false, error: msg };
    }

    executedCount++;
  }

  return {
    success: true,
    pendingActions: allActions,
    nodeOutputs,
    executionOrder: sorted,
    warnings,
    aborted: false,
    totalExecutedNodes: executedCount,
    totalWallMs: performance.now() - startTime,
  };
}

function failResult(reason: string): WorkflowExecutionResult {
  return {
    success: false,
    pendingActions: [],
    nodeOutputs: new Map(),
    executionOrder: [],
    warnings: [reason],
    aborted: true,
    abortReason: reason,
    totalExecutedNodes: 0,
    totalWallMs: 0,
  };
}
