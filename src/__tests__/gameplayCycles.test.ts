// 长程数值稳定性：每个内置世界跑 100 回合（每回合 6 小时，玩家按界面能做的事轮流操作），
// 检查数值不出现 NaN/无穷、不越过变量表的上下限、不失控增长，账本与存档体积有上限，事件真的会来。
import { describe, expect, test } from 'bun:test';
import { WORLDS } from '../data/worldLoader';
import { newGame, numbersIn, playTurn } from './helpers/playthrough';

const TURNS = 100;
const MAGNITUDE_LIMIT = 1e9;
/** 100 回合后的存档与单条玩法日志的体积上限（字符数）。日志 200 条封顶，界面流水不进日志。 */
const SAVE_LIMIT = 1_500_000;
const LOG_ENTRY_LIMIT = 64_000;

function boundViolations(game: ReturnType<typeof newGame>): string[] {
  const out: string[] = [];
  for (const spec of game.host.facts.list()) {
    if (spec.type !== 'number' || !spec.bounds || spec.id.includes('{')) continue;
    const value = game.host.facts.read(game.state, spec.id);
    if (value === undefined || value === null) continue;
    const bounds = typeof spec.bounds === 'function' ? spec.bounds(game.state, {}) : spec.bounds;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) out.push(`${spec.id} 不是有限数：${String(value)}`);
    else if (bounds?.min !== undefined && numeric < bounds.min) out.push(`${spec.id}=${numeric} 低于下限 ${bounds.min}`);
    else if (bounds?.max !== undefined && numeric > bounds.max) out.push(`${spec.id}=${numeric} 高于上限 ${bounds.max}`);
  }
  return out;
}

function numericProblems(game: ReturnType<typeof newGame>): string[] {
  const { state } = game;
  const trees = { 玩家: state.玩家, resources: state.resources, economy: state.economy, dice: state.dice, 时钟: state.世界.时间系统.时钟 };
  return numbersIn(trees)
    .filter(item => !Number.isFinite(item.value) || Math.abs(item.value) > MAGNITUDE_LIMIT)
    .map(item => `${item.path}=${item.value}`);
}

describe('100 回合数值稳定性', () => {
  for (const world of WORLDS) {
    test(`${world.name}（${world.id}）`, () => {
      const game = newGame(world, `cycles:${world.id}`);
      for (let round = 1; round <= TURNS; round++) {
        playTurn(game, round);
        const problems = [...numericProblems(game), ...boundViolations(game)];
        if (problems.length) throw new Error(`第 ${round} 回合：${problems.slice(0, 5).join('；')}`);
        const stocks = game.state.resources?.stocks ?? {};
        for (const [id, amount] of Object.entries(stocks)) {
          expect(amount).toBeGreaterThanOrEqual(0);
          const capacity = game.state.resources?.capacity?.[id];
          if (capacity !== undefined) expect(amount).toBeLessThanOrEqual(capacity);
        }
      }
      expect(game.state.simulationRuntime?.tick).toBe(TURNS);
      const runtime = game.state.gameplay!;
      expect(runtime.logs.length).toBeLessThanOrEqual(200);
      expect(runtime.pendingEvents.length).toBeLessThanOrEqual(100);
      expect(runtime.scheduledEvents.length).toBeLessThanOrEqual(100);
      expect(JSON.stringify(game.state).length).toBeLessThan(SAVE_LIMIT);
      expect(Math.max(...runtime.logs.map(log => JSON.stringify(log).length))).toBeLessThan(LOG_ENTRY_LIMIT);
      // 玩家确实做了事（至少处理过事件卡），而不是 100 回合空转；每种被选中过的操作至少成功过一次
      // （机器人传错参数时会一直失败，这条能发现）。
      expect(game.log.filter(entry => entry.status === 'applied').length).toBeGreaterThan(5);
      const kinds = new Map<string, boolean>();
      for (const entry of game.log) {
        if (!entry.action) continue;
        const kind = entry.action.replace(/「.*」|选项\d+|[\d]+/g, '').replace(/^(在.+?)(买入|卖出)/, '$2').replace(/^(采集|制作|买入|卖出|解锁天赋).*/, '$1');
        kinds.set(kind, (kinds.get(kind) ?? false) || entry.status === 'applied');
      }
      expect([...kinds].filter(([, ok]) => !ok).map(([kind]) => kind)).toEqual([]);
    }, 120_000);
  }
});
