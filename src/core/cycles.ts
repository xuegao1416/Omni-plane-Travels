/**
 * 周期结算：比较回合前后的世界时钟，算出跨过了几个小时/天/周/月。
 * 模块按周期结算（生存每日消耗、经营每日营业），不再按「回合」或文本关键词猜。
 */
import { getWorldClockIndices, type WorldClockConfig, type WorldClockState } from '../time/worldClock';

export type CyclePeriod = 'hour' | 'day' | 'week' | 'month';

export interface CycleTick {
  period: CyclePeriod;
  /** 本次跨过的周期数（≥1）。 */
  count: number;
  /** 结算后所处周期的下标，用作幂等键。 */
  index: number;
  key: string;
}

/** 一次推进最多逐个结算这么多天，再多的天数合并成一次批量结算，避免长时间跳跃卡顿。 */
export const MAX_STEPPED_DAYS = 14;

export function crossedCycles(previous: WorldClockState | undefined, next: WorldClockState | undefined, config: WorldClockConfig): CycleTick[] {
  if (!previous || !next || next.elapsedMinutes <= previous.elapsedMinutes) return [];
  const before = getWorldClockIndices(previous, config);
  const after = getWorldClockIndices(next, config);
  const ticks: CycleTick[] = [];
  const push = (period: CyclePeriod, from: number, to: number) => {
    if (to > from) ticks.push({ period, count: to - from, index: to, key: `${period}:${to}` });
  };
  push('hour', before.hour, after.hour);
  push('day', before.day, after.day);
  push('week', before.week, after.week);
  if (after.month !== before.month) {
    const months = (Math.floor(after.month / 100) - Math.floor(before.month / 100)) * 12 + (after.month % 100) - (before.month % 100);
    if (months > 0) ticks.push({ period: 'month', count: months, index: after.month, key: `month:${after.month}` });
  }
  return ticks;
}

/** 世界配置里的周期名（「一天」「趟」「周」「回合」）映射到结算周期。 */
export function periodFromCycleName(name: string | undefined, fallback: CyclePeriod | 'turn' = 'day'): CyclePeriod | 'turn' {
  const text = (name ?? '').trim();
  if (!text) return fallback;
  if (/回合|轮/.test(text)) return 'turn';
  if (/时辰|小时|钟头/.test(text)) return 'hour';
  if (/月/.test(text)) return 'month';
  if (/周|星期|旬/.test(text)) return 'week';
  return 'day';
}
