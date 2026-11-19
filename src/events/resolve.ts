/**
 * 事件卡选项结算：共享效果 + 选项效果 + 检定分支 + 后续事件，一次在宿主草稿上完成，
 * 并写一条叙事决策记录，让下一次成功正文承接玩家的选择与结果。
 */
import type { GameState } from '../schema/variables';
import type { FactRegistry } from '../core/facts';
import type { ModuleHookContext } from '../core/host';
import type { CommandResult, JsonRecord, Op } from '../core/ops';
import { createNarrativeDecisionRecord, normalizeNarrativeDecisionAction, type NarrativeDecisionAction } from '../gameplay/narrativeDecision';
import type { WorldDef } from '../data/worlds-schema';
import { cardEffectToOps, legacyChoiceEffectToOps, statPath, type StatKeyResolver } from './effects';
import { checkModifier, checkRange, checkValue, presentCard, statInfo, statLabel, statRange, type CardPresentation } from './cards';
import { HISTORY_CAP, QUEUE_CAP, directorOf, markFired } from './state';
import type { CardOptionSpec, CardOutcomeSpec, EventDefinition } from './types';

/** 宿主上下文里事件模块需要的部分（避免与 module.ts 循环依赖）。 */
export interface EventsLookup {
  byKey: ReadonlyMap<string, EventDefinition>;
  findCard(eventId: string, packId?: string): EventDefinition | undefined;
}

type Context = ModuleHookContext<EventsLookup>;

const MAX_DYNAMIC_OPTIONS = 6;
const MAX_DYNAMIC_DELTA = 100;
const CONSUMED_DECISIONS_KEPT = 40;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

/** AI 生成的动态选项只接受文字和单个属性/资源增减（不接受命令或任意写入）。 */
export function sanitizeDynamicOptions(raw: unknown): CardOptionSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: CardOptionSpec[] = [];
  for (const item of raw.slice(0, MAX_DYNAMIC_OPTIONS)) {
    const value = record(item);
    const label = typeof value?.label === 'string' ? value.label.trim().slice(0, 80) : '';
    if (!label) continue;
    const option: CardOptionSpec = { label };
    if (typeof value!.aiNote === 'string' && value!.aiNote.trim()) option.aiNote = value!.aiNote.trim().slice(0, 300);
    const effect = record(value!.effect);
    const delta = Number(effect?.delta);
    const statId = typeof effect?.statId === 'string' && effect.statId.trim() ? effect.statId.trim() : undefined;
    const resource = typeof effect?.resourcePath === 'string' && effect.resourcePath.trim() ? effect.resourcePath.trim() : undefined;
    if (Number.isFinite(delta) && delta !== 0 && (statId || resource)) {
      option.effect = { ...(statId ? { statId } : {}), ...(resource ? { resourcePath: resource } : {}), delta: Math.max(-MAX_DYNAMIC_DELTA, Math.min(MAX_DYNAMIC_DELTA, Math.round(delta))) };
    }
    out.push(option);
  }
  return out;
}

/** 旧版 apply_effects 动作 → 效果。 */
function actionEffects(action: NarrativeDecisionAction | undefined, facts: FactRegistry, statKey: StatKeyResolver): Op[] {
  if (action?.type !== 'apply_effects') return [];
  return action.effects.flatMap(effect => effect.type === 'delta'
    ? legacyChoiceEffectToOps(effect.effect, facts, statKey)
    : legacyChoiceEffectToOps({ flagPath: effect.path, value: effect.value }, facts));
}

/** 把将要执行的效果说成人话（「生命 -5，钱 +20」）。 */
export function describeOps(ops: readonly Op[], state: GameState, facts: FactRegistry, world?: WorldDef): string[] {
  const currency = state.玩家?.货币资源?.主货币?.名称?.trim() || '钱';
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === 'add' && Number(op.value)) {
      const stat = op.path.startsWith('player.stats.') ? statLabel(world, op.path.slice('player.stats.'.length)) : undefined;
      const name = op.path === 'player.currency' ? currency
        : stat ?? facts.label(op.path).replace(/^(属性|物资|仓库|物品)·/, '').replace(/·好感度$/, '好感');
      out.push(`${name} ${signed(Number(op.value))}`);
    } else if (op.op === 'command' && op.command === 'resources.applyStatus') {
      out.push(`陷入「${String(op.args?.id ?? '')}」`);
    } else if (op.op === 'command' && op.command === 'resources.clearStatus') {
      out.push(`解除「${String(op.args?.id ?? '')}」`);
    } else if (op.op === 'if') {
      out.push(...describeOps(op.then, state, facts, world));
    }
  }
  return out;
}

export interface CheckResult {
  stat: string;
  label: string;
  roll: number;
  modifier: number;
  dc: number;
  success: boolean;
}

function rollCheck(state: GameState, spec: NonNullable<CardOptionSpec['check']>, context: Context, fallbackLabel: string): CheckResult {
  const range = checkRange(spec) ?? statRange(context.world, spec.stat);
  const value = checkValue(context.facts.read(state, statPath(statInfo(context.world, spec.stat).key)), range);
  const modifier = checkModifier(value, range) + Math.round(context.modifiers.apply(`dice.check.${spec.stat}`, 0));
  const dc = Math.max(1, Math.trunc(Number(spec.dc) || 10));
  const roll = context.rng.int(1, 20);
  const success = roll === 20 || (roll !== 1 && roll + modifier >= dc);
  return { stat: spec.stat, label: spec.label || fallbackLabel, roll, modifier, dc, success };
}

function enqueueNext(state: GameState, context: Context, current: EventDefinition, nextId: string): EventDefinition | undefined {
  const [packId, eventId] = nextId.includes('/') ? [nextId.slice(0, nextId.lastIndexOf('/')), nextId.slice(nextId.lastIndexOf('/') + 1)] : [current.packId, nextId];
  const next = context.config.findCard(eventId, packId) ?? context.config.findCard(eventId);
  const director = directorOf(state);
  if (!next || director.queue.some(item => item.key === next.key)) return undefined;
  director.queue.unshift({ key: next.key, packId: next.packId, eventId: next.eventId, turn: context.turn, reason: `接续「${current.name}」` });
  director.queue = director.queue.slice(0, QUEUE_CAP);
  markFired(next, director, context.turn);
  return next;
}

export interface ResolveArgs {
  key: string;
  /** 选项下标；没有选项的卡片传 -1（知道了）。 */
  option: number;
  /** 动态选项卡：界面展示给玩家的选项（AI 生成或兜底）。 */
  dynamic?: unknown;
  saveId?: string;
}

export function readResolveArgs(args: JsonRecord): ResolveArgs {
  return {
    key: String(args.key ?? ''),
    option: Number.isFinite(Number(args.option)) ? Math.trunc(Number(args.option)) : -1,
    ...(args.dynamic !== undefined ? { dynamic: args.dynamic } : {}),
    ...(typeof args.saveId === 'string' && args.saveId ? { saveId: args.saveId } : {}),
  };
}

function optionsFor(presentation: CardPresentation, dynamic: unknown): { specs: CardOptionSpec[]; dynamic: boolean } {
  if (!presentation.dynamic) return { specs: presentation.specs, dynamic: false };
  const provided = sanitizeDynamicOptions(dynamic);
  if (provided.length) return { specs: provided, dynamic: true };
  const fallback = presentation.dynamic.fallbackChoices.length ? presentation.dynamic.fallbackChoices : presentation.specs;
  return { specs: fallback, dynamic: true };
}

export function resolveEventChoice(state: GameState, rawArgs: JsonRecord, context: Context): CommandResult {
  const args = readResolveArgs(rawArgs);
  const director = directorOf(state);
  const entry = director.queue.find(item => item.key === args.key);
  if (!entry) return { ok: false, reason: '这张事件卡已经处理过了' };
  const def = context.config.byKey.get(entry.key);
  if (!def?.card) return { ok: false, reason: '事件内容已不可用（所属事件包可能已停用），可以直接移除这张卡' };

  const presentation = presentCard({
    state, world: context.world, facts: context.facts, modifiers: context.modifiers,
    key: def.key, packId: def.packId, eventId: def.eventId, name: def.name, workflow: def.card, turn: context.turn,
  });
  const { specs, dynamic } = optionsFor(presentation, args.dynamic);
  const spec = specs.length ? specs[args.option] : undefined;
  if (specs.length && !spec) return { ok: false, reason: '请选择一个选项' };
  if (spec && !dynamic) {
    const model = presentation.options[args.option];
    if (model && !model.available) return { ok: false, reason: model.reason ?? '这个选项当前不可选' };
  }

  const statKey = (stat: string) => statInfo(context.world, stat).key;
  const ops: Op[] = [];
  for (const shared of presentation.sharedEffects) ops.push(...legacyChoiceEffectToOps(shared, context.facts, statKey));
  if (spec?.effect) ops.push(...legacyChoiceEffectToOps(spec.effect, context.facts, statKey));
  for (const effect of spec?.effects ?? []) ops.push(...cardEffectToOps(effect, context.facts, statKey));
  const action = normalizeNarrativeDecisionAction(spec?.action);
  ops.push(...actionEffects(action, context.facts, statKey));

  let check: CheckResult | undefined;
  let outcome: CardOutcomeSpec | undefined;
  if (spec?.check?.stat) {
    const model = presentation.options[args.option]?.check;
    check = rollCheck(state, spec.check, context, model?.label ?? context.facts.label(statPath(spec.check.stat)).replace(/^属性·/, ''));
    outcome = check.success ? spec.success : spec.failure;
    for (const effect of outcome?.effects ?? []) ops.push(...cardEffectToOps(effect, context.facts, statKey));
    context.emit('check.rolled', { stat: check.stat, label: check.label, roll: check.roll, modifier: check.modifier, dc: check.dc, success: check.success, source: def.key });
  }

  const described = describeOps(ops, state, context.facts, context.world);
  if (ops.length) context.apply(ops, 'event');

  // 效果可能改动了导演状态（例如规则又塞进新卡），重新取引用。
  const live = directorOf(state);
  live.queue = live.queue.filter(item => item.key !== entry.key);
  const nextId = outcome?.next ?? spec?.next;
  const next = nextId ? enqueueNext(state, context, def, nextId) : undefined;

  const title = presentation.title || def.name;
  const label = spec?.label;
  const checkText = check
    ? `${check.label}检定 d20=${check.roll}${check.modifier ? signed(check.modifier) : ''} 对难度 ${check.dc}：${check.success ? '成功' : '失败'}。`
    : '';
  const notes = [outcome?.note, spec?.aiNote, outcome?.aiNote].filter((item): item is string => Boolean(item?.trim())).map(item => item.trim());
  const resultText = described.length ? `结果：${described.join('，')}。` : '';
  const aiNote = [
    label ? `事件「${title}」中，玩家选择了「${label}」。` : `事件「${title}」已经发生，玩家已知晓。`,
    checkText,
    ...notes,
    resultText,
    next ? `接下来会发生「${next.name}」。` : '',
  ].filter(Boolean).join('');

  live.serial += 1;
  const summary = [check ? (check.success ? '检定成功' : '检定失败') : '', described.join('，')].filter(Boolean).join('；');
  live.history = [...live.history, {
    key: def.key, name: title, turn: context.turn,
    ...(label ? { choice: label } : {}),
    ...(check ? { success: check.success } : {}),
    ...(summary ? { summary } : {}),
  }].slice(-HISTORY_CAP);

  const saveId = args.saveId ?? 'default';
  const decision = createNarrativeDecisionRecord({
    id: `${saveId}:${def.key}:${live.serial}`,
    saveId,
    eventPackId: def.packId,
    cardId: def.eventId,
    blockId: 'choice-0',
    selectedIndex: Math.max(0, args.option),
    action: action && action.type !== 'apply_effects' ? action : { type: 'narrative', instruction: label ?? title },
    aiNote,
  });
  const decisions = state.narrativeDecisions ?? [];
  const pending = decisions.filter(item => item.status === 'pending');
  const consumed = decisions.filter(item => item.status !== 'pending').slice(-CONSUMED_DECISIONS_KEPT);
  state.narrativeDecisions = [...consumed, ...pending, decision];

  context.emit('events.resolved', {
    key: def.key, eventId: def.eventId, packId: def.packId, option: args.option, label: label ?? '',
    decisionId: decision.id, ...(check ? { success: check.success } : {}),
  });
  return { ok: true, message: `${title}${label ? `：${label}` : ''}${check ? (check.success ? '（检定成功）' : '（检定失败）') : ''}` };
}
