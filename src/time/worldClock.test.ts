import { describe, expect, test } from 'bun:test';
import {
  advanceWorldClock,
  advanceWorldClockForTurn,
  createWorldClock,
  estimateTurnMinutes,
  ensureWorldClockOnGameState,
  formatWorldClock,
  getTimeSystemFromWorld,
  getWorldClockPeriodKeys,
  inferNarrativeTimeAdvance,
  inferWorldClockConfig,
  normalizeTimeSystemConfig,
  normalizeWorldClockState,
  parseTimeAdvance,
  reconcileEditedWorldClock,
  resolveTurnTimeAdvance,
  stripTimeAdvanceTags,
  writeWorldClock,
} from './worldClock';
import { getBusinessSettlementPeriodKey } from './businessPeriod';

describe('authoritative world clock v2', () => {
  test('stores only minimal runtime state and handles Gregorian leap days', () => {
    const config = normalizeTimeSystemConfig({
      mode: 'gregorian',
      start: { year: 2024, month: 2, day: 28, hour: 23, minute: 30 },
    });
    const clock = createWorldClock(config);
    expect(clock).toEqual({ schemaVersion: 2, elapsedMinutes: 0 });

    const leapDay = advanceWorldClock(clock, config, 60);
    expect(leapDay.elapsedMinutes).toBe(60);
    expect(formatWorldClock(leapDay, config)).toContain('2024年·二月·第29日 00:30');
    const nextYear = advanceWorldClock(leapDay, config, 306 * 24 * 60 + 23 * 60 + 30);
    expect(formatWorldClock(nextYear, config)).toContain('2025年·一月·第1日 00:00');
  });

  test('handles a custom calendar crossing month and year boundaries', () => {
    const config = normalizeTimeSystemConfig({
      mode: 'custom', calendarName: '测试历',
      months: [{ name: '甲月', days: 10 }, { name: '乙月', days: 5 }],
      start: { year: 1, month: 1, day: 10, hour: 23, minute: 0 },
    });
    const nextMonth = advanceWorldClock(createWorldClock(config), config, 120);
    expect(formatWorldClock(nextMonth, config)).toContain('1年·乙月·第1日 01:00');
    const nextYear = advanceWorldClock(nextMonth, config, 5 * 24 * 60);
    expect(formatWorldClock(nextYear, config)).toContain('2年·甲月·第1日 01:00');
  });

  test('normalizes bad config and reads legacy calendar fields safely', () => {
    const normalized = normalizeTimeSystemConfig({ mode: 'custom', months: [{ name: '', days: -4 }], defaultTurnMinutes: 99999 });
    expect(normalized.months.length).toBeGreaterThan(0);
    expect(normalized.months[0].days).toBeGreaterThan(0);
    expect(normalized.defaultTurnMinutes).toBe(1440);
    expect(inferWorldClockConfig({ calendar: '余烬历', startTime: '余烬历 207 年 9 月 1 日' }).mode).toBe('custom');
    expect(inferWorldClockConfig({}).mode).toBe('relative');
  });

  test('migrates v1 current text into v2 while an explicit world-book config wins', () => {
    const config = inferWorldClockConfig({ calendar: '公历', startTime: '2024年2月28日 23:30' });
    const migrated = normalizeWorldClockState({
      schemaVersion: 1,
      calendar: config,
      current: '2024年2月29日 00:30',
      elapsedMinutes: 999,
    }, config);
    expect(migrated).toEqual(expect.objectContaining({ schemaVersion: 2, elapsedMinutes: 60 }));
    expect('calendar' in migrated).toBe(false);
    expect('current' in migrated).toBe(false);

    const relativeConfig = inferWorldClockConfig({ calendar: '生存日数' });
    const relative = normalizeWorldClockState({ calendar: relativeConfig, current: '第 12 天 18:30' });
    expect(relative.elapsedMinutes).toBe(11 * 24 * 60 + 10 * 60 + 30);
    expect(formatWorldClock(relative, relativeConfig)).toContain('生存日数·第12日 18:30');
  });

  test('migrates a legacy display-only game state into the v2 cursor', () => {
    const config = normalizeTimeSystemConfig({
      mode: 'relative', calendarName: '生存日数',
      start: { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
    });
    const state = { 世界: { 时间系统: { 当前时间: '生存日数·第5日 22:00', 当前天气: '' } } } as any;
    ensureWorldClockOnGameState(state, {
      worldBookEntries: [{ entryType: 'setting', meta: { timeSystem: config } }],
    } as any);
    expect(state.世界.时间系统.时钟).toEqual(expect.objectContaining({ schemaVersion: 2, elapsedMinutes: 4 * 1_440 + 16 * 60 }));
    expect(formatWorldClock(state.世界.时间系统.时钟, config)).toContain('生存日数·第5日 22:00');
  });

  test('uses a v1 clock calendar as migration fallback and persists it into the world book', () => {
    const legacyConfig = normalizeTimeSystemConfig({
      mode: 'custom', calendarName: '旧历', eraName: '旧纪元',
      start: { year: 7, month: 2, day: 3, hour: 8, minute: 0 },
    });
    const world = { worldBookEntries: [{ entryType: 'economy', meta: { calendar: '旧历' } }] } as any;
    const state = { 世界: { 时间系统: { 当前时间: '', 当前天气: '', 时钟: { schemaVersion: 1, calendar: legacyConfig, current: { year: 7, month: 2, day: 4, hour: 9, minute: 0 } } } } } as any;
    ensureWorldClockOnGameState(state, world);
    expect(world.worldBookEntries[0].meta.timeSystem).toMatchObject({ calendarName: '旧历', start: legacyConfig.start });
    expect(state.世界.时间系统.时钟.elapsedMinutes).toBe(1_500);
  });

  test('reads timeSystem from any world-book entry, not only economy', () => {
    const world = {
      worldBookEntries: [
        { entryType: 'setting', meta: { timeSystem: { mode: 'custom', calendarName: '星历', months: [{ name: '星月', days: 20 }] } } },
        { entryType: 'economy', meta: { calendar: '公历', startTime: '2020年1月1日' } },
      ],
    } as any;
    const config = getTimeSystemFromWorld(world);
    expect(config.mode).toBe('custom');
    expect(config.calendarName).toBe('星历');
    expect(config.months[0]).toEqual({ name: '星月', days: 20 });
  });

  test('parses and strips TimeAdvance without allowing a default turn to move prose', () => {
    expect(parseTimeAdvance('<TimeAdvance>{"minutes":90,"reason":"旅行"}</TimeAdvance>')).toEqual({ minutes: 90, reason: '旅行' });
    expect(parseTimeAdvance('<TimeAdvance>{"minutes":0,"reason":"只是一瞬"}</TimeAdvance>')).toEqual({ minutes: 0, reason: '只是一瞬' });
    expect(parseTimeAdvance('<TimeAdvance>{"date":"2028-01-01"}</TimeAdvance>')).toBeNull();
    expect(stripTimeAdvanceTags('正文\n<TimeAdvance>{"minutes":20}</TimeAdvance>')).toBe('正文');
    const config = normalizeTimeSystemConfig({ mode: 'relative', defaultTurnMinutes: 17 });
    expect(estimateTurnMinutes('明确等待 2 小时', config)).toMatchObject({ minutes: 120 });
    expect(resolveTurnTimeAdvance({
      rawResponse: '<contenttext>你看向窗外，雨仍在下。</contenttext>',
      narrativeText: '你看向窗外，雨仍在下。',
      userText: '看看窗外',
      clock: createWorldClock(config),
      config,
    })).toBeNull();
  });

  test('resolves “第二天早晨 + 睡醒” as one next-morning endpoint', () => {
    const config = normalizeTimeSystemConfig({
      mode: 'relative',
      start: { year: 1, month: 1, day: 5, hour: 22, minute: 0 },
    });
    const inference = inferNarrativeTimeAdvance('第二天早晨，你从睡梦中醒来。', createWorldClock(config), config);
    expect(inference).toMatchObject({ minutes: 10 * 60, targetPhase: 'morning', dayOffset: 1 });
  });

  test('does not double-count overlapping scene cues', () => {
    const config = normalizeTimeSystemConfig({ mode: 'relative', start: { year: 1, month: 1, day: 1, hour: 18, minute: 0 } });
    expect(inferNarrativeTimeAdvance('他们吃过晚饭便睡下。一觉醒来，晨光已经照进窗内。', createWorldClock(config), config)).toMatchObject({
      minutes: 11 * 60,
      targetPhase: 'dawn',
      dayOffset: 1,
    });
    const noonConfig = normalizeTimeSystemConfig({ ...config, start: { ...config.start, hour: 12, minute: 0 } });
    expect(inferNarrativeTimeAdvance('吃完中饭后，众人继续赶路。夕阳渐渐西斜，街灯亮起；入夜时他们进城。', createWorldClock(noonConfig), noonConfig)).toMatchObject({
      minutes: 9 * 60,
      targetPhase: 'night',
    });
    expect(inferNarrativeTimeAdvance('第二天早晨出发，随后到了黄昏。', createWorldClock(config), config)).toMatchObject({
      minutes: 24 * 60,
      targetPhase: 'dusk',
      dayOffset: 1,
    });
  });

  test('sums only explicitly sequential continuous durations', () => {
    const config = normalizeTimeSystemConfig({ mode: 'relative', start: { year: 1, month: 1, day: 1, hour: 8, minute: 0 } });
    expect(inferNarrativeTimeAdvance('两小时后，他们抵达山脚。又过了三小时，队伍终于翻过山口。', createWorldClock(config), config)).toMatchObject({ minutes: 5 * 60 });
    expect(inferNarrativeTimeAdvance('第二天早晨，从睡梦中醒来。', createWorldClock(config), config)).toMatchObject({ minutes: 24 * 60 });
  });

  test('ignores plans, dialogue, and remembered future/past time references', () => {
    const config = normalizeTimeSystemConfig({ mode: 'relative', start: { year: 1, month: 1, day: 1, hour: 12, minute: 0 } });
    const clock = createWorldClock(config);
    expect(inferNarrativeTimeAdvance('她说：“明天上午再来吧。”他想起昨夜的月色。', clock, config)).toBeNull();
    expect(inferNarrativeTimeAdvance('他说明第二天上午会再来，并没有离开。', clock, config)).toBeNull();
    expect(resolveTurnTimeAdvance({
      rawResponse: '<contenttext>他继续看着窗外。</contenttext>',
      narrativeText: '他继续看着窗外。',
      userText: '等待2小时',
      clock,
      config,
    })).toBeNull();
  });

  test('rejects unsupported model multi-day jumps without explicit evidence', () => {
    const config = normalizeTimeSystemConfig({ mode: 'relative' });
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":4320,"reason":"剧情自然推进"}</TimeAdvance>',
      narrativeText: '他继续观察四周，没有发生时间转场。',
      userText: '继续',
      clock: createWorldClock(config),
      config,
    })).toBeNull();
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":4320,"reason":"明确经过三天赶路","evidence":"三天连续赶路"}</TimeAdvance>',
      narrativeText: '旅程历时三天，终于抵达目的地。',
      userText: '继续',
      clock: createWorldClock(config),
      config,
    })).toMatchObject({ minutes: 4320, source: 'ai' });
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":4320,"reason":"经过三天","evidence":"连续行动"}</TimeAdvance>',
      narrativeText: '他连续观察周围，始终没有离开原地。',
      userText: '继续',
      clock: createWorldClock(config),
      config,
    })).toBeNull();
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":4320,"reason":"三天后","evidence":"模型判断"}</TimeAdvance>',
      narrativeText: '他抵达目的地。',
      userText: '继续',
      clock: createWorldClock(config),
      config,
    })).toBeNull();
  });

  test('accepts model-only implicit judgment only with concrete evidence', () => {
    const config = normalizeTimeSystemConfig({ mode: 'relative' });
    const clock = createWorldClock(config);
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":60,"reason":"自然经过一小时"}</TimeAdvance>',
      narrativeText: '两人继续站在原地交谈。',
      userText: '继续',
      clock,
      config,
    })).toBeNull();
    expect(resolveTurnTimeAdvance({
      rawResponse: '<TimeAdvance>{"minutes":45,"reason":"长谈结束","evidence":"两人结束了持续交谈"}</TimeAdvance>',
      narrativeText: '两人终于结束长谈，整理好各自的结论。',
      userText: '继续',
      clock,
      config,
    })).toMatchObject({ minutes: 45, source: 'ai' });
  });

  test('treats a relative calendar day label as an absolute day and keeps naps non-overnight', () => {
    const relativeConfig = normalizeTimeSystemConfig({ mode: 'relative', start: { year: 1, month: 1, day: 1, hour: 8, minute: 0 } });
    const dayFive = normalizeWorldClockState({ schemaVersion: 2, elapsedMinutes: 4 * 1_440 }, relativeConfig);
    expect(inferNarrativeTimeAdvance('第6日，队伍继续前进。', dayFive, relativeConfig)).toMatchObject({ minutes: 1_440 });

    const noonConfig = normalizeTimeSystemConfig({ mode: 'relative', start: { year: 1, month: 1, day: 1, hour: 13, minute: 0 } });
    expect(inferNarrativeTimeAdvance('午睡后醒来。', createWorldClock(noonConfig), noonConfig)).toMatchObject({ minutes: 60 });
    expect(inferNarrativeTimeAdvance('准备睡下，但尚未入睡。', createWorldClock(noonConfig), noonConfig)).toBeNull();
  });

  test('uses calendarName as the custom era display fallback', () => {
    const config = normalizeTimeSystemConfig({ mode: 'custom', calendarName: '星历', eraName: '', start: { year: 1, month: 1, day: 1, hour: 8, minute: 0 } });
    expect(formatWorldClock(createWorldClock(config), config)).toContain('星历 1年');
  });

  test('uses one write entry for manual edits and preserves turn idempotency', () => {
    const config = normalizeTimeSystemConfig({ mode: 'gregorian', start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 } });
    const clock = createWorldClock(config);
    const edited = reconcileEditedWorldClock(clock, config, '2026年8月2日上午9点');
    expect(edited.elapsedMinutes).toBe(18 * 60);
    expect(formatWorldClock(edited, config)).toContain('2026年·八月·第2日 09:00');

    const once = writeWorldClock(edited, config, {
      deltaMinutes: 20, reason: '行动', source: 'local-estimate', turnId: 'ai-1', round: 1,
    });
    const twice = advanceWorldClockForTurn(once, config, 20, { reason: '重试', source: 'local-estimate', turnId: 'ai-1', round: 1 });
    expect(once.elapsedMinutes).toBe(18 * 60 + 20);
    expect(twice.elapsedMinutes).toBe(once.elapsedMinutes);
  });

  test('derives period keys only from config plus elapsed state', () => {
    const config = normalizeTimeSystemConfig({ mode: 'custom', calendarName: '五日历', weekdays: ['一', '二', '三', '四', '五'], start: { year: 3, month: 4, day: 5, hour: 8, minute: 0 } });
    const clock = advanceWorldClock(createWorldClock(config), config, 5 * 24 * 60);
    const keys = getWorldClockPeriodKeys(clock, config);
    expect(keys.monthKey).toBe('month:3-4');
    expect(keys.weekKey).not.toBe(getWorldClockPeriodKeys(createWorldClock(config), config).weekKey);
    expect(getBusinessSettlementPeriodKey('月', 'garbage', undefined, clock, config)).toBe('month:3-4');
  });
});
