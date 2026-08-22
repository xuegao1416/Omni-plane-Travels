import { describe, expect, test } from 'bun:test';
import {
  advanceWorldClock,
  advanceWorldClockForTurn,
  createWorldClock,
  estimateTurnMinutes,
  formatWorldClock,
  getWorldClockPeriodKeys,
  inferNarrativeTimeAdvance,
  inferWorldClockConfig,
  normalizeTimeSystemConfig,
  normalizeWorldClockState,
  parseTimeAdvance,
  reconcileEditedWorldClock,
  resolveTurnTimeAdvance,
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

  test('parses and strips TimeAdvance, including an explicit zero-minute turn', () => {
    expect(parseTimeAdvance('<TimeAdvance>{"minutes":90,"reason":"旅行"}</TimeAdvance>')).toEqual({ minutes: 90, reason: '旅行' });
    expect(parseTimeAdvance('<TimeAdvance>{"minutes":0,"reason":"只是一瞬"}</TimeAdvance>')).toEqual({ minutes: 0, reason: '只是一瞬' });
    expect(parseTimeAdvance('<TimeAdvance>{"date":"2028-01-01"}</TimeAdvance>')).toBeNull();
    expect(stripTimeAdvanceTags('正文\n<TimeAdvance>{"minutes":20}</TimeAdvance>')).toBe('正文');
    expect(estimateTurnMinutes('睡一觉')).toMatchObject({ minutes: 480 });
    expect(estimateTurnMinutes('明确等待 2 小时')).toMatchObject({ minutes: 120 });
    expect(estimateTurnMinutes('普通行动', { defaultTurnMinutes: 17 })).toMatchObject({ minutes: 17 });
  });

  test('does not mechanically advance an ambiguous turn when the model omits time metadata', () => {
    const clock = createWorldClock({ mode: 'relative', defaultTurnMinutes: 60 });
    expect(resolveTurnTimeAdvance({
      rawResponse: '<contenttext>你看向窗外，雨仍在下。</contenttext>',
      narrativeText: '你看向窗外，雨仍在下。',
      userText: '看看窗外',
      clock,
    })).toBeNull();
    expect(resolveTurnTimeAdvance({
      rawResponse: '<contenttext>你在门边等候。</contenttext>',
      narrativeText: '你在门边等候。',
      userText: '明确等待 2 小时',
      clock,
    })).toMatchObject({ minutes: 120, source: 'player-explicit' });
    expect(resolveTurnTimeAdvance({
      rawResponse: '<contenttext>他没有回答。</contenttext>',
      narrativeText: '他没有回答。',
      userText: '我们要不要等待 2 小时？',
      clock,
    })).toBeNull();
  });

  test('uses a semantic phase anchor from the model instead of a mechanical minute guess', () => {
    const clock = createWorldClock({
      mode: 'relative',
      start: { year: 1, month: 1, day: 1, hour: 12, minute: 0 },
    });
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":60,"targetPhase":"dusk","dayOffset":0,"reason":"暮色降临"}</TimeAdvance>',
      narrativeText: '众人收拾好桌面，准备继续商议。',
      userText: '继续',
      clock,
    })).toMatchObject({ minutes: 6 * 60, source: 'ai' });
  });

  test('follows environmental phase changes through the end of a multi-scene response', () => {
    const clock = createWorldClock({
      mode: 'relative',
      start: { year: 1, month: 1, day: 1, hour: 12, minute: 0 },
    });
    expect(inferNarrativeTimeAdvance(
      '吃完中饭后，众人继续赶路。夕阳渐渐西斜，街灯逐一亮起；等他们进城时，已经入夜。',
      clock,
    )).toMatchObject({ minutes: 9 * 60 });
  });

  test('carries a completed sleep scene into the following morning', () => {
    const clock = createWorldClock({
      mode: 'relative',
      start: { year: 1, month: 1, day: 1, hour: 18, minute: 0 },
    });
    expect(inferNarrativeTimeAdvance('他们吃过晚饭便睡下。一觉醒来，晨光已经照进窗内。', clock)).toMatchObject({
      minutes: 14 * 60,
    });
  });

  test('accumulates multiple completed relative durations in narrative order', () => {
    const clock = createWorldClock({
      mode: 'relative',
      start: { year: 1, month: 1, day: 1, hour: 8, minute: 0 },
    });
    expect(inferNarrativeTimeAdvance('两小时后，他们抵达山脚。又过了三小时，队伍终于翻过山口。', clock)).toMatchObject({
      minutes: 5 * 60,
    });
  });

  test('uses a completed meal as a soft fallback but ignores quoted or remembered time', () => {
    const clock = createWorldClock({
      mode: 'relative',
      start: { year: 1, month: 1, day: 1, hour: 12, minute: 0 },
    });
    expect(inferNarrativeTimeAdvance('两人吃完中饭，结账走出餐馆。', clock)).toMatchObject({ minutes: 30 });
    expect(inferNarrativeTimeAdvance('她说：“今晚再来吧。”他却想起昨夜的月色。', clock)).toBeNull();
  });

  test('infers a forward day-part jump when a lightweight model omits TimeAdvance', () => {
    const clock = createWorldClock({
      mode: 'relative',
      start: { year: 1, month: 1, day: 1, hour: 15, minute: 0 },
    });
    expect(inferNarrativeTimeAdvance('一夜过去。第二天上午，你在门外醒来。', clock)).toMatchObject({
      minutes: 17 * 60,
    });
    expect(inferNarrativeTimeAdvance('他说明第二天上午会再来，并没有离开。', clock)).toBeNull();
  });

  test('reconciles a manual display edit into the structured clock', () => {
    const clock = createWorldClock({
      mode: 'gregorian',
      start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 },
    });
    const edited = reconcileEditedWorldClock(clock, '2026年8月2日上午9点');
    expect(edited.current).toMatchObject({ year: 2026, month: 8, day: 2, hour: 9, minute: 0 });
    expect(edited.elapsedMinutes).toBe(18 * 60);
  });

  test('round-trips the formatted clock text when a player edits only its time', () => {
    const clock = advanceWorldClock(createWorldClock({
      mode: 'gregorian',
      start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 },
    }), 18 * 60);
    const editedDisplay = formatWorldClock(clock).replace('09:00', '17:04');
    const edited = reconcileEditedWorldClock(clock, editedDisplay);
    expect(edited.current).toMatchObject({ year: 2026, month: 8, day: 2, hour: 17, minute: 4 });
    expect(reconcileEditedWorldClock(clock, '17:04').current).toMatchObject({
      year: 2026, month: 8, day: 2, hour: 17, minute: 4,
    });
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
