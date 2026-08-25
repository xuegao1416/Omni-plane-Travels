// ============================================================
//  卡片节点执行器 — 12 种节点的执行逻辑
//  每个执行器接收 context + widgetValues，输出 CardNodeExecutionResult
// ============================================================
import type {
  CardNodeInstance, CardNodeExecutionResult, CardExecutionContext,
} from './schema';

export type CardNodeExecutor = (
  node: CardNodeInstance,
  ctx: CardExecutionContext,
  inputs: Record<string, unknown>,
) => CardNodeExecutionResult;

// ─── 注册表 ───

const executors = new Map<string, CardNodeExecutor>();

export function registerCardNodeExecutor(typeId: string, executor: CardNodeExecutor): void {
  executors.set(typeId, executor);
}

export function getCardNodeExecutor(typeId: string): CardNodeExecutor | undefined {
  return executors.get(typeId);
}

// ─── 辅助函数 ───

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compareValues(op: string, left: unknown, right: unknown): boolean {
  // 布尔值特殊处理
  if (typeof left === 'boolean') {
    const rBool = right === 'true' || right === true || right === 1;
    const rBoolFalse = right === 'false' || right === false || right === 0;
    if (rBool || rBoolFalse) {
      const r = rBool ? true : false;
      switch (op) {
        case '==': return left === r;
        case '!=': return left !== r;
        default: return false;
      }
    }
  }
  const l = Number(left);
  const r = Number(right);
  switch (op) {
    case '==': return left === right || l === r;
    case '!=': return left !== right && l !== r;
    case '>': return l > r;
    case '>=': return l >= r;
    case '<': return l < r;
    case '<=': return l <= r;
    default: return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  叙事节点执行器
// ═══════════════════════════════════════════════════════════

registerCardNodeExecutor('narrative.title', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  return {
    renderData: {
      type: 'title',
      title: String(w.title ?? inputs.title ?? ''),
    },
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('narrative.text', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  return {
    renderData: {
      type: 'text',
      text: String(w.text ?? inputs.text ?? ''),
    },
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('narrative.image', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  return {
    renderData: {
      type: 'image',
      imageUrl: String(w.imageUrl ?? inputs.imageUrl ?? ''),
      text: String(w.caption ?? inputs.caption ?? ''),
    },
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('narrative.dialog', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  return {
    renderData: {
      type: 'dialog',
      npcName: String(w.npcName ?? inputs.npcName ?? ''),
      text: String(w.dialogText ?? inputs.dialogText ?? ''),
      npcEmotion: String(w.emotion ?? inputs.emotion ?? 'neutral'),
    },
    outputs: { flow_out: true },
  };
});

// ═══════════════════════════════════════════════════════════
//  交互节点执行器
// ═══════════════════════════════════════════════════════════

registerCardNodeExecutor('choice.static', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  let options: CardNodeExecutionResult['choices'] = [];

  // 从 widget 或 inputs 读取选项列表
  const raw = w.options ?? inputs.options;
  if (typeof raw === 'string') {
    try { options = JSON.parse(raw); } catch { options = []; }
  } else if (Array.isArray(raw)) {
    options = raw;
  }

  return {
    choices: options,
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('choice.dynamic', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  // 动态选项在运行时由 CardOverlay 调用 AI 生成
  // 这里只返回配置，实际生成在 CardOverlay 层
  return {
    choices: [], // 空 = 需要 AI 生成
    outputs: {
      flow_out: true,
      dynamicConfig: {
        instruction: String(w.instruction ?? inputs.instruction ?? ''),
        countRange: [
          Number(w.minCount ?? inputs.minCount ?? 2),
          Number(w.maxCount ?? inputs.maxCount ?? 4),
        ],
        optionTemplate: {
          effectRequired: Boolean(w.effectRequired ?? inputs.effectRequired ?? false),
          aiNoteRequired: w.aiNoteRequired !== false,
        },
        fallbackChoices: (() => {
          const raw = w.fallback ?? inputs.fallback;
          if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
          return Array.isArray(raw) ? raw : [];
        })(),
      },
    },
  };
});

registerCardNodeExecutor('choice.conditional', (_node, ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  let options: Array<Record<string, unknown>> = [];

  const raw = w.options ?? inputs.options;
  if (typeof raw === 'string') {
    try { options = JSON.parse(raw); } catch { options = []; }
  } else if (Array.isArray(raw)) {
    options = raw;
  }

  // 根据 gameState 过滤选项
  const filtered = (options as Array<Record<string, unknown>>).filter((opt) => {
    const condPath = opt.conditionPath as string | undefined;
    if (!condPath) return true; // 无条件 = 始终显示
    const condOp = String(opt.conditionOp ?? '!=');
    const condValue = opt.conditionValue;
    const actual = getPath(ctx.gameState, condPath);
    return compareValues(condOp, actual, condValue ?? false);
  });

  return {
    choices: filtered.map(opt => ({
      label: String(opt.label ?? ''),
      aiNote: opt.aiNote as string | undefined,
      effect: opt.effect as { statId?: string; resourcePath?: string; delta: number } | undefined,
      ...(opt.action ? { action: opt.action as import('../gameplay/narrativeDecision').NarrativeDecisionAction } : {}),
    })),
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('choice.weighted', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  let options: Array<Record<string, unknown>> = [];

  const raw = w.options ?? inputs.options;
  if (typeof raw === 'string') {
    try { options = JSON.parse(raw); } catch { options = []; }
  } else if (Array.isArray(raw)) {
    options = raw;
  }

  const showCount = Number(w.showCount ?? inputs.showCount ?? 3);

  // 按权重选取（确定性：按权重排序后取前 N 个）
  const weighted: Array<Record<string, unknown> & { weight: number }> = options.map(opt => ({
    ...opt,
    weight: Number(opt.weight ?? 1),
  }));

  // 按权重降序排序，取前 showCount 个（确定性，不依赖随机数）
  const sorted = [...weighted].sort((a, b) => b.weight - a.weight);
  const selected = sorted.slice(0, showCount);

  return {
    choices: selected.map(opt => ({
      label: String(opt.label ?? ''),
      aiNote: opt.aiNote as string | undefined,
      effect: opt.effect as { statId?: string; resourcePath?: string; delta: number } | undefined,
      ...(opt.action ? { action: opt.action as import('../gameplay/narrativeDecision').NarrativeDecisionAction } : {}),
      weight: opt.weight,
    })),
    outputs: { flow_out: true },
  };
});

// ═══════════════════════════════════════════════════════════
//  效果节点执行器
// ═══════════════════════════════════════════════════════════

registerCardNodeExecutor('effect.stat', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  const statKey = String(w.statKey ?? inputs.statKey ?? '');
  const delta = Number(w.delta ?? inputs.delta ?? inputs.delta_in ?? 0);

  return {
    pendingEffects: statKey ? [{ statId: statKey, delta }] : [],
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('effect.resource', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  const resourceKey = String(w.resourceKey ?? inputs.resourceKey ?? '');
  const delta = Number(w.delta ?? inputs.delta ?? inputs.delta_in ?? 0);

  return {
    pendingEffects: resourceKey ? [{ resourcePath: resourceKey, delta }] : [],
    outputs: { flow_out: true },
  };
});

registerCardNodeExecutor('effect.flag', (_node, _ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  const flagPath = String(w.flagPath ?? inputs.flagPath ?? '');
  const value = w.value ?? inputs.value ?? true;

  return {
    pendingEffects: flagPath ? [{ flagPath, value }] : [],
    outputs: { flow_out: true },
  };
});

// ═══════════════════════════════════════════════════════════
//  流程节点执行器
// ═══════════════════════════════════════════════════════════

registerCardNodeExecutor('flow.branch', (_node, ctx, inputs) => {
  const w = _node.widgetValues ?? {};
  const checkPath = String(w.checkPath ?? inputs.checkPath ?? '');
  const op = String(w.op ?? inputs.op ?? '==');
  const compareValue = w.compareValue ?? inputs.compareValue ?? '';

  const actual = getPath(ctx.gameState, checkPath);
  const result = compareValues(op, actual, compareValue);

  return {
    branchTarget: result ? 'true_out' : 'false_out',
    outputs: {
      condition: result,
      [result ? 'true_out' : 'false_out']: true,
    },
  };
});
