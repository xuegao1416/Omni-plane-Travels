// ============================================================
//  工作流→引擎桥接层
//  把 WorkflowExecutionResult 转成 EvaluateResult，
//  让游戏引擎能直接消费工作流的执行结果。
// ============================================================
import type { WorkflowDefinition, WorkflowExecutionContext, WorkflowExecutionResult, PendingAction } from './workflowSchema';
import { executeWorkflow } from './workflowEngine';
import type { EvaluateResult } from './ruleEngine';
import type { WorldContext, EventRuntimeState, Literal } from './schema';

/** setPath：沿点分路径写值（同 ruleEngine 内部的实现） */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * 执行工作流并转换为 EvaluateResult。
 * 游戏引擎可以直接消费这个结果。
 */
export function executeWorkflowAsEvaluation(
  workflow: WorkflowDefinition,
  ctx: WorldContext,
  tick: number,
  events: Array<{ type: string; where?: Record<string, Literal> }>,
  runtime: EventRuntimeState,
  eventPackId: string,
  permissions: string[],
): EvaluateResult {
  // 克隆上下文，避免直接变异原始状态
  const clonedCtx = JSON.parse(JSON.stringify(ctx)) as Record<string, unknown>;

  const wfCtx: WorkflowExecutionContext = {
    tick,
    events: events as Array<{ type: string; [key: string]: unknown }>,
    permissions,
    gameState: clonedCtx,
    signalCache: new Map(),
  };

  const result = executeWorkflow(workflow, wfCtx);

  // 把 PendingAction[] 应用到克隆的上下文上
  const applied: EvaluateResult['applied'] = [];
  const warnings: string[] = [...result.warnings];
  const scheduledTickEntries: Array<{ scheduledAt: number; ruleId: string; payload?: Record<string, unknown> }> = [];

  for (const action of result.pendingActions) {
    try {
      applyPendingAction(action, clonedCtx, applied, workflow.id, tick, scheduledTickEntries);
    } catch (err) {
      warnings.push(`动作执行失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ctx: clonedCtx as unknown as WorldContext,
    applied,
    warnings,
    aborted: result.aborted,
    reason: result.abortReason,
    eventPackId,
    scheduledTickEntries: scheduledTickEntries.length > 0 ? scheduledTickEntries : undefined,
  };
}

/**
 * 把单个 PendingAction 应用到上下文。
 * 与 ruleEngine.applyAction 逻辑一致。
 */
function applyPendingAction(
  action: PendingAction,
  ctx: Record<string, unknown>,
  applied: EvaluateResult['applied'],
  ruleId: string,
  tick: number,
  scheduled: Array<{ scheduledAt: number; ruleId: string; payload?: Record<string, unknown> }>,
): void {
  switch (action.kind) {
    case 'set': {
      const { path, value } = action.payload as { path: string; value: unknown };
      if (path) {
        setPath(ctx, path, value);
        applied.push({ ruleId, kind: 'set', detail: { path, value } });
      }
      break;
    }
    case 'modifyResource': {
      const { key, delta } = action.payload as { key: string; delta: number };
      const playerRes = (ctx as Record<string, unknown>).玩家 as Record<string, unknown> | undefined;
      const survival = playerRes?.生存资源 as Record<string, Record<string, unknown>> | undefined;
      if (survival && survival[key] != null) {
        const cur = Number(survival[key].数量 ?? 0);
        survival[key].数量 = Math.max(0, cur + delta);
        applied.push({ ruleId, kind: 'modifyResource', detail: { key, delta } });
      }
      break;
    }
    case 'addEvent': {
      const { eventId, eventPackId } = action.payload as { eventId: string; eventPackId?: string };
      if (eventId) {
        applied.push({ ruleId, kind: 'addEvent', detail: { eventId, eventPackId } });
      }
      break;
    }
    case 'scheduleTick': {
      const { after, payload } = action.payload as { after: number; payload?: Record<string, unknown> };
      if (after > 0) {
        scheduled.push({ scheduledAt: tick + after, ruleId, payload });
        applied.push({ ruleId, kind: 'scheduleTick', detail: { after, payload } });
      }
      break;
    }
    case 'narrateHint': {
      // 叙事提示写入 ctx 供 AI 读取
      const { hint } = action.payload as { hint: string };
      if (hint) {
        const aiHints = (ctx.__aiNarrateHints as string[]) ?? [];
        aiHints.push(hint);
        ctx.__aiNarrateHints = aiHints;
        applied.push({ ruleId, kind: 'set', detail: { path: '__aiNarrateHints', value: hint } });
      }
      break;
    }
  }
}
