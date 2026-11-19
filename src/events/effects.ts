/**
 * 旧事件格式里的动作/效果 → 统一效果语言。
 * 规则引擎 Action、节点工作流 PendingAction、卡片选项效果都经这里，路径交给变量注册表解析（含旧中文别名）。
 */
import type { Op } from '../core/ops';
import type { FactRegistry } from '../core/facts';
import type { Action } from '../modules/schema';
import type { PendingAction } from '../modules/workflowSchema';
import type { CardEffectSpec } from './types';

const CURRENCY_KEYS = new Set(['主货币', 'currency', '货币资源.主货币', '经营资产.资金']);
const FACT_ROOT = /^(player|玩家|world|世界|flags|npc|人物档案|economy|resources|quest|events)\./;

/** 资源键：主货币（旧经营资金已并入）、已登记的物资、仓库货物、旧版生存资源路径依次尝试。 */
export function resourcePath(facts: FactRegistry, key: string): string {
  const trimmed = key.trim();
  if (CURRENCY_KEYS.has(trimmed)) return 'player.currency';
  const bare = trimmed.startsWith('生存资源.') ? trimmed.slice('生存资源.'.length) : trimmed;
  if (FACT_ROOT.test(bare)) return bare;
  const id = bare.split('.')[0];
  if (facts.resolve(`player.resources.${id}`)?.spec) return `player.resources.${id}`;
  if (facts.resolve(`economy.goods.${id}`)?.spec) return `economy.goods.${id}`;
  return `玩家.生存资源.${id}.数量`;
}

/** 属性键：`生命`、`dim1`、`attrA` 等扁平键，或完整变量路径。 */
export function statPath(stat: string): string {
  const trimmed = stat.trim();
  if (FACT_ROOT.test(trimmed)) return trimmed;
  return `player.stats.${trimmed.split('.')[0]}`;
}

/** 旧事件包权限：动作 → 所需权限。世界内置事件不受限。 */
const ACTION_PERMISSION: Record<string, string> = {
  set: 'modify_world_state',
  modifyResource: 'modify_world_state',
  addEvent: 'add_card',
  requestCombat: 'emit_world_event',
  scheduleTick: 'register_tick',
};

export function actionPermission(action: Action): string | undefined {
  const kind = Object.keys(action)[0];
  return kind ? ACTION_PERMISSION[kind] : undefined;
}

export function pendingActionPermission(action: PendingAction): string | undefined {
  if (action.kind === 'modifyStat' || action.kind === 'modifyItem') return 'modify_world_state';
  if (action.kind === 'narrateHint') return undefined;
  return ACTION_PERMISSION[action.kind];
}

/** 抽卡效果没写事件包时补上来源包（同包引用）。 */
export function withDefaultPack(ops: readonly Op[], packId: string): Op[] {
  return ops.map(op => {
    if (op.op === 'card' && !op.packId) return { ...op, packId };
    if (op.op === 'if') return { ...op, then: withDefaultPack(op.then, packId), ...(op.else ? { else: withDefaultPack(op.else, packId) } : {}) };
    return op;
  });
}

export function ruleActionToOps(action: Action, facts: FactRegistry): Op[] {
  if ('set' in action) return [{ op: 'set', path: action.set.path, value: action.set.value }];
  if ('addEvent' in action) return [{ op: 'card', eventId: action.addEvent.eventId, ...(action.addEvent.eventPackId ? { packId: action.addEvent.eventPackId } : {}) }];
  if ('requestCombat' in action) return [{ op: 'combat', request: action.requestCombat }];
  if ('modifyResource' in action) return [{ op: 'add', path: resourcePath(facts, action.modifyResource.key), value: Number(action.modifyResource.delta) || 0, min: 0 }];
  if ('scheduleTick' in action) {
    const payload = (action.scheduleTick.payload ?? {}) as Record<string, unknown>;
    return [{ op: 'schedule', event: String(payload.type ?? 'scheduled'), payload, afterTurns: Math.max(1, Number(action.scheduleTick.after) || 1) }];
  }
  return [];
}

export function pendingActionToOps(action: PendingAction, facts: FactRegistry): Op[] {
  const payload = action.payload ?? {};
  switch (action.kind) {
    case 'set': return payload.path ? [{ op: 'set', path: String(payload.path), value: payload.value }] : [];
    case 'modifyResource': return [{ op: 'add', path: resourcePath(facts, String(payload.key ?? '')), value: Number(payload.delta) || 0, min: 0 }];
    case 'modifyStat': return [{ op: 'add', path: statPath(String(payload.key ?? '')), value: Number(payload.delta) || 0, min: 0, create: false }];
    case 'modifyItem': return payload.name ? [{ op: 'add', path: `player.items.${String(payload.name)}`, value: Number(payload.delta) || 0 }] : [];
    case 'addEvent': return payload.eventId ? [{ op: 'card', eventId: String(payload.eventId), ...(payload.eventPackId ? { packId: String(payload.eventPackId) } : {}) }] : [];
    case 'requestCombat': return [{ op: 'combat', request: payload }];
    case 'scheduleTick': {
      const inner = (payload.payload ?? {}) as Record<string, unknown>;
      return [{ op: 'schedule', event: String(inner.type ?? payload.tag ?? 'scheduled'), payload: { ...inner, tag: payload.tag }, afterTurns: Math.max(1, Number(payload.after) || 1) }];
    }
    case 'narrateHint': return payload.hint ? [{ op: 'note', text: String(payload.hint), tone: 'hint' }] : [];
    default: return [];
  }
}

/** 属性中文名 → 存档键（由调用方按世界的属性配置解析）。 */
export type StatKeyResolver = (stat: string) => string;
const sameKey: StatKeyResolver = stat => stat;

/** 旧卡片的单个效果：resourcePath 优先，否则属性。 */
export function legacyChoiceEffectToOps(effect: { statId?: string; resourcePath?: string; flagPath?: string; delta?: number; value?: unknown }, facts: FactRegistry, statKey: StatKeyResolver = sameKey): Op[] {
  if (effect.flagPath) return [{ op: 'set', path: effect.flagPath.startsWith('flags.') ? effect.flagPath : `flags.${effect.flagPath}`, value: effect.value ?? true }];
  const delta = Number(effect.delta) || 0;
  if (effect.resourcePath?.trim()) return [{ op: 'add', path: resourcePath(facts, effect.resourcePath), value: delta, min: 0 }];
  if (effect.statId?.trim()) return [{ op: 'add', path: statPath(statKey(effect.statId)), value: delta, min: 0, create: false }];
  return [];
}

export function cardEffectToOps(effect: CardEffectSpec, facts: FactRegistry, statKey: StatKeyResolver = sameKey): Op[] {
  if ('stat' in effect) return [{ op: 'add', path: statPath(statKey(effect.stat)), value: Number(effect.delta) || 0, min: 0, create: false }];
  if ('resource' in effect) return [{ op: 'add', path: resourcePath(facts, effect.resource), value: Number(effect.delta) || 0, min: 0 }];
  if ('item' in effect) return [{ op: 'add', path: `player.items.${effect.item}`, value: Number(effect.delta) || 0 }];
  if ('currency' in effect) return [{ op: 'add', path: 'player.currency', value: Number(effect.currency) || 0, min: 0 }];
  if ('flag' in effect) return [{ op: 'set', path: effect.flag.startsWith('flags.') ? effect.flag : `flags.${effect.flag}`, value: effect.value ?? true }];
  if ('fact' in effect) {
    return effect.delta !== undefined
      ? [{ op: 'add', path: effect.fact, value: Number(effect.delta) || 0 }]
      : [{ op: 'set', path: effect.fact, value: effect.value }];
  }
  if ('status' in effect) return [{ op: 'command', command: 'resources.applyStatus', args: { id: effect.status, ...(effect.days ? { days: effect.days } : {}), source: 'event' } }];
  if ('clearStatus' in effect) return [{ op: 'command', command: 'resources.clearStatus', args: { id: effect.clearStatus, reason: '事件处理' } }];
  if ('npc' in effect) return [{ op: 'add', path: `npc.${effect.npc}.affinity`, value: Number(effect.affinity) || 0 }];
  if ('note' in effect) return [{ op: 'note', text: effect.note, tone: 'fact' }];
  if ('command' in effect) return [{ op: 'command', command: effect.command, args: effect.args ?? {} }];
  return [];
}

/** 效果的简短说明（卡片选项上展示）。 */
export function describeCardEffect(effect: CardEffectSpec, facts: FactRegistry, statName?: (stat: string) => string | undefined): string {
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;
  if ('stat' in effect) return `${statName?.(effect.stat) ?? facts.label(statPath(effect.stat)).replace(/^属性·/, '')} ${signed(effect.delta)}`;
  if ('resource' in effect) return `${facts.label(resourcePath(facts, effect.resource)).replace(/^(物资|仓库)·/, '')} ${signed(effect.delta)}`;
  if ('item' in effect) return `${effect.item} ${signed(effect.delta)}`;
  if ('currency' in effect) return `钱 ${signed(effect.currency)}`;
  if ('npc' in effect) return `${effect.npc}好感 ${signed(effect.affinity)}`;
  if ('status' in effect) return `陷入「${effect.status}」`;
  if ('clearStatus' in effect) return `解除「${effect.clearStatus}」`;
  return '';
}
