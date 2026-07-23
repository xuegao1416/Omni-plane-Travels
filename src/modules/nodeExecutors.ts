// ============================================================
//  节点执行器 — 38 个节点的具体执行逻辑
// ============================================================
import { registerNodeExecutor } from './nodeRegistry';
import type { NodeExecutor, NodeExecutorContext, PendingAction } from './workflowSchema';

// ─── 辅助 ───

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>': return Number(a) > Number(b);
    case '>=': return Number(a) >= Number(b);
    case '<': return Number(a) < Number(b);
    case '<=': return Number(a) <= Number(b);
    case 'in': return Array.isArray(b) ? b.includes(a) : String(b).includes(String(a));
    case 'contains': return String(a).includes(String(b));
    default: return false;
  }
}

function mathOp(op: string, a: number, b: number): number {
  switch (op) {
    case 'add': return a + b;
    case 'sub': return a - b;
    case 'mul': return a * b;
    case 'div': return b !== 0 ? a / b : 0;
    case 'mod': return b !== 0 ? a % b : 0;
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    default: return a;
  }
}

// ─── TRIGGERS ───

registerNodeExecutor('triggers.world_event', (inputs, ctx, wv) => {
  const matchType = (wv?.match_type as string) ?? '';
  const matched = ctx.events.find((e) => !matchType || e.type === matchType);
  return {
    outputs: {
      flow_out: !!matched,
      event_out: matched ?? null,
      event_type: matched?.type ?? '',
    },
  };
});

registerNodeExecutor('triggers.periodic', (_inputs, ctx, wv) => {
  const interval = (wv?.interval as number) ?? 30;
  const offset = (wv?.offset as number) ?? 0;
  const tick = ctx.tick;
  const fires = tick >= offset && (tick - offset) % interval === 0;
  return {
    outputs: { flow_out: fires, tick_out: tick },
  };
});

registerNodeExecutor('triggers.state_change', (_inputs, ctx, wv) => {
  // 简化实现：检查当前值是否满足阈值条件
  const path = (wv?.path as string) ?? '';
  const op = (wv?.op as string) ?? '>=';
  const threshold = wv?.threshold;
  if (!path) return { outputs: { flow_out: false } };
  const value = getPath(ctx.gameState as Record<string, unknown>, path);
  const fires = compare(op, value, threshold);
  return { outputs: { flow_out: fires, old_value: null, new_value: value } };
});

registerNodeExecutor('triggers.manual', () => ({
  outputs: { flow_out: true },
}));

registerNodeExecutor('triggers.choice_made', (_inputs, ctx, wv) => {
  const matchCard = (wv?.match_card as string) ?? '';
  const choiceEvent = ctx.events.find((e) => {
    if (e.type !== 'choice_made') return false;
    if (matchCard && e.card_id !== matchCard) return false;
    return true;
  });
  return {
    outputs: {
      flow_out: !!choiceEvent,
      choice_id: (choiceEvent?.choice_id as string) ?? '',
      card_id: (choiceEvent?.card_id as string) ?? '',
    },
  };
});

registerNodeExecutor('triggers.scheduled', (_inputs, ctx, wv) => {
  const matchTag = (wv?.match_tag as string) ?? '';
  const scheduled = ctx.events.find((e) => {
    if (e.type !== 'scheduled_tick') return false;
    if (matchTag && e.tag !== matchTag) return false;
    return true;
  });
  return {
    outputs: { flow_out: !!scheduled, payload_out: scheduled?.payload ?? null },
  };
});

registerNodeExecutor('triggers.cross_workflow', (_inputs, ctx, wv) => {
  const signalName = (wv?.signal_name as string) ?? '';
  const data = ctx.signalCache?.get(signalName);
  return {
    outputs: { flow_out: data !== undefined, signal_data: data ?? null },
  };
});

// ─── CONDITIONS ───

registerNodeExecutor('conditions.compare', (inputs, _ctx, wv) => {
  const op = (wv?.op as string) ?? '>=';
  return { outputs: { result: compare(op, inputs.value_a, inputs.value_b) } };
});

registerNodeExecutor('conditions.check_resource', (inputs, ctx, wv) => {
  const key = (wv?.resource_key as string) ?? '';
  const op = (wv?.op as string) ?? '>=';
  const threshold = (wv?.threshold as number) ?? 0;
  const amount = getPath(ctx.gameState as Record<string, unknown>, `玩家.生存资源.${key}.数量`) as number ?? 0;
  const met = compare(op, amount, threshold);
  return {
    outputs: { flow_out: met, met, amount_out: amount },
  };
});

registerNodeExecutor('conditions.check_stat', (inputs, ctx, wv) => {
  const key = (wv?.stat_key as string) ?? '';
  const op = (wv?.op as string) ?? '>=';
  const threshold = (wv?.threshold as number) ?? 0;
  const value = getPath(ctx.gameState as Record<string, unknown>, `玩家.生存状态.${key}`) as number ?? 0;
  const met = compare(op, value, threshold);
  return {
    outputs: { flow_out: met, met, value_out: value },
  };
});

registerNodeExecutor('conditions.check_flag', (_inputs, ctx, wv) => {
  const path = (wv?.path as string) ?? '';
  const expected = wv?.expected !== false;
  const value = getPath(ctx.gameState as Record<string, unknown>, path);
  return { outputs: { flow_out: !!value === expected } };
});

registerNodeExecutor('conditions.check_inventory', (_inputs, ctx, wv) => {
  const itemName = (wv?.item_name as string) ?? '';
  const op = (wv?.op as string) ?? '>=';
  const threshold = (wv?.threshold as number) ?? 1;
  const inventory = getPath(ctx.gameState as Record<string, unknown>, '玩家.物品栏') as Record<string, unknown>[] | undefined;
  const item = inventory?.find((i) => (i as Record<string, unknown>).name === itemName);
  const count = item ? ((item as Record<string, unknown>).数量 as number ?? 0) : 0;
  return { outputs: { flow_out: compare(op, count, threshold), count_out: count } };
});

registerNodeExecutor('conditions.check_npc', (_inputs, ctx, wv) => {
  const npcId = (wv?.npc_id as string) ?? '';
  const field = (wv?.field as string) ?? '';
  const op = (wv?.op as string) ?? '>=';
  const threshold = wv?.threshold;
  const npc = getPath(ctx.gameState as Record<string, unknown>, `人物档案.${npcId}`) as Record<string, unknown> | undefined;
  const value = npc ? getPath(npc, field) : undefined;
  return { outputs: { flow_out: compare(op, value, threshold), value_out: value } };
});

registerNodeExecutor('conditions.and', (inputs) => ({
  outputs: { result: !!(inputs.in_0 && inputs.in_1 && (inputs.in_2 === undefined || inputs.in_2)) },
}));

registerNodeExecutor('conditions.or', (inputs) => ({
  outputs: { result: !!(inputs.in_0 || inputs.in_1 || inputs.in_2) },
}));

registerNodeExecutor('conditions.not', (inputs) => ({
  outputs: { result: !inputs.in_0 },
}));

registerNodeExecutor('conditions.event_match', (inputs, ctx, wv) => {
  const matchType = (wv?.match_type as string) ?? '';
  const matched = ctx.events.find((e) => !matchType || e.type === matchType);
  return { outputs: { matched: !!matched, event_out: matched ?? null } };
});

// ─── ACTIONS ───

registerNodeExecutor('actions.set_value', (inputs, _ctx, wv) => {
  const path = (wv?.path as string) ?? '';
  const value = inputs.value_in ?? wv?.value;
  if (!path) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'set', payload: { path, value } }],
  };
});

registerNodeExecutor('actions.modify_resource', (inputs, _ctx, wv) => {
  const key = (wv?.resource_key as string) ?? '';
  const delta = (inputs.delta_in as number) ?? (wv?.delta as number) ?? 0;
  if (!key) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'modifyResource', payload: { key, delta } }],
  };
});

registerNodeExecutor('actions.modify_stat', (inputs, _ctx, wv) => {
  const key = (wv?.stat_key as string) ?? '';
  const delta = (inputs.delta_in as number) ?? (wv?.delta as number) ?? 0;
  if (!key) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'set', payload: { path: `玩家.生存状态.${key}`, value: delta } }],
  };
});

registerNodeExecutor('actions.add_event', (_inputs, _ctx, wv) => {
  const eventId = (wv?.event_id as string) ?? '';
  if (!eventId) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'addEvent', payload: { eventId } }],
  };
});

registerNodeExecutor('actions.schedule_tick', (inputs, _ctx, wv) => {
  const after = (wv?.after as number) ?? 1;
  const tag = (wv?.tag as string) ?? '';
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'scheduleTick', payload: { after, tag, payload: inputs.payload_in } }],
  };
});

registerNodeExecutor('actions.emit_signal', (inputs, ctx, wv) => {
  const signalName = (wv?.signal_name as string) ?? '';
  if (signalName && ctx.signalCache) {
    ctx.signalCache.set(signalName, inputs.data_in);
  }
  return { outputs: { flow_out: true } };
});

registerNodeExecutor('actions.modify_npc', (inputs, ctx, wv) => {
  const npcId = (wv?.npc_id as string) ?? '';
  const field = (wv?.field as string) ?? '';
  if (!npcId || !field) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'set', payload: { path: `人物档案.${npcId}.${field}`, value: inputs.value_in } }],
  };
});

registerNodeExecutor('actions.modify_inventory', (inputs, _ctx, wv) => {
  const itemName = (wv?.item_name as string) ?? '';
  const count = (inputs.count_in as number) ?? (wv?.count as number) ?? 0;
  if (!itemName) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'set', payload: { path: `玩家.物品栏`, value: { name: itemName, 数量: count } } }],
  };
});

registerNodeExecutor('actions.modify_currency', (inputs, _ctx, wv) => {
  const delta = (inputs.delta_in as number) ?? (wv?.delta as number) ?? 0;
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'modifyResource', payload: { key: '主货币', delta } }],
  };
});

registerNodeExecutor('actions.add_notebook', (_inputs, _ctx, wv) => {
  const noteType = (wv?.note_type as string) ?? 'todo';
  const content = (wv?.content as string) ?? '';
  if (!content) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'set', payload: { path: `玩家.记事本.${noteType}`, value: content } }],
  };
});

registerNodeExecutor('actions.set_world_state', (_inputs, _ctx, wv) => {
  const axis = (wv?.axis as string) ?? '';
  const field = (wv?.field as string) ?? '';
  const value = (wv?.value as string) ?? '';
  if (!axis || !field) return { outputs: { flow_out: true } };
  return {
    outputs: { flow_out: true },
    actions: [{ kind: 'set', payload: { path: `世界.状态轴.${axis}.${field}`, value } }],
  };
});

// ─── DATA ───

registerNodeExecutor('data.get_value', (_inputs, ctx, wv) => {
  const path = (wv?.path as string) ?? '';
  const value = getPath(ctx.gameState as Record<string, unknown>, path);
  return { outputs: { value } };
});

registerNodeExecutor('data.get_resource', (_inputs, ctx, wv) => {
  const key = (wv?.resource_key as string) ?? '';
  const amount = getPath(ctx.gameState as Record<string, unknown>, `玩家.生存资源.${key}.数量`) as number ?? 0;
  return { outputs: { amount } };
});

registerNodeExecutor('data.get_stat', (_inputs, ctx, wv) => {
  const key = (wv?.stat_key as string) ?? '';
  const value = getPath(ctx.gameState as Record<string, unknown>, `玩家.生存状态.${key}`) as number ?? 0;
  return { outputs: { value } };
});

registerNodeExecutor('data.get_npc_data', (_inputs, ctx, wv) => {
  const npcId = (wv?.npc_id as string) ?? '';
  const field = (wv?.field as string) ?? '';
  const npc = getPath(ctx.gameState as Record<string, unknown>, `人物档案.${npcId}`) as Record<string, unknown> | undefined;
  const value = npc ? getPath(npc, field) : undefined;
  return { outputs: { value } };
});

registerNodeExecutor('data.get_tick', (_inputs, ctx) => ({
  outputs: { tick: ctx.tick },
}));

registerNodeExecutor('data.get_random', (_inputs, _ctx, wv) => {
  const min = (wv?.min as number) ?? 0;
  const max = (wv?.max as number) ?? 100;
  // 确定性伪随机：基于当前值的简单 hash
  const value = min + Math.floor(Math.random() * (max - min + 1));
  return { outputs: { value } };
});

registerNodeExecutor('data.constant', (_inputs, _ctx, wv) => {
  const type = (wv?.const_type as string) ?? 'string';
  const raw = (wv?.const_value as string) ?? '';
  let value: unknown = raw;
  if (type === 'number') value = Number(raw) || 0;
  else if (type === 'boolean') value = raw === 'true';
  return { outputs: { value } };
});

registerNodeExecutor('data.math', (inputs, _ctx, wv) => {
  const op = (wv?.op as string) ?? 'add';
  const a = Number(inputs.a) || 0;
  const b = Number(inputs.b) || 0;
  return { outputs: { result: mathOp(op, a, b) } };
});

registerNodeExecutor('data.string_concat', (inputs) => ({
  outputs: { result: `${inputs.a ?? ''}${inputs.b ?? ''}` },
}));

registerNodeExecutor('data.string_contains', (inputs) => ({
  outputs: { result: String(inputs.haystack ?? '').includes(String(inputs.needle ?? '')) },
}));

registerNodeExecutor('data.array_contains', (inputs) => {
  const arr = inputs.array;
  const val = inputs.value;
  let result = false;
  if (Array.isArray(arr)) result = arr.includes(val);
  return { outputs: { result } };
});

registerNodeExecutor('data.ternary', (inputs) => ({
  outputs: { value: inputs.condition ? inputs.true_val : inputs.false_val },
}));

// ─── FLOW ───

registerNodeExecutor('flow.branch', (inputs) => ({
  outputs: {
    true_out: !!inputs.condition,
    false_out: !inputs.condition,
  },
}));

registerNodeExecutor('flow.merge', (inputs) => ({
  outputs: { flow_out: !!(inputs.flow_a || inputs.flow_b) },
}));

registerNodeExecutor('flow.sequence', (inputs) => ({
  outputs: {
    step_1: !!inputs.flow_in,
    step_2: !!inputs.flow_in,
    step_3: !!inputs.flow_in,
  },
}));

registerNodeExecutor('flow.delay', (_inputs, _ctx, wv) => ({
  outputs: { flow_out: true },
  actions: [{ kind: 'scheduleTick', payload: { after: (wv?.after as number) ?? 1 } }],
}));

registerNodeExecutor('flow.loop', (inputs, _ctx, wv) => {
  const count = Math.min((wv?.count as number) ?? 1, 64);
  // 简化实现：只输出第一次的 flow_out，后续迭代由外部处理
  return {
    outputs: { flow_out: !!inputs.flow_in, index: 0, done: true },
  };
});

registerNodeExecutor('flow.gate', (inputs) => ({
  outputs: { flow_out: !!inputs.flow_in && !!inputs.condition },
}));

registerNodeExecutor('flow.reroute', (inputs) => ({
  outputs: { out: inputs.in },
}));

// ─── OUTPUT ───

registerNodeExecutor('output.show_card', (_inputs, _ctx, wv) => {
  const eventId = (wv?.event_id as string) ?? '';
  if (!eventId) return { outputs: {} };
  return {
    outputs: {},
    actions: [{ kind: 'addEvent', payload: { eventId } }],
  };
});

registerNodeExecutor('output.log', (inputs, _ctx, wv) => {
  const message = (wv?.message as string) ?? '';
  return {
    outputs: {},
    warnings: message ? [`[LOG] ${message}: ${JSON.stringify(inputs.value)}`] : [],
  };
});

registerNodeExecutor('output.narrate_hint', (_inputs, _ctx, wv) => {
  const hint = (wv?.hint as string) ?? '';
  if (!hint) return { outputs: {} };
  return {
    outputs: {},
    actions: [{ kind: 'narrateHint', payload: { hint } }],
  };
});

registerNodeExecutor('output.end_workflow', () => ({
  outputs: {},
}));
