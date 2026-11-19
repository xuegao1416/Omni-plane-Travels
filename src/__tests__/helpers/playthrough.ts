/**
 * 无模型的整局模拟：新开一局，按回合跑「回合开始 → 玩家操作 → 时钟推进 → 回合结束」，
 * 玩家操作由一个确定性的小机器人按界面能做的事轮流挑选（处理事件卡、采集、制作、买卖、加点、解锁天赋）。
 * 用于数值稳定性与事件节奏的长程测试。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { GameplayHost, HostOutcome } from '../../core/host';
import { createGameplayHost } from '../../core/registry';
import { createRngState } from '../../core/rng';
import { createNewSessionManager } from '../../engine/sessionInitialization';
import { advanceWorldClockForTurn, createWorldClock, formatWorldClock, getTimeSystemFromWorld } from '../../time/worldClock';
import { buildResourcesViewModel } from '../../domains/resources/viewModel';
import { buildEconomyViewModel } from '../../domains/economy/viewModel';
import { buildEventCardView } from '../../events/viewModel';
import { canUnlockTalent } from '../../domains/abilities/rules';
import type { TalentModuleSchema } from '../../modules/schema';
import { consumeNarrativeDecisions } from '../../gameplay/narrativeDecision';

export interface PlayLog {
  round: number;
  action?: string;
  status?: HostOutcome['status'];
  reason?: string;
  events: string[];
  cards: string[];
}

export interface Playthrough {
  world: WorldDef;
  host: GameplayHost;
  state: GameState;
  log: PlayLog[];
}

export function newGame(world: WorldDef, seed: string): Playthrough {
  const manager = createNewSessionManager(world);
  const initial = manager.getState();
  initial.gameplay = { ...initial.gameplay!, rng: createRngState(seed) } as GameState['gameplay'];
  const host = createGameplayHost(world, initial);
  return { world, host, state: host.prepare(initial), log: [] };
}

type Action = { label: string; command: string; args: Record<string, unknown> };

/** 当前界面上可做的操作，按固定顺序列出。 */
export function availableActions(game: Playthrough, round: number): Action[] {
  const { state, world } = game;
  const actions: Action[] = [];
  const card = buildEventCardView(state, world);
  if (card?.card) {
    const options = card.card.options.filter(option => option.available !== false);
    const pick = options.length ? options[round % options.length] : undefined;
    actions.push(pick
      ? { label: `事件卡「${card.card.title}」选项${pick.index + 1}`, command: 'events.resolveChoice', args: { key: card.entry.key, option: pick.index } }
      : { label: `跳过事件卡「${card.card.title}」`, command: 'events.dismiss', args: { key: card.entry.key } });
    return actions;
  }
  if (card?.unavailable) return [{ label: '移除失效事件卡', command: 'events.dismiss', args: { key: card.entry.key } }];
  const resources = buildResourcesViewModel(state, world);
  for (const recipe of resources?.recipes ?? []) {
    if (recipe.craftable) actions.push({ label: `制作${recipe.name}`, command: 'resources.craft', args: { id: recipe.id } });
  }
  for (const row of resources?.resources ?? []) {
    if (row.gather && !row.gather.blocked) actions.push({ label: `采集${row.name}`, command: 'resources.gather', args: { id: row.id } });
  }
  const economy = buildEconomyViewModel(state, world);
  for (const item of economy?.warehouse.items ?? []) {
    if (item.quantity > 0) {
      const market = economy!.markets.find(entry => entry.goods.some(goods => goods.id === item.id));
      if (market) actions.push({ label: `卖出${item.name}`, command: 'economy.sell', args: { market: market.id, goods: item.id, quantity: 1 } });
    }
  }
  for (const market of economy?.markets ?? []) {
    const goods = market.goods[round % Math.max(1, market.goods.length)];
    if (goods) actions.push({ label: `在${market.name}买入${goods.name}`, command: 'economy.buy', args: { market: market.id, goods: goods.id, quantity: 1 } });
  }
  const talent = world.modules?.find(item => item.moduleId === 'talent' && item.enabled)?.moduleConfig as TalentModuleSchema | undefined;
  for (const def of talent?.categories.flatMap(category => category.talents ?? []) ?? []) {
    if (canUnlockTalent(state, talent!, def.id, { tick: round }).ok) actions.push({ label: `解锁天赋${def.name}`, command: 'abilities.unlockTalent', args: { id: def.id } });
  }
  return actions;
}

/** 跑一回合。返回本回合日志。 */
export function playTurn(game: Playthrough, round: number, options: { minutes?: number; act?: boolean; userText?: string } = {}): PlayLog {
  const turnId = `sim-${round}`;
  const entry: PlayLog = { round, events: [], cards: [] };
  const absorb = (outcome: HostOutcome) => {
    entry.events.push(...outcome.events.map(event => event.type));
    entry.cards.push(...outcome.cards.map(card => card.eventId));
    game.state = outcome.state;
  };
  absorb(game.host.startTurn(game.state, { turnId, round, userText: options.userText ?? '继续前进' }));
  if (options.act !== false) {
    const actions = game.host.commandNames().length ? availableActions(game, round).filter(action => game.host.commandNames().includes(action.command)) : [];
    const action = actions.length ? actions[round % actions.length] : undefined;
    if (action) {
      const outcome = game.host.dispatch(game.state, action.command, action.args, { source: 'player', label: action.label });
      entry.action = action.label;
      entry.status = outcome.status;
      entry.reason = outcome.reason;
      if (outcome.status === 'applied') absorb(outcome);
    }
  }
  // 正文生成成功：事件卡选择留下的待叙述决定被这轮正文消费（与 turnSettlement 一致）。
  game.state = consumeNarrativeDecisions(game.state, { narrativeId: turnId });
  const config = getTimeSystemFromWorld(game.world);
  const previousClock = game.state.世界.时间系统.时钟 ?? createWorldClock(config);
  const clock = advanceWorldClockForTurn(previousClock, config, options.minutes ?? 360, { turnId, round, reason: '模拟回合', source: 'ai' });
  game.state = { ...game.state, 世界: { ...game.state.世界, 时间系统: { ...game.state.世界.时间系统, 时钟: clock, 当前时间: formatWorldClock(clock, config) } } };
  absorb(game.host.endTurn(game.state, { turnId, round, previousClock, narrative: '一段平静的时间过去了。' }));
  game.log.push(entry);
  return entry;
}

const VOLATILE_KEY = /time|At$|stamp|seed|sequence|counter|^id$|Id$|version|revision/i;

/** 列出子树里所有数值（跳过时间戳、序号之类的字段）。 */
export function numbersIn(value: unknown, path = '', out: Array<{ path: string; value: number }> = []): Array<{ path: string; value: number }> {
  if (typeof value === 'number') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => numbersIn(item, `${path}[${index}]`, out));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (VOLATILE_KEY.test(key)) continue;
      numbersIn(item, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}
