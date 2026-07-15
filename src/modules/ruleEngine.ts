// ============================================================
//  规则引擎 — 纯 TS 确定性解释器（前端主线程，MVP）
//  安全红线：不执行玩家代码；白名单动作；权限校验；try/catch 隔离；
//  无 Math.random / Date.now / fetch / fs / eval / new Function / 动态 import。
//  唯一计时用途：性能安全上限（8ms 墙钟），用 performance.now()，不改变求值结果。
// ============================================================
import type {
  EventRule,
  Condition,
  Action,
  ActionKind,
  Comparator,
  Literal,
  Permission,
  EventRuntimeState,
  WorldContext,
} from './schema';

export interface EvaluateLimits {
  maxRulesPerMod: number;
  maxEvalSet: number;
  maxConditionDepth: number;
  maxActionsPerRule: number;
  maxStepsPerTick: number;
  maxWallMs: number;
}

export const DEFAULT_LIMITS: EvaluateLimits = {
  maxRulesPerMod: 128,
  maxEvalSet: 1024,
  maxConditionDepth: 6,
  maxActionsPerRule: 16,
  maxStepsPerTick: 8192,
  maxWallMs: 8,
};

export interface AppliedAction {
  ruleId: string;
  kind: ActionKind;
  detail: unknown;
}

export interface EvaluateOptions {
  /** 该 mod 声明的 permissions（用于动作越权隔离） */
  permissions: Permission[];
  /** 运行时轻量状态（onceFired / cooldown），会被原地更新 */
  runtime?: EventRuntimeState;
  /** tick 序号由内核统一提供（不使用 Date.now） */
  tick: number;
  limits?: Partial<EvaluateLimits>;
  /** 当前 tick 注入的世界事件（供 event 条件匹配） */
  events?: Array<{ type: string; where?: Record<string, Literal> }>;
}

export interface EvaluateResult {
  /** 应用动作后的世界上下文（不污染入参） */
  ctx: WorldContext;
  applied: AppliedAction[];
  warnings: string[];
  aborted: boolean;
  reason?: string;
  /** 来源 mod id（由 eventWorldEvolution.evaluateTick 注入，便于 addCard 等动作回溯归属） */
  eventPackId?: string;
}

const ACTION_KINDS: ActionKind[] = [
  'set',
  'emit',
  'addCard',
  'overrideCard',
  'modifyResource',
  'scheduleTick',
];

/** 动作 → 所需权限（能力最小化） */
const ACTION_PERMISSION: Record<ActionKind, Permission> = {
  set: 'modify_world_state',
  emit: 'emit_world_event',
  addCard: 'add_card',
  overrideCard: 'override_card',
  modifyResource: 'modify_world_state',
  scheduleTick: 'register_tick',
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function clone<T>(v: T): T {
  // 确定性深拷贝（仅内存，无 IO）；context 不含函数/undefined 语义
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

function getPath(ctx: WorldContext, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setPath(ctx: WorldContext, path: string, value: unknown): void {
  const parts = path.split('.');
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = ctx as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function compare(op: Comparator, left: unknown, right: Literal): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case 'in':
      return Array.isArray(right) && (right as unknown[]).includes(left);
    case 'contains':
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return (left as unknown[]).includes(right);
      return false;
    default:
      return false;
  }
}

function matchWhere(actual: Record<string, Literal> | undefined, expected: Record<string, Literal> | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  for (const k of Object.keys(expected)) {
    if (actual[k] !== expected[k]) return false;
  }
  return true;
}

interface StepRef {
  steps: number;
  aborted: boolean;
}

function evalCondition(
  cond: Condition,
  ctx: WorldContext,
  events: Array<{ type: string; where?: Record<string, Literal> }>,
  depth: number,
  limits: EvaluateLimits,
  stepRef: StepRef,
): boolean {
  if (depth > limits.maxConditionDepth) {
    stepRef.aborted = true;
    return false;
  }
  if (stepRef.steps >= limits.maxStepsPerTick) {
    stepRef.aborted = true;
    return false;
  }
  if ('all' in cond) {
    stepRef.steps++;
    return cond.all.every((c) => evalCondition(c, ctx, events, depth + 1, limits, stepRef));
  }
  if ('any' in cond) {
    stepRef.steps++;
    return cond.any.some((c) => evalCondition(c, ctx, events, depth + 1, limits, stepRef));
  }
  if ('not' in cond) {
    stepRef.steps++;
    return !evalCondition(cond.not, ctx, events, depth + 1, limits, stepRef);
  }
  if ('state' in cond) {
    stepRef.steps++;
    return compare(cond.state.op, getPath(ctx, cond.state.path), cond.state.value);
  }
  if ('event' in cond) {
    stepRef.steps++;
    return events.some((e) => e.type === cond.event.type && matchWhere(e.where, cond.event.where));
  }
  return false;
}

function actionKindOf(a: Action): ActionKind | null {
  if ('set' in a) return 'set';
  if ('emit' in a) return 'emit';
  if ('addCard' in a) return 'addCard';
  if ('overrideCard' in a) return 'overrideCard';
  if ('modifyResource' in a) return 'modifyResource';
  if ('scheduleTick' in a) return 'scheduleTick';
  return null;
}

function applyAction(
  action: Action,
  ctx: WorldContext,
  applied: AppliedAction[],
  ruleId: string,
): void {
  if ('set' in action) {
    setPath(ctx, action.set.path, action.set.value);
    applied.push({ ruleId, kind: 'set', detail: action.set });
  } else if ('emit' in action) {
    applied.push({ ruleId, kind: 'emit', detail: action.emit });
  } else if ('addCard' in action) {
    applied.push({ ruleId, kind: 'addCard', detail: { cardId: action.addCard.cardId } });
  } else if ('overrideCard' in action) {
    applied.push({ ruleId, kind: 'overrideCard', detail: action.overrideCard });
  } else if ('modifyResource' in action) {
    const res = ctx.resources as Record<string, { amount: number }> | undefined;
    const key = action.modifyResource.key;
    if (res && res[key]) {
      const cur = Number(res[key].amount ?? 0);
      res[key].amount = Math.max(0, cur + action.modifyResource.delta);
    }
    applied.push({ ruleId, kind: 'modifyResource', detail: action.modifyResource });
  } else if ('scheduleTick' in action) {
    applied.push({ ruleId, kind: 'scheduleTick', detail: action.scheduleTick });
  }
}

/**
 * 确定性求值：输入世界上下文快照 + 规则集 + 事件，返回应用后的上下文片段。
 * 硬性上限（超限本次求值中止并告警）：
 *   每 mod ≤128 规则 / 每 tick 求值集 ≤1024 / 条件树深 ≤6 /
 *   单规则 ≤16 动作 / 每 tick ≤8192 步 或 墙钟 ≤8ms。
 */
export function evaluate(
  ctxIn: WorldContext,
  rulesIn: EventRule[],
  options: EvaluateOptions,
): EvaluateResult {
  const limits: EvaluateLimits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const warnings: string[] = [];
  const applied: AppliedAction[] = [];
  const ctx: WorldContext = clone(ctxIn);
  const runtime: EventRuntimeState =
    options.runtime ?? { onceFired: {}, cooldownRemaining: {} };
  const events = options.events ?? [];
  const start = nowMs();
  const stepRef: StepRef = { steps: 0, aborted: false };

  // 上限：每 mod ≤128 规则
  if (rulesIn.length > limits.maxRulesPerMod) {
    warnings.push(`规则数 ${rulesIn.length} 超过上限 ${limits.maxRulesPerMod}，截断至前 ${limits.maxRulesPerMod} 条`);
  }
  const rules = rulesIn.slice(0, limits.maxRulesPerMod);

  // 上限：每 tick 求值集 ≤1024（已含 maxRulesPerMod ≤128，二次防御）
  if (rules.length > limits.maxEvalSet) {
    warnings.push(`求值集 ${rules.length} 超过上限 ${limits.maxEvalSet}，截断`);
  }

  // 冷却递减（确定性，由 tick 差驱动）
  for (const k of Object.keys(runtime.cooldownRemaining)) {
    if (runtime.cooldownRemaining[k] > 0) runtime.cooldownRemaining[k] -= 1;
  }

  // 过滤（once / cooldown / 条件命中）+ 按优先级降序
  const active = rules
    .filter((r) => !(r.once && runtime.onceFired[r.id]))
    .filter((r) => (runtime.cooldownRemaining[r.id] ?? 0) <= 0)
    .filter((r) =>
      evalCondition(r.when, ctx, events, 1, limits, stepRef),
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of active) {
    if (stepRef.aborted) break;
    const then = rule.then ?? [];
    if (then.length > limits.maxActionsPerRule) {
      warnings.push(`规则 ${rule.id} 动作数 ${then.length} 超过上限 ${limits.maxActionsPerRule}，截断`);
    }
    const actions = then.slice(0, limits.maxActionsPerRule);

    for (const action of actions) {
      if (stepRef.aborted) break;
      if (stepRef.steps >= limits.maxStepsPerTick) {
        stepRef.aborted = true;
        break;
      }
      const kind = actionKindOf(action);
      if (!kind) {
        warnings.push(`规则 ${rule.id} 含无法识别的动作，已拒绝`);
        continue;
      }
      // 白名单动作校验
      if (!ACTION_KINDS.includes(kind)) {
        warnings.push(`规则 ${rule.id} 动作 ${kind} 不在白名单，跳过`);
        continue;
      }
      // 能力最小化：权限校验
      if (!options.permissions.includes(ACTION_PERMISSION[kind])) {
        warnings.push(`规则 ${rule.id} 缺少权限 ${ACTION_PERMISSION[kind]}，跳过动作 ${kind}`);
        continue;
      }
      // 单条规则异常隔离，不拖垮内核
      try {
        applyAction(action, ctx, applied, rule.id);
        stepRef.steps++;
      } catch (e) {
        warnings.push(
          `规则 ${rule.id} 动作 ${kind} 执行失败，已隔离: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (rule.once) runtime.onceFired[rule.id] = true;
    if (rule.cooldownTicks && rule.cooldownTicks > 0) {
      runtime.cooldownRemaining[rule.id] = rule.cooldownTicks;
    }

    if (nowMs() - start > limits.maxWallMs) stepRef.aborted = true;
  }

  const aborted = stepRef.aborted || nowMs() - start > limits.maxWallMs;
  return {
    ctx,
    applied,
    warnings,
    aborted,
    reason: aborted ? '超过步数 / 墙钟上限，本次求值中止并告警' : undefined,
  };
}
