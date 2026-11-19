// 事件长程模拟：每个内置世界按默认节奏（偶尔）跑 30 回合。
// 检查事件真的会来、同一张卡不同选项的结果不同、同一个种子两次结果完全一样、换种子结果会变。
import { describe, expect, test } from 'bun:test';
import { WORLDS } from '../data/worldLoader';
import { buildEventCardView } from '../events/viewModel';
import { readDirector } from '../events/state';
import { newGame, playTurn, type Playthrough } from './helpers/playthrough';

const TURNS = 30;

function run(worldId: string, seed: string): Playthrough {
  const world = WORLDS.find(item => item.id === worldId)!;
  const game = newGame(world, seed);
  for (let round = 1; round <= TURNS; round++) playTurn(game, round);
  return game;
}

/** 玩法上有意义的状态（不含日志、时间戳之类的记账字段）。 */
function digest(game: Playthrough): string {
  const { 玩家, resources, economy, eventDirector, flags } = game.state;
  return JSON.stringify({ 玩家, resources, economy, flags, history: eventDirector?.history, fired: eventDirector?.fired });
}

describe('事件 30 回合模拟', () => {
  for (const world of WORLDS) {
    test(`${world.name}（${world.id}）`, () => {
      const first = run(world.id, `events:${world.id}`);
      expect(readDirector(first.state).pacing.level).toBe('low');
      const handled = first.log.filter(entry => entry.action?.startsWith('事件卡')).length;
      expect(handled).toBeGreaterThan(0);
      expect(readDirector(first.state).history.length).toBeGreaterThan(0);

      const again = run(world.id, `events:${world.id}`);
      expect(again.log).toEqual(first.log);
      expect(digest(again)).toBe(digest(first));
    }, 60_000);
  }

  test('换种子，抽到的事件或时机会变', () => {
    const histories = new Set(['a', 'b', 'c'].map(seed => JSON.stringify(readDirector(run('wuxia_world', seed).state).history.map(item => [item.turn, item.key]))));
    expect(histories.size).toBeGreaterThan(1);
  }, 60_000);

  test('同一张卡的不同选项给出不同的结果', () => {
    for (const world of WORLDS) {
      const game = newGame(world, `options:${world.id}`);
      let compared = false;
      for (let round = 1; round <= 80 && !compared; round++) {
        playTurn(game, round, { act: false });
        const view = buildEventCardView(game.state, world);
        if (!view?.card) continue;
        const available = view.card.options.filter(option => option.available !== false);
        if (available.length < 2) {
          // 只有一个可选项（其余缺材料等）：照常处理掉，继续等下一张。
          const pick = available[0]?.index;
          game.state = (pick === undefined
            ? game.host.dispatch(game.state, 'events.dismiss', { key: view.entry.key })
            : game.host.dispatch(game.state, 'events.resolveChoice', { key: view.entry.key, option: pick }, { source: 'player' })).state;
          continue;
        }
        const results = new Set<string>();
        for (const option of available) {
          const outcome = game.host.dispatch(game.state, 'events.resolveChoice', { key: view.entry.key, option: option.index }, { source: 'player' });
          expect(outcome.status).toBe('applied');
          const { 玩家, resources, economy, flags } = outcome.state;
          const queued = outcome.state.eventDirector?.queue.map(item => item.key);
          const decisions = outcome.state.narrativeDecisions?.filter(item => item.status === 'pending').map(item => item.aiNote);
          results.add(JSON.stringify({ 玩家, resources, economy, flags, queued, decisions }));
        }
        if (results.size < 2) throw new Error(`${world.name}「${view.card.title}」的可选项结果没有区别`);
        compared = true;
      }
      if (!compared) throw new Error(`${world.name} 80 回合内没有出现两个以上可选项的事件卡`);
    }
  }, 60_000);
});
