import { describe, expect, test } from 'bun:test';
import {
  advanceWorldClock,
  advanceWorldClockForTurn,
  createWorldClock,
  estimateTurnMinutes,
  getWorldClockPeriodKeys,
  inferWorldClockConfig,
  normalizeTimeSystemConfig,
  normalizeWorldClockState,
  parseTimeAdvance,
  stripTimeAdvanceTags,
} from './worldClock';
import { getBusinessSettlementPeriodKey } from './businessPeriod';

describe('authoritative world clock', () => {
  test('handles Gregorian leap days and year boundaries', () => {
    const clock = createWorldClock({
      mode: 'gregorian',
      start: { year: 2024, month: 2, day: 28, hour: 23, minute: 30 },
    });
    const leapDay = advanceWorldClock(clock, 60);
    expect(leapDay.current).toMatchObject({ year: 2024, month: 2, day: 29, hour: 0, minute: 30 });
    const nextYear = advanceWorldClock(leapDay, 306 * 24 * 60 + 23 * 60 + 30);
    expect(nextYear.current).toMatchObject({ year: 2025, month: 1, day: 1, hour: 0, minute: 0 });
  });

  test('handles custom calendars crossing month and year', () => {
    const clock = createWorldClock({
      mode: 'custom', calendarName: '测试历',
      months: [{ name: '甲月', days: 10 }, { name: '乙月', days: 5 }],
      start: { year: 1, month: 1, day: 10, hour: 23, minute: 0 },
    });
    const nextMonth = advanceWorldClock(clock, 120);
    expect(nextMonth.current).toMatchObject({ year: 1, month: 2, day: 1, hour: 1, minute: 0 });
    const nextYear = advanceWorldClock(nextMonth, 5 * 24 * 60);
    expect(nextYear.current).toMatchObject({ year: 2, month: 1, day: 1, hour: 1, minute: 0 });
  });

  test('normalizes bad config and infers legacy configurations safely', () => {
    const normalized = normalizeTimeSystemConfig({ mode: 'custom', months: [{ name: '', days: -4 }], defaultTurnMinutes: 99999 });
    expect(normalized.months.length).toBeGreaterThan(0);
    expect(normalized.months[0].days).toBeGreaterThan(0);
    expect(normalized.defaultTurnMinutes).toBe(1440);
    expect(inferWorldClockConfig({ calendar: '余烬历', startTime: '余烬历 207 年 9 月 1 日' }).mode).toBe('custom');
    expect(inferWorldClockConfig({}).mode).toBe('relative');
  });

  test('migrates legacy current text and derives period keys', () => {
    const config = inferWorldClockConfig({ calendar: '公历', startTime: '2024年2月28日 23:30' });
    const migrated = normalizeWorldClockState({ calendar: config, current: '2024年2月29日 00:30' }, config);
    expect(migrated.elapsedMinutes).toBe(60);
    const keys = getWorldClockPeriodKeys(migrated);
    expect(keys).toMatchObject({ dayKey: 'day:2024-2-29', monthKey: 'month:2024-2' });
    expect(keys.weekKey).toMatch(/^week:\d+$/);

    const relativeConfig = inferWorldClockConfig({ calendar: '生存日数' });
    const relative = normalizeWorldClockState({ calendar: relativeConfig, current: '第 12 天 18:30' }, relativeConfig);
    expect(relative.elapsedMinutes).toBe(11 * 24 * 60 + 10 * 60 + 30);
    expect(relative.current).toMatchObject({ day: 12, hour: 18, minute: 30 });
  });

  test('parses and strips TimeAdvance, with conservative local estimates', () => {
    expect(parseTimeAdvance('<TimeAdvance>{"minutes":90,"reason":"旅行"}</TimeAdvance>')).toEqual({ minutes: 90, reason: '旅行' });
    expect(parseTimeAdvance('<TimeAdvance>{"date":"2028-01-01"}</TimeAdvance>')).toBeNull();
    expect(stripTimeAdvanceTags('正文\n<TimeAdvance>{"minutes":20}</TimeAdvance>')).toBe('正文');
    expect(estimateTurnMinutes('睡一觉')).toMatchObject({ minutes: 480 });
    expect(estimateTurnMinutes('明确等待 2 小时')).toMatchObject({ minutes: 120 });
    expect(estimateTurnMinutes('普通行动', { defaultTurnMinutes: 17 })).toMatchObject({ minutes: 17 });
  });

  test('advances a successful turn only once', () => {
    const clock = createWorldClock({ mode: 'relative', defaultTurnMinutes: 20 });
    const once = advanceWorldClockForTurn(clock, 20, { reason: '行动', source: 'local-estimate', turnId: 'ai-1', round: 1 });
    const twice = advanceWorldClockForTurn(once, 20, { reason: '重试', source: 'local-estimate', turnId: 'ai-1', round: 1 });
    expect(once.elapsedMinutes).toBe(20);
    expect(twice.elapsedMinutes).toBe(20);
  });

  test('business periods prefer structured clock keys and retain legacy fallback', () => {
    const clock = createWorldClock({ mode: 'relative', start: { year: 3, month: 4, day: 5, hour: 8, minute: 0 } });
    expect(getBusinessSettlementPeriodKey('月', 'garbage', undefined, clock)).toBe('month:3-4');
    expect(getBusinessSettlementPeriodKey('日', '第 12 天')).toBe('day:12');

    const fiveDayWeek = createWorldClock({ mode: 'custom', weekdays: ['一', '二', '三', '四', '五'] });
    const nextWeek = advanceWorldClock(fiveDayWeek, 5 * 24 * 60);
    expect(getWorldClockPeriodKeys(nextWeek).weekKey).not.toBe(getWorldClockPeriodKeys(fiveDayWeek).weekKey);
  });
});
