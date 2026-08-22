import type { WorldDef, WorldBookEntryDef, WorldBookEntryMeta } from '../data/worlds-schema';

export const WORLD_CLOCK_SCHEMA_VERSION = 2;
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
  /** Kept for editor/save compatibility; it is never used as an implicit turn advance. */
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

/** v2 deliberately contains no calendar/current/display copy. */
export interface WorldClockState {
  schemaVersion: number;
  elapsedMinutes: number;
  lastAdvancedTurnId?: string;
  lastAdvancedRound?: number;
  recentAdvance?: WorldClockAdvanceMetadata;
}

export interface WorldClockWriteRequest {
  deltaMinutes?: number;
  elapsedMinutes?: number;
  reason?: string;
  source?: WorldClockAdvanceMetadata['source'];
  turnId?: string;
  round?: number;
}

export interface TimeAdvanceSuggestion {
  minutes: number;
  reason: string;
  /** Optional semantic cross-check emitted by the main model. */
  targetPhase?: NarrativeTimePhase;
  /** Calendar-day offset from the beginning of this turn. */
  dayOffset?: number;
  evidence?: string;
}

export type NarrativeTimePhase =
  | 'late_night'
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'dusk'
  | 'evening'
  | 'night';

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
const DEFAULT_CUSTOM_MONTHS = Array.from({ length: 12 }, (_, index) => ({ name: `第${index + 1}月`, days: 30 }));

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
  if (mode === 'gregorian') return GREGORIAN_MONTHS.map(month => ({ ...month }));
  const source = Array.isArray(raw) ? raw : [];
  const months = source.map((item, index) => {
    const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : DEFAULT_CUSTOM_MONTHS[index]?.name || `第${index + 1}月`,
      days: finiteInt(value.days, DEFAULT_CUSTOM_MONTHS[index]?.days || 30, 1, 400),
    };
  }).filter(month => month.days > 0);
  return months.length >= 1 ? months.slice(0, 24) : DEFAULT_CUSTOM_MONTHS.map(month => ({ ...month }));
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
  const timeMatch = text.match(/(?:^|T|\s|午前|下午|上午|凌晨|清晨)(\d{1,2})\s*(?::|点|时)\s*(\d{0,2})/);
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
    start: input.timeSystem?.start ? { ...parsed, ...input.timeSystem.start } : parsed as WorldClockConfig['start'],
    defaultTurnMinutes: input.timeSystem?.defaultTurnMinutes || (/实时|同步|1:1/i.test(input.timeSpeed || '') ? 20 : undefined),
  });
}

function parseLegacyCurrent(config: WorldClockConfig, text: string, fallbackInput: WorldClockDate = config.start): WorldClockDate | null {
  const fallback = normalizeDate(config, fallbackInput, config.start);
  const parsedTime = parseDateText(text);
  if (config.mode === 'relative') {
    const relativeDay = text.match(/(?:第\s*)?(\d{1,9})\s*(?:天|日)/);
    if (relativeDay) {
      const date = addMinutesToDate(config, config.start, Math.max(0, Number(relativeDay[1]) - 1) * 1_440);
      return normalizeDate(config, { ...date, hour: parsedTime.hour ?? fallback.hour, minute: parsedTime.minute ?? fallback.minute }, date);
    }
  }
  const namedMonth = [...config.months]
    .map((month, index) => ({ name: month.name.trim(), month: index + 1 }))
    .filter(item => item.name)
    .sort((a, b) => b.name.length - a.name.length)
    .find(item => text.includes(item.name));
  const formattedDay = text.match(/(?:^|[·・•|\s])第\s*(\d{1,3})\s*日/);
  const parsed: Partial<WorldClockDate> = {
    ...parsedTime,
    month: namedMonth?.month ?? parsedTime.month,
    day: formattedDay ? Number(formattedDay[1]) : parsedTime.day,
  };
  const hasDateOrTime = parsed.year != null || parsed.month != null || parsed.day != null || parsed.hour != null || parsed.minute != null;
  if (!hasDateOrTime) return null;
  return normalizeDate(config, { ...fallback, ...parsed }, fallback);
}

function absoluteMinutes(config: WorldClockConfig, date: WorldClockDate): number {
  return dateToDayNumber(config, date) * 1_440 + date.hour * 60 + date.minute;
}

function deriveElapsedFromLegacyCurrent(config: WorldClockConfig, source: Record<string, unknown>): number | null {
  const rawCurrent = source.current;
  const current = rawCurrent && typeof rawCurrent === 'object'
    ? normalizeDate(config, rawCurrent, config.start)
    : typeof rawCurrent === 'string'
      ? parseLegacyCurrent(config, rawCurrent)
      : typeof source.currentTime === 'string'
        ? parseLegacyCurrent(config, source.currentTime)
        : null;
  if (!current) return null;
  return Math.max(0, Math.round(absoluteMinutes(config, current) - absoluteMinutes(config, config.start)));
}

function normalizeRecentAdvance(raw: unknown): WorldClockAdvanceMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  return {
    minutes: finiteInt(value.minutes, 0, 0, MAX_TIME_ADVANCE_MINUTES),
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 200) : '',
    source: value.source === 'ai' || value.source === 'manual' ? value.source : 'local-estimate',
    turnId: typeof value.turnId === 'string' ? value.turnId : undefined,
    round: value.round !== null && value.round !== undefined && Number.isFinite(Number(value.round)) ? Math.trunc(Number(value.round)) : undefined,
  };
}

/** Normalize v1/v2 input. Explicit world-book config always wins over v1 calendar data. */
export function normalizeWorldClockState(raw: unknown, fallbackConfig?: Partial<WorldClockConfig>): WorldClockState {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const legacyCalendar = source.calendar && typeof source.calendar === 'object' ? source.calendar as Partial<WorldClockConfig> : undefined;
  const config = normalizeTimeSystemConfig(fallbackConfig || legacyCalendar);
  const schemaVersion = Number(source.schemaVersion);
  const migratedElapsed = (schemaVersion < 2 || !Number.isFinite(schemaVersion)) ? deriveElapsedFromLegacyCurrent(config, source) : null;
  const rawElapsed = Number(source.elapsedMinutes);
  const hasRawElapsed = source.elapsedMinutes !== null && source.elapsedMinutes !== undefined && source.elapsedMinutes !== '';
  const elapsedMinutes = Math.min(
    maxElapsedMinutesForCalendar(config),
    migratedElapsed != null
      ? migratedElapsed
      : hasRawElapsed && Number.isFinite(rawElapsed) && rawElapsed >= 0 ? Math.floor(rawElapsed) : 0,
  );
  return {
    schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
    elapsedMinutes,
    lastAdvancedTurnId: typeof source.lastAdvancedTurnId === 'string' ? source.lastAdvancedTurnId : undefined,
    lastAdvancedRound: source.lastAdvancedRound !== null && source.lastAdvancedRound !== undefined && Number.isFinite(Number(source.lastAdvancedRound))
      ? Math.max(0, Math.trunc(Number(source.lastAdvancedRound))) : undefined,
    recentAdvance: normalizeRecentAdvance(source.recentAdvance),
  };
}

export function createWorldClock(configInput?: Partial<WorldClockConfig>): WorldClockState {
  normalizeTimeSystemConfig(configInput);
  return { schemaVersion: WORLD_CLOCK_SCHEMA_VERSION, elapsedMinutes: 0 };
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

/** Single authoritative write entry for narrative, gameplay, and manual edits. */
export function writeWorldClock(
  raw: WorldClockState,
  configInput: WorldClockConfig,
  request: WorldClockWriteRequest,
): WorldClockState {
  const config = normalizeTimeSystemConfig(configInput);
  const clock = normalizeWorldClockState(raw, config);
  if ((request.turnId && clock.lastAdvancedTurnId === request.turnId)
    || (request.round != null && clock.lastAdvancedRound === request.round)) return clock;

  const targetElapsed = request.elapsedMinutes != null
    ? finiteInt(request.elapsedMinutes, clock.elapsedMinutes, 0, maxElapsedMinutesForCalendar(config))
    : Math.min(maxElapsedMinutesForCalendar(config), clock.elapsedMinutes + finiteInt(request.deltaMinutes, 0, 0, MAX_TIME_ADVANCE_MINUTES));
  if (targetElapsed === clock.elapsedMinutes) return clock;
  const minutes = Math.abs(targetElapsed - clock.elapsedMinutes);
  return {
    schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
    elapsedMinutes: targetElapsed,
    lastAdvancedTurnId: request.turnId ?? clock.lastAdvancedTurnId,
    lastAdvancedRound: request.round ?? clock.lastAdvancedRound,
    recentAdvance: {
      minutes,
      reason: request.reason || '本轮行动',
      source: request.source || 'manual',
      turnId: request.turnId,
      round: request.round,
    },
  };
}

export function advanceWorldClock(
  raw: WorldClockState,
  configInput: WorldClockConfig,
  minutesInput: number,
  metadata?: Omit<WorldClockAdvanceMetadata, 'minutes'>,
): WorldClockState {
  return writeWorldClock(raw, configInput, { deltaMinutes: minutesInput, ...metadata });
}

export function advanceWorldClockForTurn(
  raw: WorldClockState,
  configInput: WorldClockConfig,
  minutesInput: number,
  metadata: Omit<WorldClockAdvanceMetadata, 'minutes'>,
): WorldClockState {
  return writeWorldClock(raw, configInput, { deltaMinutes: minutesInput, ...metadata });
}

function dateAtElapsed(config: WorldClockConfig, clock: WorldClockState): WorldClockDate {
  return addMinutesToDate(config, config.start, clock.elapsedMinutes);
}

function parseEditedTarget(config: WorldClockConfig, displayText: string, current: WorldClockDate): WorldClockDate | null {
  return parseLegacyCurrent(config, displayText.trim(), current);
}

/** Reconcile a human-edited display through the same authoritative write entry. */
export function reconcileEditedWorldClock(raw: WorldClockState, configInput: WorldClockConfig, displayText: string): WorldClockState {
  const config = normalizeTimeSystemConfig(configInput);
  const clock = normalizeWorldClockState(raw, config);
  const target = parseEditedTarget(config, displayText, dateAtElapsed(config, clock));
  if (!target) return clock;
  const elapsedMinutes = Math.min(
    maxElapsedMinutesForCalendar(config),
    Math.max(0, absoluteMinutes(config, target) - absoluteMinutes(config, config.start)),
  );
  return writeWorldClock(clock, config, {
    elapsedMinutes,
    reason: '玩家手动校正世界时间',
    source: 'manual',
  });
}

export function formatWorldClock(clockInput: WorldClockState, configInput: WorldClockConfig): string {
  const config = normalizeTimeSystemConfig(configInput);
  const clock = normalizeWorldClockState(clockInput, config);
  const current = dateAtElapsed(config, clock);
  const month = config.months[current.month - 1]?.name || `第${current.month}月`;
  const weekdayIndex = config.mode === 'gregorian'
    ? (dateToDayNumber(config, current) + 1) % 7
    : dateToDayNumber(config, current) % config.weekdays.length;
  const weekday = config.weekdays[weekdayIndex] || `第${weekdayIndex + 1}日`;
  const timeOfDay = [...config.timeOfDayLabels].reverse().find(label => current.hour * 60 + current.minute >= label.startMinute)?.name || '';
  const eraLabel = config.eraName || (config.mode === 'custom' ? config.calendarName : '');
  const era = eraLabel ? `${eraLabel} ` : '';
  const datePart = config.mode === 'relative'
    ? `${config.calendarName}·第${dateToDayNumber(config, current) - dateToDayNumber(config, config.start) + 1}日`
    : `${era}${current.year}年·${month}·第${current.day}日`;
  return `${datePart} ${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}·${weekday}${timeOfDay ? `·${timeOfDay}` : ''}`;
}

export function getWorldClockPeriodKeys(clockInput: WorldClockState, configInput: WorldClockConfig): WorldClockPeriodKeys {
  const config = normalizeTimeSystemConfig(configInput);
  const clock = normalizeWorldClockState(clockInput, config);
  const current = dateAtElapsed(config, clock);
  const dayNumber = dateToDayNumber(config, current);
  const daysPerWeek = Math.max(1, config.weekdays.length);
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
    if (parsed.minutes == null || typeof parsed.minutes === 'boolean') return null;
    const minutes = Number(parsed.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    const suggestion: TimeAdvanceSuggestion = {
      minutes: Math.min(MAX_TIME_ADVANCE_MINUTES, Math.max(0, Math.round(minutes))),
      reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 200) : '本轮行动',
    };
    const targetPhase = normalizeNarrativeTimePhase(parsed.targetPhase);
    if (targetPhase) suggestion.targetPhase = targetPhase;
    if (parsed.dayOffset != null && typeof parsed.dayOffset !== 'boolean') {
      const dayOffset = Number(parsed.dayOffset);
      if (Number.isFinite(dayOffset) && dayOffset >= 0) suggestion.dayOffset = Math.min(3_650, Math.floor(dayOffset));
    }
    if (typeof parsed.evidence === 'string' && parsed.evidence.trim()) suggestion.evidence = parsed.evidence.trim().slice(0, 200);
    return suggestion;
  } catch {
    return null;
  }
}

export function stripTimeAdvanceTags(rawText: string): string {
  return rawText
    .replace(/<TimeAdvance\b[^>]*>[\s\S]*?<\/TimeAdvance\s*>/gi, '')
    .replace(/<TimeAdvance\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<\/?TimeAdvance\b[^>]*>/gi, '')
    .trim();
}

const NARRATIVE_PHASE_MINUTES: Record<NarrativeTimePhase, number> = {
  late_night: 1 * 60, dawn: 5 * 60, morning: 8 * 60, noon: 12 * 60,
  afternoon: 14 * 60, dusk: 18 * 60, evening: 19 * 60, night: 21 * 60,
};
const NARRATIVE_DAY_PART_PHASES: Record<string, NarrativeTimePhase> = {
  凌晨: 'late_night', 黎明: 'dawn', 破晓: 'dawn', 清晨: 'dawn',
  早晨: 'morning', 早上: 'morning', 上午: 'morning', 中午: 'noon', 正午: 'noon',
  午后: 'afternoon', 下午: 'afternoon', 傍晚: 'dusk', 薄暮: 'dusk', 黄昏: 'dusk',
  晚上: 'evening', 入夜: 'night', 夜晚: 'night', 深夜: 'late_night', 午夜: 'late_night', 子夜: 'late_night',
};

function normalizeNarrativeTimePhase(raw: unknown): NarrativeTimePhase | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'late_night' || value === 'midnight' || value === 'deep_night') return 'late_night';
  if (value === 'dawn' || value === 'daybreak' || value === 'sunrise') return 'dawn';
  if (value === 'morning') return 'morning';
  if (value === 'noon' || value === 'midday') return 'noon';
  if (value === 'afternoon') return 'afternoon';
  if (value === 'dusk' || value === 'sunset' || value === 'twilight') return 'dusk';
  if (value === 'evening') return 'evening';
  if (value === 'night') return 'night';
  return NARRATIVE_DAY_PART_PHASES[raw.trim()];
}

function parseNarrativeNumber(raw: string): number | null {
  const value = raw.trim();
  if (value === '半') return 0.5;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let pending = 0;
  for (const character of value) {
    if (character in digits) { pending = digits[character]; continue; }
    const unit = character === '十' ? 10 : character === '百' ? 100 : character === '千' ? 1_000 : 0;
    if (!unit) return null;
    total += (pending || 1) * unit;
    pending = 0;
  }
  return total + pending;
}

function durationToMinutes(value: number, unit: string): number {
  const multiplier = /小时|小時/.test(unit) ? 60 : /天|日/.test(unit) ? 1_440 : /周|週/.test(unit) ? 10_080 : /月/.test(unit) ? 43_200 : 1;
  return Math.min(MAX_TIME_ADVANCE_MINUTES, Math.max(1, Math.round(value * multiplier)));
}

function replaceRangeWithSpaces(text: string, start: number, end: number): string {
  return `${text.slice(0, start)}${' '.repeat(Math.max(0, end - start))}${text.slice(end)}`;
}

function maskNonCurrentTimeReferences(input: string): string {
  let text = input;
  const quotePattern = /“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"/g;
  for (const match of [...text.matchAll(quotePattern)].reverse()) {
    if (match.index != null) text = replaceRangeWithSpaces(text, match.index, match.index + match[0].length);
  }
  const timeHint = /(?:凌晨|黎明|清晨|早晨|上午|中午|正午|午后|下午|傍晚|薄暮|黄昏|晚上|夜晚|深夜|午夜|今晚|昨夜|昨晚|明天|第二天|次日|翌日|隔天|第\s*(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:天|日)|(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:分钟|小时|天|日|周)后|\d{1,6}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号))/;
  const clausePattern = /[^。！？!?；;\n]+[。！？!?；;\n]?/g;
  for (const match of [...text.matchAll(clausePattern)].reverse()) {
    if (match.index == null || !timeHint.test(match[0])) continue;
    const isMemory = /(?:想起|回忆|回想|记得|梦见|梦到|曾经|从前|往昔|过去的|此前)/.test(match[0]);
    const isPlan = /(?:说|约定|答应|承诺|通知|计划|打算|预计|预告|希望|提议|询问|说明|告诉|声称)/.test(match[0])
      && !/(?:已经|终于|抵达|到达|过去|醒来|结束|降临|亮起|暗下|说到|聊到|谈到)/.test(match[0]);
    if (isMemory || isPlan) text = replaceRangeWithSpaces(text, match.index, match.index + match[0].length);
  }
  return text;
}

type NarrativeStrength = 'high' | 'soft';
interface NarrativeDuration { index: number; end: number; minutes: number; label: string; strength: NarrativeStrength; }
interface NarrativePhaseCue { index: number; end: number; phase: NarrativeTimePhase; label: string; }
interface NarrativeAnchor extends TimeAdvanceSuggestion { strength: NarrativeStrength; }

function phaseAnchor(
  config: WorldClockConfig,
  clock: WorldClockState,
  phase: NarrativeTimePhase,
  requestedDayOffset: number,
  reason: string,
  strength: NarrativeStrength,
): NarrativeAnchor | null {
  const current = dateAtElapsed(config, clock);
  const currentAbsolute = absoluteMinutes(config, current);
  const currentDay = dateToDayNumber(config, current);
  const targetAbsolute = (currentDay + Math.max(0, requestedDayOffset)) * 1_440 + NARRATIVE_PHASE_MINUTES[phase];
  let delta = targetAbsolute - currentAbsolute;
  let dayOffset = Math.max(0, requestedDayOffset);
  if (delta <= 0 && requestedDayOffset === 0) {
    const likelyNextDay = ['late_night', 'dawn', 'morning', 'noon', 'afternoon'].includes(phase)
      && current.hour >= 18;
    if (likelyNextDay) {
      delta += 1_440;
      dayOffset = 1;
    }
  }
  if (delta <= 0 || delta > MAX_TIME_ADVANCE_MINUTES) return null;
  return { minutes: Math.round(delta), reason, targetPhase: phase, dayOffset, strength };
}

function explicitEvidence(text: string): boolean {
  return /(?:第\s*(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:天|日)|第二天|第三天|次日|翌日|隔天|跨过两天)|(?:(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:天|日|周|週|月)(?:后|以后|之后|过去))|(?:经过|过去|持续|历时|耗费|花费|花了|又过了|跨过|赶路|行进|旅行|旅途|跋涉)[^。！？!?\n]{0,12}(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:天|日|周|週|月)|\d{1,6}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)/.test(text);
}

function narrativeLongJumpEvidence(rawText: string): boolean {
  const visibleText = stripTimeAdvanceTags(rawText || '').replace(/<[^>]+>/g, '');
  return explicitEvidence(maskNonCurrentTimeReferences(visibleText));
}

function resolveModelTimeAdvance(
  suggestion: TimeAdvanceSuggestion,
  rawClock: WorldClockState,
  configInput: WorldClockConfig,
  narrativeText: string,
): TimeAdvanceSuggestion | null {
  if (suggestion.minutes > 0) {
    const evidence = suggestion.evidence?.trim() || '';
    const genericEvidence = /^(?:剧情(?:自然)?推进|自然推进|模型判断|整体判断|本轮行动|时间流逝|正常经过)[。.!！]?$/;
    const visibleNarrative = maskNonCurrentTimeReferences(stripTimeAdvanceTags(narrativeText || '').replace(/<[^>]+>/g, '')).trim();
    if (!evidence || genericEvidence.test(evidence) || !visibleNarrative) return null;
  }
  const config = normalizeTimeSystemConfig(configInput);
  const clock = normalizeWorldClockState(rawClock, config);
  const current = dateAtElapsed(config, clock);
  const currentAbsolute = absoluteMinutes(config, current);
  const currentDay = dateToDayNumber(config, current);
  const dayOffset = suggestion.dayOffset ?? 0;
  let candidateMinutes = suggestion.minutes;
  let candidateAbsolute = currentAbsolute + candidateMinutes;
  if (suggestion.targetPhase) {
    const anchorAbsolute = (currentDay + dayOffset) * 1_440 + NARRATIVE_PHASE_MINUTES[suggestion.targetPhase];
    let anchorMinutes = anchorAbsolute - currentAbsolute;
    if (anchorMinutes <= 0 && dayOffset === 0 && current.hour >= 18
      && ['late_night', 'dawn', 'morning', 'noon', 'afternoon'].includes(suggestion.targetPhase)) anchorMinutes += 1_440;
    if (anchorMinutes > 0 && anchorMinutes <= MAX_TIME_ADVANCE_MINUTES) {
      candidateMinutes = Math.round(anchorMinutes);
      candidateAbsolute = currentAbsolute + candidateMinutes;
    }
  }
  const crossesTwoCalendarDays = Math.floor(candidateAbsolute / 1_440) - currentDay >= 2;
  if ((candidateMinutes >= 2 * 1_440 || crossesTwoCalendarDays) && !narrativeLongJumpEvidence(narrativeText)) return null;
  if (!suggestion.targetPhase) return suggestion;
  if (candidateMinutes <= 0 || candidateMinutes > MAX_TIME_ADVANCE_MINUTES) return suggestion;
  return { ...suggestion, minutes: candidateMinutes, reason: suggestion.reason || '正文推进至新的时段' };
}

/** Select exactly one final narrative endpoint; no phase/meal/sleep candidates are added together. */
export function inferNarrativeTimeAdvance(rawText: string, rawClock: WorldClockState, configInput: WorldClockConfig): NarrativeAnchor | null {
  const config = normalizeTimeSystemConfig(configInput);
  const clock = normalizeWorldClockState(rawClock, config);
  const visibleText = stripTimeAdvanceTags(rawText).replace(/<[^>]+>/g, '').trim();
  if (!visibleText) return null;
  const text = maskNonCurrentTimeReferences(visibleText);
  if (!text.trim()) return null;

  const exactTargets: Array<{ index: number; target: WorldClockDate; label: string }> = [];
  const exactDatePattern = /((?:\d{1,6}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)(?:\s*(?:凌晨|深夜|清晨|早上|上午|中午|正午|下午|傍晚|黄昏|晚上|夜晚)?\s*\d{1,2}\s*(?:点|时)(?:\s*\d{1,2}\s*分)?)?)/g;
  for (const match of text.matchAll(exactDatePattern)) {
    if (match.index == null) continue;
    const target = parseLegacyCurrent(config, match[1], dateAtElapsed(config, clock));
    if (target) exactTargets.push({ index: match.index, target, label: match[0] });
  }
  if (config.mode === 'relative') {
    const relativeDayPattern = /第\s*(\d{1,9})\s*(?:日|天)/g;
    for (const match of text.matchAll(relativeDayPattern)) {
      if (match.index == null) continue;
      const target = parseLegacyCurrent(config, match[0], dateAtElapsed(config, clock));
      if (target) exactTargets.push({ index: match.index, target, label: match[0] });
    }
  }
  if (exactTargets.length > 0) {
    exactTargets.sort((a, b) => a.index - b.index);
    const final = exactTargets[exactTargets.length - 1];
    const delta = absoluteMinutes(config, final.target) - absoluteMinutes(config, dateAtElapsed(config, clock));
    if (delta > 0) return { minutes: Math.min(MAX_TIME_ADVANCE_MINUTES, delta), reason: `正文明确时间：${final.label}`, strength: 'high' };
  }

  const numberToken = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千]+|半)';
  const unitToken = '(分钟|分|小时|小時|天|日|周|週|月)';
  const durations: NarrativeDuration[] = [];
  const durationPatterns = [
    new RegExp(`(${numberToken})\\s*(?:个)?\\s*${unitToken}(?:之后|以后|后|过去)`, 'g'),
    new RegExp(`(?:又|再|随后|接着|然后)?\\s*(?:过了|过去了|经过了?|经历了?|持续了?|耗费了?|花了?)\\s*(${numberToken})\\s*(?:个)?\\s*${unitToken}`, 'g'),
  ];
  for (const pattern of durationPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue;
      const value = parseNarrativeNumber(match[1]);
      if (value == null || value <= 0) continue;
      durations.push({ index: match.index, end: match.index + match[0].length, minutes: durationToMinutes(value, match[2]), label: match[0].trim(), strength: 'high' });
    }
  }
  durations.sort((a, b) => a.index - b.index);
  if (durations.length > 0) {
    const sequential = durations.length === 1 || durations.slice(1).every((duration, index) => {
      const previous = durations[index];
      const between = text.slice(previous.end, duration.index);
      return /(?:又|再|随后|接着|然后|后来|之后|过了)/.test(between) || /(?:后|之后|以后|过去)$/.test(previous.label);
    });
    const minutes = sequential ? durations.reduce((sum, item) => sum + item.minutes, 0) : Math.max(...durations.map(item => item.minutes));
    return { minutes: Math.min(MAX_TIME_ADVANCE_MINUTES, minutes), reason: `正文明确连续时长：${durations.map(item => item.label).slice(-3).join('、')}`, evidence: '明确经过的连续时长', strength: 'high' };
  }

  const dayPartWords = '凌晨|黎明|破晓|深夜|午夜|子夜|清晨|早晨|早上|上午|中午|正午|午后|下午|傍晚|薄暮|黄昏|晚上|入夜|夜晚';
  const nextDayCues: Array<{ index: number; phase: NarrativeTimePhase; label: string; dayOffset: number }> = [];
  const nextDayPattern = new RegExp(`(?:第二天|次日|翌日|隔日|隔天)(?:的)?\\s*(${dayPartWords})?`, 'g');
  for (const match of text.matchAll(nextDayPattern)) {
    if (match.index == null) continue;
    const dayWord = match[1] || '上午';
    const explicitDay = 1;
    nextDayCues.push({ index: match.index, phase: NARRATIVE_DAY_PART_PHASES[dayWord] || 'morning', label: match[0], dayOffset: explicitDay });
  }

  const phaseCues: NarrativePhaseCue[] = [];
  const phasePatterns: Array<[NarrativeTimePhase, RegExp]> = [
    ['dawn', /凌晨|清晨|破晓|黎明|晨曦(?:初露|浮现)|天边泛白|天色(?:渐渐|逐渐)?亮(?:了|起来)|鸡鸣|晨光(?:已经)?(?:照进|洒入|透入)/g],
    ['morning', /早晨|一大早|朝阳(?:升起|初升)/g],
    ['noon', /正午|中午|晌午|日上中天|太阳(?:升至|悬在)头顶/g],
    ['afternoon', /午后|下午/g],
    ['dusk', /薄暮|黄昏|暮色(?:降临|四合|渐浓)|夕阳(?:渐渐)?(?:西斜|落下|沉入)|日落|天色(?:渐渐|逐渐)?暗(?:下|了|下来)|影子(?:渐渐)?拉长/g],
    ['evening', /傍晚|华灯初上|街灯(?:逐一|陆续|纷纷)?亮起|灯火初上/g],
    ['night', /入夜|夜幕(?:降临|低垂)|夜色(?:笼罩|降临|渐深)|繁星(?:出现|点点)|月亮(?:升起|爬上)|万家灯火/g],
    ['late_night', /午夜|子夜|深夜|夜深(?:人静)?/g],
  ];
  for (const [phase, pattern] of phasePatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index != null) phaseCues.push({ index: match.index, end: match.index + match[0].length, phase, label: match[0] });
    }
  }
  phaseCues.sort((a, b) => a.index - b.index);
  nextDayCues.sort((a, b) => a.index - b.index);

  const lastNextDay = nextDayCues[nextDayCues.length - 1];
  const lastPhase = phaseCues[phaseCues.length - 1];
  if (lastNextDay) {
    const laterPhase = phaseCues.filter(phase => phase.index > lastNextDay.index).at(-1);
    const finalPhase = laterPhase?.phase || lastNextDay.phase;
    const endpointLabel = laterPhase ? `${lastNextDay.label}后${laterPhase.label}` : lastNextDay.label;
    const anchor = phaseAnchor(config, clock, finalPhase, lastNextDay.dayOffset, `正文时间锚点：${endpointLabel}`, 'high');
    if (anchor) return anchor;
  }
  const napWake = /(?:午睡|小憩|打盹)[^。！？!?\n]{0,12}(?:醒来|睡醒)/.test(text);
  const incompleteSleep = /(?:准备|打算|无法|不能|尚未|未曾|没有|没能|还没)[^。！？!?\n]{0,8}(?:睡下|入睡|就寝|睡觉)/.test(text);
  const overnight = !napWake && !incompleteSleep && /(?:一夜|过夜|睡下|入睡|就寝|睡梦中醒来|一觉醒来|天亮)/.test(text);
  if (lastPhase) {
    const anchor = phaseAnchor(config, clock, lastPhase.phase, overnight ? 1 : 0, `正文场景锚点：${lastPhase.label}`, 'high');
    if (anchor) return anchor;
  }
  if (overnight) {
    const anchor = phaseAnchor(config, clock, 'morning', 1, '正文完成过夜并醒来', 'high');
    if (anchor) return anchor;
  }
  if (napWake) return { minutes: 60, reason: '正文完成午睡或小憩', strength: 'soft' };

  const mealPattern = /(?:(?:吃|用|享用)(?:完|过|罢)?(?:了)?\s*(早饭|早餐|午饭|午餐|中饭|晚饭|晚餐)|(?:早饭|早餐|午饭|午餐|中饭|晚饭|晚餐)\s*(?:已经)?(?:吃完|用完|用毕|结束))/g;
  const meals = [...text.matchAll(mealPattern)].filter(match => match.index != null);
  const meal = meals[meals.length - 1];
  if (meal) {
    const label = meal[1] || meal[0];
    return {
      minutes: /早饭|早餐/.test(label) ? 20 : /午饭|午餐|中饭/.test(label) ? 30 : 40,
      reason: `正文完成${label}`,
      strength: 'soft',
    };
  }
  return null;
}

export interface ResolvedTimeAdvance extends TimeAdvanceSuggestion {
  source: 'ai' | 'narrative' | 'player-explicit';
}

export function inferExplicitPlayerTimeAdvance(userText: string): TimeAdvanceSuggestion | null {
  const text = (userText || '').trim();
  if (!text || /[?？]/.test(text) || /(?:是否|会不会|要不要|能不能|多久|多少(?:分钟|小时|天)|够不够)/.test(text)) return null;
  const match = text.match(/(?:等待?|休息|停留|跳过|快进|度过|耗时|花(?:上|费)?|训练|修炼|学习|工作|赶路|旅行|睡(?:眠|觉)?)[^。！？!?\n]{0,18}?(\d+(?:\.\d+)?)\s*(分钟|分|小时|小時|天|日|周|週|月)/i);
  if (!match) return null;
  return { minutes: durationToMinutes(Number(match[1]), match[2]), reason: '玩家明确要求经过这段时间' };
}

export function resolveTurnTimeAdvance(input: {
  rawResponse: string;
  narrativeText: string;
  userText: string;
  clock: WorldClockState;
  config: WorldClockConfig;
}): ResolvedTimeAdvance | null {
  const narrative = inferNarrativeTimeAdvance(input.narrativeText, input.clock, input.config);
  if (narrative?.strength === 'high') return { minutes: narrative.minutes, reason: narrative.reason, targetPhase: narrative.targetPhase, dayOffset: narrative.dayOffset, evidence: narrative.evidence, source: 'narrative' };
  const parsedAi = parseTimeAdvance(input.rawResponse);
  const ai = parsedAi ? resolveModelTimeAdvance(parsedAi, input.clock, input.config, input.narrativeText) : null;
  if (ai) return { ...ai, source: 'ai' };
  if (narrative) return { minutes: narrative.minutes, reason: narrative.reason, source: 'narrative' };
  return null;
}

export function estimateTurnMinutes(userText: string, configInput?: Partial<WorldClockConfig>): { minutes: number; reason: string } {
  const text = userText || '';
  const config = normalizeTimeSystemConfig(configInput);
  const explicit = text.match(/(\d+(?:\.\d+)?)\s*(分钟|分|小时|小時|天|日|周|週|月)/i);
  if (explicit) return { minutes: durationToMinutes(Number(explicit[1]), explicit[2].toLowerCase()), reason: '用户明确说明的时长' };
  if (/睡觉|睡一觉|睡眠|休息|过夜|熬夜/.test(text)) return { minutes: 8 * 60, reason: '睡眠或长时间休息' };
  if (/旅行|旅途|赶路|乘车|乘船|飞行|跋涉|前往|返回/.test(text)) return { minutes: 120, reason: '旅行或移动' };
  if (/训练|修炼|练习|学习|工作|加班|采集|制作|建造/.test(text)) return { minutes: 60, reason: '训练、工作或持续活动' };
  if (/战斗|交战|搏斗|追逐|逃跑|袭击/.test(text)) return { minutes: 30, reason: '战斗或紧张行动' };
  if (/吃饭|用餐|早餐|午餐|晚餐|喝水/.test(text)) return { minutes: 30, reason: '用餐或补给' };
  if (/交谈|聊天|商议|询问|对话|寒暄/.test(text)) return { minutes: 20, reason: '交谈或短暂互动' };
  return { minutes: config.defaultTurnMinutes, reason: '世界默认回合时长（仅兼容估算接口）' };
}

export function getTimeSystemFromWorld(worldDef?: WorldDef): WorldClockConfig {
  const entries = worldDef?.worldBookEntries || [];
  const structured = entries.find(entry => {
    const meta = entry.meta as WorldBookEntryMeta | undefined;
    return !!meta?.timeSystem;
  })?.meta as WorldBookEntryMeta | undefined;
  const economy = entries.find(entry => entry.entryType === 'economy')?.meta as WorldBookEntryMeta | undefined;
  const setting = entries.find(entry => entry.entryType === 'setting')?.meta as WorldBookEntryMeta | undefined;
  return inferWorldClockConfig({
    calendar: economy?.calendar,
    startTime: economy?.startTime,
    timeSpeed: economy?.timeSpeed,
    timePeriod: setting?.timePeriod,
    timeSystem: structured?.timeSystem,
  });
}

function getWorldBookTimeSystemEntry(worldDef?: WorldDef): WorldBookEntryDef | undefined {
  const entries = worldDef?.worldBookEntries || [];
  return entries.find(entry => !!(entry.meta as WorldBookEntryMeta | undefined)?.timeSystem)
    || entries.find(entry => entry.entryType === 'economy')
    || entries.find(entry => entry.entryType === 'setting')
    || entries[0];
}

function hasWorldBookTimeSystem(worldDef?: WorldDef): boolean {
  return (worldDef?.worldBookEntries || []).some(entry => !!(entry.meta as WorldBookEntryMeta | undefined)?.timeSystem);
}

function persistMigratedTimeSystem(worldDef: WorldDef | undefined, config: WorldClockConfig): void {
  const entry = getWorldBookTimeSystemEntry(worldDef);
  if (!entry) return;
  entry.meta = { ...(entry.meta || {}), timeSystem: config };
}

export function ensureWorldClockOnGameState<T extends { 世界?: any }>(state: T, worldDef?: WorldDef): T {
  const world = state.世界 || (state.世界 = {});
  const timeSystem = world.时间系统 || (world.时间系统 = { 当前时间: '', 当前天气: '' });
  const existing = timeSystem.时钟;
  const legacyCalendar = existing && typeof existing === 'object' && existing.calendar && typeof existing.calendar === 'object'
    ? existing.calendar as Partial<WorldClockConfig>
    : undefined;
  const legacyConfig = !hasWorldBookTimeSystem(worldDef) && legacyCalendar
    ? normalizeTimeSystemConfig(legacyCalendar)
    : undefined;
  const config = legacyConfig || getTimeSystemFromWorld(worldDef);
  if (legacyConfig && worldDef) persistMigratedTimeSystem(worldDef, legacyConfig);
  const legacyDisplay = typeof timeSystem.当前时间 === 'string' && timeSystem.当前时间.trim()
    ? { schemaVersion: 1, current: timeSystem.当前时间 }
    : { elapsedMinutes: 0 };
  const clock = existing
    ? normalizeWorldClockState(existing, config)
    : normalizeWorldClockState(legacyDisplay, config);
  timeSystem.时钟 = clock;
  timeSystem.当前时间 = formatWorldClock(clock, config);
  return state;
}
