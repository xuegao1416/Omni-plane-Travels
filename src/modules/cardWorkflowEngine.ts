// ============================================================
//  卡片工作流 DAG 执行引擎
//  从入口节点遍历到终端，收集渲染数据和效果
//  对齐规则包 workflowEngine.ts 的架构深度
// ============================================================
import type {
  CardWorkflowDefinition, CardNodeInstance, CardWorkflowConnection,
  CardExecutionContext, CardNodeExecutionResult,
} from './schema';
import { getCardNodeDefinition } from './cardNodeRegistry';
import { getCardNodeExecutor } from './cardNodeExecutors';

// ─── 执行结果 ───

export interface CardWorkflowExecutionResult {
  /** 按顺序收集的渲染数据（叙事节点输出） */
  renderData: CardNodeExecutionResult['renderData'][];
  /** 收集的选项列表（交互节点输出，取最后一个） */
  choices: CardNodeExecutionResult['choices'];
  /** 收集的待应用效果 */
  pendingEffects: CardNodeExecutionResult['pendingEffects'];
  /** 执行的节点 ID 列表（按执行顺序） */
  executedNodeIds: string[];
  /** 警告信息 */
  warnings: string[];
  /** 是否因超限中止 */
  aborted: boolean;
  /** 动态选项配置（如果有 choice.dynamic 节点） */
  dynamicConfig?: Record<string, unknown>;
}

// ─── 默认限制 ───

const DEFAULT_LIMITS = {
  maxNodes: 128,
  maxWallMs: 16,
};

// ─── 入口节点查找 ───

function findEntryNodes(nodes: CardNodeInstance[], connections: CardWorkflowConnection[]): CardNodeInstance[] {
  // 入口节点 = source 节点 OR 没有流入连接的节点
  const hasIncoming = new Set(connections.map(c => c.targetNodeId));
  return nodes.filter((n) => {
    const def = getCardNodeDefinition(n.typeId);
    return def?.source === true || !hasIncoming.has(n.id);
  });
}

// ─── 后继节点查找 ───

function findSuccessors(
  nodeId: string,
  socketKey: string,
  connections: CardWorkflowConnection[],
): Array<{ nodeId: string; socketKey: string }> {
  return connections
    .filter((c) => c.sourceNodeId === nodeId && c.sourceSocketKey === socketKey)
    .map((c) => ({ nodeId: c.targetNodeId, socketKey: c.targetSocketKey }));
}

// ─── 输入值收集 ───

function collectInputs(
  node: CardNodeInstance,
  connections: CardWorkflowConnection[],
  outputCache: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const def = getCardNodeDefinition(node.typeId);
  if (!def) return inputs;

  for (const input of def.inputs) {
    // 找到连接到这个输入的源
    const conn = connections.find(
      (c) => c.targetNodeId === node.id && c.targetSocketKey === input.key,
    );
    if (conn) {
      const sourceOutputs = outputCache.get(conn.sourceNodeId);
      if (sourceOutputs && conn.sourceSocketKey in sourceOutputs) {
        inputs[input.key] = sourceOutputs[conn.sourceSocketKey];
      }
    }
  }

  return inputs;
}

// ─── 主执行函数 ───

export function executeCardWorkflow(
  workflow: CardWorkflowDefinition,
  ctx: CardExecutionContext,
): CardWorkflowExecutionResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const limits = { ...DEFAULT_LIMITS, ...ctx.limits };

  const renderData: CardNodeExecutionResult['renderData'][] = [];
  let choices: CardNodeExecutionResult['choices'] = undefined;
  const pendingEffects: CardNodeExecutionResult['pendingEffects'] = [];
  const executedNodeIds: string[] = [];
  const warnings: string[] = [];
  let aborted = false;
  let dynamicConfig: Record<string, unknown> | undefined;

  // 输出缓存：nodeId → outputs
  const outputCache = new Map<string, Record<string, unknown>>();
  // 已执行节点集合
  const executed = new Set<string>();
  // 待执行队列（BFS）
  const queue: Array<{ nodeId: string }> = [];

  // 找入口节点
  const entries = findEntryNodes(workflow.nodes, workflow.connections);
  if (entries.length === 0) {
    // 无入口节点（可能全是循环），从第一个节点开始
    if (workflow.nodes.length > 0) {
      entries.push(workflow.nodes[0]);
    } else {
      warnings.push('工作流没有节点');
      return { renderData, choices, pendingEffects, executedNodeIds, warnings, aborted: true };
    }
  }

  // 入口节点入队
  for (const entry of entries) {
    queue.push({ nodeId: entry.id });
  }

  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));

  while (queue.length > 0) {
    // 超限检查
    if (executed.size >= limits.maxNodes) {
      warnings.push(`执行节点数超过上限 ${limits.maxNodes}，中止`);
      aborted = true;
      break;
    }
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    if (elapsed > limits.maxWallMs) {
      warnings.push(`执行时间超过 ${limits.maxWallMs}ms，中止`);
      aborted = true;
      break;
    }

    const { nodeId } = queue.shift()!;
    if (executed.has(nodeId)) continue;

    const node = nodeMap.get(nodeId);
    if (!node) {
      warnings.push(`节点 ${nodeId} 不存在`);
      continue;
    }

    const def = getCardNodeDefinition(node.typeId);
    if (!def) {
      warnings.push(`节点类型 ${node.typeId} 未注册`);
      continue;
    }

    // 收集输入
    const inputs = collectInputs(node, workflow.connections, outputCache);

    // 执行节点
    const executor = getCardNodeExecutor(node.typeId);
    if (!executor) {
      warnings.push(`节点 ${node.typeId} 没有执行器`);
      continue;
    }

    let result: CardNodeExecutionResult;
    try {
      result = executor(node, ctx, inputs);
    } catch (e) {
      warnings.push(`节点 ${nodeId} 执行失败: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    // 记录执行
    executed.add(nodeId);
    executedNodeIds.push(nodeId);
    if (result.outputs) {
      outputCache.set(nodeId, result.outputs);
    }

    // 收集结果
    if (result.renderData) {
      renderData.push(result.renderData);
    }
    if (result.choices) {
      choices = result.choices;
    }
    if (result.pendingEffects) {
      pendingEffects.push(...result.pendingEffects);
    }
    if (result.dynamicConfig) {
      dynamicConfig = result.dynamicConfig;
    }

    // 查找后继节点
    if (result.branchTarget) {
      // 分支节点：只走匹配的输出
      const successors = findSuccessors(nodeId, result.branchTarget, workflow.connections);
      for (const s of successors) {
        if (!executed.has(s.nodeId)) {
          queue.push({ nodeId: s.nodeId });
        }
      }
    } else {
      // 普通节点：走所有输出流
      for (const output of def.outputs) {
        if (output.type === 'flow') {
          const successors = findSuccessors(nodeId, output.key, workflow.connections);
          for (const s of successors) {
            if (!executed.has(s.nodeId)) {
              queue.push({ nodeId: s.nodeId });
            }
          }
        }
      }
    }
  }

  return {
    renderData,
    choices: choices ?? [],
    pendingEffects: pendingEffects.flat(),
    executedNodeIds,
    warnings,
    aborted,
    dynamicConfig,
  };
}
