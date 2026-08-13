import type { WorldDef, WorldBookEntryMeta } from '../data/worlds-schema';

export const WORLD_CLOCK_SCHEMA_VERSION = 1;
// Ten years is a hard safety ceiling while still allowing explicit long skips.
export const MAX_TIME_ADVANCE_MINUTES = 5_256_000;

export type WorldClockMode = 'gregorian' | 'custom' | 'relative';

export interface WorldClockDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface WorldClockMonth {
  name: string;
  days: number;
}

export interface WorldClockTimeOfDayLabel {
  name: string;
  startMinute: number;
  endMinute?: number;
}

export interface WorldClockConfig {
  mode: WorldClockMode;
  calendarName: string;
  eraName: string;
  start: WorldClockDate;
  months: WorldClockMonth[];
  weekdays: string[];
  defaultTurnMinutes: number;
  timeOfDayLabels: WorldClockTimeOfDayLabel[];
}

export interface WorldClockAdvanceMetadata {
  minutes: number;
  reason: string;
  source: 'ai' | 'local-estimate' | 'manual';
  turnId?: string;
  round?: number;
}

export interface WorldClockState {
  schemaVersion: number;
  calendar: WorldClockConfig;
  current: WorldClockDate;
  elapsedMinutes: number;
  lastAdvancedTurnId?: string;
  lastAdvancedRound?: number;
  recentAdvance?: WorldClockAdvanceMetadata;
  /** Original non-parseable display retained only as migration evidence. */
  legacyDisplay?: string;
}

export interface TimeAdvanceSuggestion {
  minutes: number;
  reason: string;
}

export interface WorldClockPeriodKeys {
  dayKey: string;
  weekKey: string;
  monthKey: string;
}

const GREGORIAN_MONTHS: WorldClockMonth[] = [
  { name: '一月', days: 31 }, { name: '二月', days: 28 }, { name: '三月', days: 31 },
  { name: '四月', days: 30 }, { name: '五月', days: 31 }, { name: '六月', days: 30 },
  { name: '七月', days: 31 }, { name: '八月', days: 31 }, { name: '九月', days: 30 },
  { name: '十月', days: 31 }, { name: '十一月', days: 30 }, { name: '十二月', days: 31 },
];

const DEFAULT_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const DEFAULT_TIME_OF_DAY_LABELS: WorldClockTimeOfDayLabel[] = [
  { name: '深夜', startMinute: 0 },
  { name: '清晨', startMinute: 5 * 60 },
  { name: '上午', startMinute: 8 * 60 },
  { name: '正午', startMinute: 12 * 60 },
  { name: '下午', startMinute: 13 * 60 },
  { name: '黄昏', startMinute: 18 * 60 },
  { name: '夜晚', startMinute: 21 * 60 },
];

const DEFAULT_CUSTOM_MONTHS = Array.from({ length: 12 }, (_, index) => ({
  name: `第${index + 1}月`,
  days: 30,
}));

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function monthDays(config: WorldClockConfig, year: number, month: number): number {
  const entry = config.months[month - 1] ?? config.months[0];
  if (config.mode === 'gregorian' && month === 2 && isLeapYear(year)) return 29;
  return entry?.days ?? 30;
}

function totalDaysInYear(config: WorldClockConfig, year: number): number {
  return config.months.reduce((sum, month, index) => {
    if (config.mode === 'gregorian' && index === 1 && isLeapYear(year)) return sum + 29;
    return sum + month.days;
  }, 0);
}

function daysBeforeYear(config: WorldClockConfig, year: number): number {
  const years = Math.max(0, year - 1);
  if (config.mode === 'gregorian') {
    return years * 365 + Math.floor(years / 4) - Math.floor(years / 100) + Math.floor(years / 400);
  }
  return years * config.months.reduce((sum, month) => sum + month.days, 0);
}

function dateToDayNumber(config: WorldClockConfig, date: WorldClockDate): number {
  let days = daysBeforeYear(config, date.year);
  for (let month = 1; month < date.month; month += 1) days += monthDays(config, date.year, month);
  return days + date.day - 1;
}

function maxElapsedMinutesForCalendar(config: WorldClockConfig): number {
  const startMinutes = dateToDayNumber(config, config.start) * 1_440 + config.start.hour * 60 + config.start.minute;
  const endExclusiveMinutes = daysBeforeYear(config, 1_000_000) * 1_440;
  return Math.max(0, endExclusiveMinutes - startMinutes - 1);
}

function dayNumberToDate(config: WorldClockConfig, dayNumber: number): Pick<WorldClockDate, 'year' | 'month' | 'day'> {
  let remaining = Math.max(0, Math.trunc(dayNumber));
  let low = 1;
  let high = config.mode === 'gregorian'
    ? Math.max(2, Math.floor(remaining / 365) + 2)
    : Math.max(2, Math.floor(remaining / totalDaysInYear(config, 1)) + 2);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (daysBeforeYear(config, middle) <= remaining) low = middle;
    else high = middle - 1;
  }
  const year = low;
  remaining -= daysBeforeYear(config, year);
  let month = 1;
  while (remaining >= monthDays(config, year, month)) {
    remaining -= monthDays(config, year, month);
    month += 1;
  }
  return { year, month, day: remaining + 1 };
}

function normalizeDate(config: WorldClockConfig, raw: unknown, fallback: WorldClockDate): WorldClockDate {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const year = finiteInt(value.year, fallback.year, 1, 999_999);
  const month = finiteInt(value.month, fallback.month, 1, config.months.length);
  const day = finiteInt(value.day, fallback.day, 1, monthDays(config, year, month));
  return {
    year,
    month,
    day,
    hour: finiteInt(value.hour, fallback.hour, 0, 23),
    minute: finiteInt(value.minute, fallback.minute, 0, 59),
  };
}

function normalizeMonths(mode: WorldClockMode, raw: unknown): WorldClockMonth[] {
  // Gregorian arithmetic below assumes the canonical month lengths. Allowing an
  // AI/editor supplied 30-day "Gregorian" year would make day-number conversion
  // disagree with leap-year and year-boundary calculations.
  if (mode === 'gregorian') return GREGORIAN_MONTHS.map(month => ({ ...month }));
  const source = Array.isArray(raw) ? raw : [];
  const fallback = DEFAULT_CUSTOM_MONTHS;
  const months = source.map((item, index) => {
    const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : fallback[index]?.name || `第${index + 1}月`,
      days: finiteInt(value.days, fallback[index]?.days || 30, 1, 400),
    };
  }).filter(month => month.days > 0);
  return months.length >= 1 ? months.slice(0, 24) : fallback.map(month => ({ ...month }));
}

function normalizeTimeOfDayLabels(raw: unknown): WorldClockTimeOfDayLabel[] {
  const source = Array.isArray(raw) ? raw : [];
  const labels = source.map(item => {
    const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      name: typeof value.name === 'string' ? value.name.trim() : '',
      startMinute: finiteInt(value.startMinute, 0, 0, 1_439),
      endMinute: value.endMinute == null ? undefined : finiteInt(value.endMinute, 1_439, 0, 1_439),
    };
  }).filter(label => label.name);
  return labels.length > 0 ? labels.sort((a, b) => a.startMinute - b.startMinute) : DEFAULT_TIME_OF_DAY_LABELS.map(label => ({ ...label }));
}

export function normalizeTimeSystemConfig(input?: Partial<WorldClockConfig> | null): WorldClockConfig {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const mode: WorldClockMode = source.mode === 'custom' || source.mode === 'relative' ? source.mode : 'gregorian';
  const months = normalizeMonths(mode, source.months);
  const provisional: WorldClockConfig = {
    mode,
    calendarName: typeof source.calendarName === 'string' && source.calendarName.trim()
      ? source.calendarName.trim()
      : mode === 'gregorian' ? '公历' : mode === 'relative' ? '旅历' : '自定义历法',
    eraName: typeof source.eraName === 'string' && source.eraName.trim() ? source.eraName.trim() : '',
    start: { year: 1, month: 1, day: 1, hour: 8, minute: 0 },
    months,
    weekdays: Array.isArray(source.weekdays) && source.weekdays.some(value => typeof value === 'string' && value.trim())
      ? source.weekdays.map(value => String(value).trim()).filter(Boolean).slice(0, 14)
      : [...DEFAULT_WEEKDAYS],
    defaultTurnMinutes: finiteInt(source.defaultTurnMinutes, 30, 1, 1_440),
    timeOfDayLabels: normalizeTimeOfDayLabels(source.timeOfDayLabels),
  };
  provisional.start = normalizeDate(provisional, source.start, provisional.start);
  return provisional;
}

function parseDateText(text: string): Partial<WorldClockDate> {
  const yearMatch = text.match(/(?:公元前\s*)?(\d{1,6})\s*(?:年|[-/])/);
  const monthMatch = text.match(/(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])/);
  const dayMatch = text.match(/(?:月|[-/])\s*(\d{1,2})\s*(?:日|号)?/);
  const timeMatch = text.match(/(?:T|\s|午前|下午|上午|凌晨|清晨)(\d{1,2})\s*(?::|点|时)\s*(\d{0,2})/);
  const hourOnlyMatch = text.match(/(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|深夜)\s*(\d{1,2})?\s*(?:点|时)?/);
  const result: Partial<WorldClockDate> = {};
  if (yearMatch) result.year = Number(yearMatch[1]);
  if (monthMatch) result.month = Number(monthMatch[1]);
  if (dayMatch) result.day = Number(dayMatch[1]);
  if (timeMatch) {
    result.hour = Number(timeMatch[1]);
    result.minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  } else if (hourOnlyMatch?.[1]) {
    result.hour = Number(hourOnlyMatch[1]);
    result.minute = 0;
  }
  if (/(下午|傍晚|晚上)/.test(text) && result.hour != null && result.hour < 12) result.hour += 12;
  return result;
}

function inferMode(calendar: string): WorldClockMode {
  if (/生存日数|旅历|相对|relative/i.test(calendar)) return 'relative';
  if (/公历|格里高利|gregorian|solar/i.test(calendar)) return 'gregorian';
  return calendar.trim() ? 'custom' : 'relative';
}

export interface LegacyTimeInputs {
  calendar?: string;
  startTime?: string;
  timeSpeed?: string;
  timePeriod?: string;
  timeSystem?: Partial<WorldClockConfig>;
}

export function inferWorldClockConfig(input: LegacyTimeInputs = {}): WorldClockConfig {
  const calendar = input.calendar?.trim() || '';
  const mode = input.timeSystem?.mode || inferMode(calendar);
  const parsed = parseDateText(`${input.startTime || ''} ${input.timePeriod || ''}`);
  return normalizeTimeSystemConfig({
    ...input.timeSystem,
    mode,
    calendarName: input.timeSystem?.calendarName || calendar || (mode === 'relative' ? '旅历' : undefined),
    eraName: input.timeSystem?.eraName || (calendar && mode !== 'gregorian' ? calendar : ''),
    start: input.timeSystem?.start
      ? { ...parsed, ...input.timeSystem.start }
      : parsed as WorldClockConfig['start'],
    defaultTurnMinutes: input.timeSystem?.defaultTurnMinutes || (/实时|同步|1:1/i.test(input.timeSpeed || '') ? 20 : undefined),
  });
}

function parseLegacyCurrent(config: WorldClockConfig, text: string): WorldClockDate | null {
  if (config.mode === 'relative') {
    const relativeDay = text.match(/(?:第\s*)?(\d{1,9})\s*(?:天|日)/);
    if (relativeDay) {
      const dayOffset = Math.max(0, Number(relativeDay[1]) - 1);
      const parsedTime = parseDateText(text);
      const date = addMinutesToDate(config, config.start, dayOffset * 1_440);
      return normalizeDate(config, {
        ...date,
        hour: parsedTime.hour ?? date.hour,
        minute: parsedTime.minute ?? date.minute,
      }, date);
    }
  }
  const parsed = parseDateText(text);
  if (parsed.year == null && parsed.month == null && parsed.day == null) return null;
  return normalizeDate(config, parsed, config.start);
}

export function createWorldClock(configInput?: Partial<WorldClockConfig>): WorldClockState {
  const calendar = normalizeTimeSystemConfig(configInput);
  return {
    schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
    calendar,
    current: { ...calendar.start },
    elapsedMinutes: 0,
  };
}

export function normalizeWorldClockState(raw: unknown, fallbackConfig?: Partial<WorldClockConfig>): WorldClockState {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sourceCalendar = source.calendar && typeof source.calendar === 'object'
    ? source.calendar as Partial<WorldClockConfig>
    : undefined;
  const calendar = normalizeTimeSystemConfig(sourceCalendar ? {
    ...fallbackConfig,
    ...sourceCalendar,
    start: sourceCalendar.start ?? fallbackConfig?.start,
    months: sourceCalendar.months ?? fallbackConfig?.months,
    weekdays: sourceCalendar.weekdays ?? fallbackConfig?.weekdays,
    timeOfDayLabels: sourceCalendar.timeOfDayLabels ?? fallbackConfig?.timeOfDayLabels,
  } : fallbackConfig);
  const rawElapsed = Number(source.elapsedMinutes);
  const rawCurrent = source.current;
  const structuredCurrent = rawCurrent && typeof rawCurrent === 'object'
    ? normalizeDate(calendar, rawCurrent, calendar.start)
    : null;
  const legacyCurrent = typeof rawCurrent === 'string'
    ? parseLegacyCurrent(calendar, rawCurrent)
    : typeof source.currentTime === 'string'
      ? parseLegacyCurrent(calendar, source.currentTime)
      : structuredCurrent;
  const derivedElapsed = legacyCurrent
    ? Math.max(0, Math.round((dateToDayNumber(calendar, legacyCurrent) - dateToDayNumber(calendar, calendar.start)) * 1_440
      + (legacyCurrent.hour - calendar.start.hour) * 60 + legacyCurrent.minute - calendar.start.minute))
    : 0;
  const hasRawElapsed = source.elapsedMinutes !== null
    && source.elapsedMinutes !== undefined
    && source.elapsedMinutes !== '';
  const elapsedMinutes = hasRawElapsed && Number.isFinite(rawElapsed) && rawElapsed >= 0
    ? Math.min(Math.floor(rawElapsed), maxElapsedMinutesForCalendar(calendar))
    : Math.min(derivedElapsed, maxElapsedMinutesForCalendar(calendar));
  const current = addMinutesToDate(calendar, calendar.start, elapsedMinutes);
  const lastAdvance = source.recentAdvance as Record<string, unknown> | undefined;
  return {
    schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
    calendar,
    current,
    elapsedMinutes,
    lastAdvancedTurnId: typeof source.lastAdvancedTurnId === 'string' ? source.lastAdvancedTurnId : undefined,
    lastAdvancedRound: source.lastAdvancedRound !== null && source.lastAdvancedRound !== undefined && Number.isFinite(Number(source.lastAdvancedRound))
      ? Math.max(0, Math.trunc(Number(source.lastAdvancedRound)))
      : undefined,
    recentAdvance: lastAdvance && typeof lastAdvance === 'object' ? {
      minutes: finiteInt(lastAdvance.minutes, 0, 0, MAX_TIME_ADVANCE_MINUTES),
      reason: typeof lastAdvance.reason === 'string' ? lastAdvance.reason.slice(0, 200) : '',
      source: lastAdvance.source === 'ai' || lastAdvance.source === 'manual' ? lastAdvance.source : 'local-estimate',
      turnId: typeof lastAdvance.turnId === 'string' ? lastAdvance.turnId : undefined,
      round: lastAdvance.round !== null && lastAdvance.round !== undefined && Number.isFinite(Number(lastAdvance.round))
        ? Math.trunc(Number(lastAdvance.round))
        : undefined,
    } : undefined,
    legacyDisplay: typeof source.legacyDisplay === 'string' && source.legacyDisplay.trim()
      ? source.legacyDisplay.trim().slice(0, 300)
      : typeof rawCurrent === 'string' && rawCurrent.trim() && !legacyCurrent
        ? rawCurrent.trim().slice(0, 300)
        : undefined,
  };
}

export function addMinutesToDate(configInput: WorldClockConfig, dateInput: WorldClockDate, minutes: number): WorldClockDate {
  const config = normalizeTimeSystemConfig(configInput);
  const date = normalizeDate(config, dateInput, config.start);
  const maxAbsoluteMinute = daysBeforeYear(config, 1_000_000) * 1_440 - 1;
  const totalMinutes = Math.min(
    maxAbsoluteMinute,
    dateToDayNumber(config, date) * 1_440 + date.hour * 60 + date.minute + Math.max(0, Math.trunc(minutes)),
  );
  const dayNumber = Math.floor(totalMinutes / 1_440);
  const day = dayNumberToDate(config, dayNumber);
  const minuteOfDay = totalMinutes % 1_440;
  return { ...day, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
}

export function advanceWorldClock(
  raw: WorldClockState,
  minutesInput: number,
  metadata?: Omit<WorldClockAdvanceMetadata, 'minutes'>,
): WorldClockState {
  const clock = normalizeWorldClockState(raw);
  const minutes = finiteInt(minutesInput, 0, 0, MAX_TIME_ADVANCE_MINUTES);
  if (minutes <= 0) return clock;
  const elapsedMinutes = Math.min(clock.elapsedMinutes + minutes, maxElapsedMinutesForCalendar(clock.calendar));
  if (elapsedMinutes <= clock.elapsedMinutes) return clock;
  return {
    ...clock,
    current: addMinutesToDate(clock.calendar, clock.calendar.start, elapsedMinutes),
    elapsedMinutes,
    lastAdvancedTurnId: metadata?.turnId ?? clock.lastAdvancedTurnId,
    lastAdvancedRound: metadata?.round ?? clock.lastAdvancedRound,
    recentAdvance: { minutes, reason: metadata?.reason || '本轮行动', source: metadata?.source || 'manual', turnId: metadata?.turnId, round: metadata?.round },
  };
}

export function advanceWorldClockForTurn(
  raw: WorldClockState,
  minutesInput: number,
  metadata: Omit<WorldClockAdvanceMetadata, 'minutes'>,
): WorldClockState {
  const clock = normalizeWorldClockState(raw);
  if (
    (metadata.turnId && clock.lastAdvancedTurnId === metadata.turnId)
    || (metadata.round != null && clock.lastAdvancedRound === metadata.round)
  ) return clock;
  return advanceWorldClock(clock, minutesInput, metadata);
}

export function formatWorldClock(clockInput: WorldClockState): string {
  const clock = normalizeWorldClockState(clockInput);
  const { calendar, current } = clock;
  const month = calendar.months[current.month - 1]?.name || `第${current.month}月`;
  const weekdayIndex = calendar.mode === 'gregorian'
    ? (dateToDayNumber(calendar, current) + 1) % 7
    : dateToDayNumber(calendar, current) % calendar.weekdays.length;
  const weekday = calendar.weekdays[weekdayIndex] || `第${weekdayIndex + 1}日`;
  const timeOfDay = [...calendar.timeOfDayLabels].reverse().find(label => current.hour * 60 + current.minute >= label.startMinute)?.name || '';
  const eraLabel = calendar.eraName || (calendar.mode === 'custom' ? calendar.calendarName : '');
  const era = eraLabel ? `${eraLabel} ` : '';
  const datePart = calendar.mode === 'relative'
    ? `${calendar.calendarName}·第${dateToDayNumber(calendar, current) - dateToDayNumber(calendar, calendar.start) + 1}日`
    : `${era}${current.year}年·${month}·第${current.day}日`;
  return `${datePart} ${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}·${weekday}${timeOfDay ? `·${timeOfDay}` : ''}`;
}

export function getWorldClockPeriodKeys(clockInput: WorldClockState): WorldClockPeriodKeys {
  const clock = normalizeWorldClockState(clockInput);
  const { current } = clock;
  const dayNumber = dateToDayNumber(clock.calendar, current);
  const daysPerWeek = Math.max(1, clock.calendar.weekdays.length);
  return {
    dayKey: `day:${current.year}-${current.month}-${current.day}`,
    weekKey: `week:${Math.floor(dayNumber / daysPerWeek)}`,
    monthKey: `month:${current.year}-${current.month}`,
  };
}

export function parseTimeAdvance(rawText: string): TimeAdvanceSuggestion | null {
  const match = rawText.match(/<TimeAdvance\s*>\s*([\s\S]*?)\s*<\/TimeAdvance>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const minutes = Number(parsed.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return {
      minutes: Math.min(MAX_TIME_ADVANCE_MINUTES, Math.max(1, Math.round(minutes))),
      reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 200) : '本轮行动',
    };
  } catch {
    return null;
  }
}

export function stripTimeAdvanceTags(rawText: string): string {
  return rawText
    .replace(/<TimeAdvance\b[^>]*>[\s\S]*?<\/TimeAdvance\s*>/gi, '')
    // Streaming or truncated model output may leave the metadata tag open.
    // It is specified as trailing metadata, so hide the incomplete tail too.
    .replace(/<TimeAdvance\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<\/?TimeAdvance\b[^>]*>/gi, '')
    .trim();
}

export function estimateTurnMinutes(userText: string, configInput?: Partial<WorldClockConfig>): { minutes: number; reason: string } {
  const text = userText || '';
  const config = normalizeTimeSystemConfig(configInput);
  const explicit = text.match(/(\d+(?:\.\d+)?)\s*(分钟|分|小时|小時|天|日|周|週|月)/i);
  if (explicit) {
    const value = Number(explicit[1]);
    const unit = explicit[2].toLowerCase();
    const multiplier = /小时|小時/.test(unit) ? 60 : /天|日/.test(unit) ? 1_440 : /周|週/.test(unit) ? 10_080 : /月/.test(unit) ? 43_200 : 1;
    return { minutes: Math.min(MAX_TIME_ADVANCE_MINUTES, Math.max(1, Math.round(value * multiplier))), reason: '用户明确说明的时长' };
  }
  if (/睡觉|睡一觉|睡眠|休息|过夜|熬夜/.test(text)) return { minutes: 8 * 60, reason: '睡眠或长时间休息' };
  if (/旅行|旅途|赶路|乘车|乘船|飞行|跋涉|前往|返回/.test(text)) return { minutes: 120, reason: '旅行或移动' };
  if (/训练|修炼|练习|学习|工作|加班|采集|制作|建造/.test(text)) return { minutes: 60, reason: '训练、工作或持续活动' };
  if (/战斗|交战|搏斗|追逐|逃跑|袭击/.test(text)) return { minutes: 30, reason: '战斗或紧张行动' };
  if (/吃饭|用餐|早餐|午餐|晚餐|喝水/.test(text)) return { minutes: 30, reason: '用餐或补给' };
  if (/交谈|聊天|商议|询问|对话|寒暄/.test(text)) return { minutes: 20, reason: '交谈或短暂互动' };
  return { minutes: config.defaultTurnMinutes, reason: '世界默认回合时长' };
}

export function getTimeSystemFromWorld(worldDef?: WorldDef): WorldClockConfig {
  const entries = worldDef?.worldBookEntries || [];
  const economy = entries.find(entry => entry.entryType === 'economy')?.meta as WorldBookEntryMeta | undefined;
  const setting = entries.find(entry => entry.entryType === 'setting')?.meta as WorldBookEntryMeta | undefined;
  return inferWorldClockConfig({
    calendar: economy?.calendar,
    startTime: economy?.startTime,
    timeSpeed: economy?.timeSpeed,
    timePeriod: setting?.timePeriod,
    timeSystem: economy?.timeSystem,
  });
}

export function ensureWorldClockOnGameState<T extends { 世界?: any }>(state: T, worldDef?: WorldDef): T {
  const world = state.世界 || (state.世界 = {});
  const timeSystem = world.时间系统 || (world.时间系统 = { 当前时间: '', 当前天气: '' });
  const fallbackConfig = getTimeSystemFromWorld(worldDef);
  const existing = timeSystem.时钟;
  const clock = existing
    ? normalizeWorldClockState(existing, fallbackConfig)
    : normalizeWorldClockState({
      calendar: fallbackConfig,
      current: typeof timeSystem.当前时间 === 'string' ? timeSystem.当前时间 : undefined,
    }, fallbackConfig);
  timeSystem.时钟 = clock;
  timeSystem.当前时间 = formatWorldClock(clock);
  return state;
}
