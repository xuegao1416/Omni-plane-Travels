/**
 * 命令内推进世界时钟（采集、制作、赶路等玩家行动会消耗时间）。
 * 宿主在命令执行后检测时钟变化并补跑跨过的周期。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { formatWorldClock, getTimeSystemFromWorld, normalizeWorldClockState, writeWorldClock } from '../time/worldClock';

export function advanceStateClock(state: GameState, world: WorldDef | undefined, minutes: number, reason: string): number {
  const delta = Math.max(0, Math.trunc(minutes));
  const time = state.世界?.时间系统;
  if (!time || delta <= 0) return 0;
  const config = getTimeSystemFromWorld(world);
  const current = normalizeWorldClockState(time.时钟 ?? { schemaVersion: 1, elapsedMinutes: 0 }, config);
  const next = writeWorldClock(current, config, { deltaMinutes: delta, source: 'manual', reason });
  time.时钟 = next;
  time.当前时间 = formatWorldClock(next, config);
  return next.elapsedMinutes - current.elapsedMinutes;
}
