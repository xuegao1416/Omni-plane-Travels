// 内置六个世界的事件卡：都能在游玩中出现，数据合法，各选项有自己的后果，并和其他模块联动。
// 第一条由旧 worldWorkflows 测试（轮播工作流绑定卡片包）移植：调度改由事件导演的牌堆与触发器负责。
import { describe, expect, test } from 'bun:test';
import { WORLDS } from '../data/worldLoader';
import type { WorldDef } from '../data/worlds-schema';
import { createDefaultGameState, type GameState } from '../schema/variables';
import { createGameplayHost } from '../core/registry';
import { getEventCatalog } from './catalog';
import { buildEventCardView } from './viewModel';
import { readDirector } from './state';
import { cardOptions, validateEventCatalog } from './validate';

function world(id: string): WorldDef {
  const found = WORLDS.find(item => item.id === id);
  if (!found) throw new Error(`缺少内置世界 ${id}`);
  return found;
}

function start(id: string, mutate?: (state: GameState) => void) {
  const def = world(id);
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 8 * 60 };
  state.玩家.货币资源.主货币 = { 名称: '', 数量: 500 };
  state.gameplay = { rng: { seed: `cards-${id}`, counter: 0 } } as never;
  mutate?.(state);
  const host = createGameplayHost(def, state);
  return { def, host, state: host.prepare(state) };
}

test('六个内置世界的每张事件卡都能出现（进随机牌堆或有剧情触发器）', () => {
  const ids = ['border_trade', 'desire_metropolis', 'japanese_school', 'stranded_island', 'wasteland_apocalypse', 'wuxia_world'];
  for (const id of ids) {
    const def = world(id);
    const shipped = (def.eventPacks ?? []).flatMap(pack => (pack.events ?? []).map(event => `${pack.id}/${event.id}`));
    const cards = getEventCatalog(def).definitions.filter(item => item.kind === 'card');
    expect(cards.map(item => item.key).sort()).toEqual([...shipped].sort());
    const followUps = new Set(cards.flatMap(card => cardOptions(card).flatMap(option => [option.next, option.success?.next, option.failure?.next]))
      .filter((next): next is string => Boolean(next)));
    for (const card of cards) {
      // 只作为后续出现的卡（触发器为空）必须真的被某个选项指向。
      if (card.trigger.on.length === 0) expect(followUps.has(card.eventId)).toBe(true);
    }
  }
});

test('all 40 shipped cards are stored with valid choices and canonical stat keys', () => {
  let count = 0;
  for (const def of WORLDS) {
    for (const pack of def.eventPacks ?? []) {
      for (const event of pack.events ?? []) {
        const workflow = event.workflow!;
        count++;
        for (const node of workflow.nodes) {
          if (node.typeId === 'choice.static') {
            expect(() => JSON.parse(String(node.widgetValues?.options))).not.toThrow();
          }
          if (node.typeId === 'effect.stat') {
            expect(['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'])
              .toContain(String(node.widgetValues?.statKey));
          }
        }
      }
    }
  }
  expect(count).toBe(40);
});

describe('内置卡的后果', () => {
  test('不再有对所有选项一视同仁的共享效果节点，每张卡至少两个选项后果不同', () => {
    for (const def of WORLDS) {
      for (const card of getEventCatalog(def).definitions.filter(item => item.kind === 'card')) {
        expect(card.card?.nodes.some(node => String(node.typeId).startsWith('effect.'))).toBe(false);
        const signatures = new Set(cardOptions(card).map(option => JSON.stringify([option.effects ?? [], option.check ?? null, option.success ?? null, option.failure ?? null])));
        expect(signatures.size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('引用的属性、物资、商品、命令、变量与后续卡在所属世界都存在', () => {
    for (const def of WORLDS) {
      const errors = validateEventCatalog(def).filter(issue => issue.level === 'error');
      expect({ world: def.id, errors }).toEqual({ world: def.id, errors: [] });
    }
  });
});

describe('内置卡与其他模块联动', () => {
  test('荒岛：淡水告急由物资模块的「告急」事件触发，选项会动用布料与木材', () => {
    const { host, state } = start('stranded_island');
    const lowWater = host.apply(state, [{ op: 'add', path: 'player.resources.water', value: -10, min: 0 }], { source: 'event', label: '测试' });
    const queue = readDirector(lowWater.state).queue.map(item => item.eventId);
    expect(queue).toContain('water_crisis');
    const view = buildEventCardView(lowWater.state, world('stranded_island'));
    expect(view?.card?.title).toBe('淡水告急');
    expect(view?.card?.options[1]).toMatchObject({ available: false, reason: '需要 1 份布料' });
  });

  test('边贸：接下大买卖会生成一份羽绒服订单', () => {
    const { host, state } = start('border_trade');
    const queued = host.dispatch(state, 'events.trigger', { eventId: 'big_deal' });
    const resolved = host.dispatch(queued.state, 'events.resolveChoice', { key: 'world:border_trade:events/big_deal', option: 0, saveId: 's' });
    expect(resolved.status).toBe('applied');
    expect(resolved.state.economy?.contracts.filter(item => item.status === 'open').map(item => [item.goods, item.quantity])).toEqual([['羽绒服', 10]]);
  });

  test('末日：没觉醒异能时「使用异能」不可选；觉醒后可选', () => {
    const { host, state } = start('wasteland_apocalypse');
    const queued = host.dispatch(state, 'events.trigger', { eventId: 'mutant_fight' }).state;
    expect(buildEventCardView(queued, world('wasteland_apocalypse'))?.card?.options[2]).toMatchObject({ available: false, reason: '异能尚未觉醒' });
    const awakened = structuredClone(queued);
    awakened.flags = { ...(awakened.flags ?? {}), 异能觉醒: true };
    expect(buildEventCardView(awakened, world('wasteland_apocalypse'))?.card?.options[2]?.available).toBe(true);
    expect(host.dispatch(queued, 'events.resolveChoice', { key: 'world:wasteland_apocalypse:events/mutant_fight', option: 2 }).status).toBe('failed');
  });

  test('校园：心动值攒到 3 之后，告白在回合结束时出现', () => {
    const { host, state } = start('japanese_school', draft => { draft.eventDirector = { ...readDirector(draft), pacing: { level: 'off', lastCardTurn: 0, quietTurns: 0 } }; });
    const end = (input: GameState, turn: number) => {
      const started = host.startTurn(input, { turnId: `t${turn}`, round: turn });
      return host.endTurn(started.state, { turnId: `t${turn}`, round: turn }).state;
    };
    const quiet = end(state, 1);
    expect(readDirector(quiet).queue).toEqual([]);
    const fond = structuredClone(quiet);
    fond.flags = { ...(fond.flags ?? {}), 心动值: 3 };
    expect(readDirector(end(fond, 2)).queue.map(item => item.eventId)).toEqual(['confession']);
  });
});
