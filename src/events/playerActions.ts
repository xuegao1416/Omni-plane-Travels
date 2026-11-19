/**
 * 界面发起的事件操作：选择、跳过、调节奏、手动触发。全部经事件模块命令结算。
 */
import type { WorldDef } from '../data/worlds-schema';
import type { GameState } from '../schema/variables';
import type { HostOutcome } from '../core/host';
import { createGameplayHost } from '../core/registry';
import { playerCommandBlocked, runPlayerCommand, type PlayerCommandEngine, type PlayerCommandResult } from '../core/playerCommands';
import type { NarrativeDecisionRecord } from '../gameplay/narrativeDecision';
import type { CardOptionSpec, PacingLevel } from './types';

export interface EventChoiceInput {
  key: string;
  option: number;
  /** 动态选项卡：界面上展示的选项。 */
  dynamic?: CardOptionSpec[];
  saveId: string;
}

export interface EventChoiceResult {
  ok: boolean;
  feedback: string;
  /** 待提交的状态（界面负责提交、存盘、接续战斗）。 */
  state?: GameState;
  record?: NarrativeDecisionRecord;
  outcome?: HostOutcome;
}

/** 结算一张卡的选择，但不提交：叙事决策与战斗请求由游戏界面统一提交。 */
export function resolveEventChoice(engine: PlayerCommandEngine, world: WorldDef | undefined, input: EventChoiceInput): EventChoiceResult {
  const blocked = playerCommandBlocked(engine);
  if (blocked) return { ok: false, feedback: blocked };
  const current = engine.variableManager.getState();
  const host = createGameplayHost(world, current);
  const outcome = host.dispatch(host.prepare(current), 'events.resolveChoice', {
    key: input.key, option: input.option, saveId: input.saveId,
    ...(input.dynamic ? { dynamic: input.dynamic as unknown as Record<string, unknown>[] } : {}),
  }, { source: 'player', label: '事件选择' });
  if (outcome.status !== 'applied') return { ok: false, feedback: outcome.reason ?? '这个选择没有生效。', outcome };
  const decisionId = outcome.events.find(event => event.type === 'events.resolved')?.payload.decisionId;
  const record = outcome.state.narrativeDecisions?.find(item => item.id === decisionId);
  return { ok: true, feedback: outcome.messages.join('；') || '已选择', state: outcome.state, ...(record ? { record } : {}), outcome };
}

export function dismissEventCard(engine: PlayerCommandEngine, world: WorldDef | undefined, key: string): PlayerCommandResult {
  return runPlayerCommand(engine, world, 'events.dismiss', { key }, '跳过事件');
}

export function setEventPacing(engine: PlayerCommandEngine, world: WorldDef | undefined, level: PacingLevel): PlayerCommandResult {
  return runPlayerCommand(engine, world, 'events.setPacing', { level }, '事件节奏');
}

/** 旧接口 EVENT_CARD 广播、编辑器试玩：把卡片放进待处理队列。 */
export function triggerEventCard(engine: PlayerCommandEngine, world: WorldDef | undefined, eventId: string, packId?: string): PlayerCommandResult {
  return runPlayerCommand(engine, world, 'events.trigger', { eventId, ...(packId ? { packId } : {}) }, '触发事件');
}
