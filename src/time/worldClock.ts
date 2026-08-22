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
    start: input.timeSystem?.start
      ? { ...parsed, ...input.timeSystem.start }
      : parsed as WorldClockConfig['start'],
    defaultTurnMinutes: input.timeSystem?.defaultTurnMinutes || (/实时|同步|1:1/i.test(input.timeSpeed || '') ? 20 : undefined),
  });
}

function parseLegacyCurrent(
  config: WorldClockConfig,
  text: string,
  fallbackInput: WorldClockDate = config.start,
): WorldClockDate | null {
  const fallback = normalizeDate(config, fallbackInput, config.start);
  const parsedTime = parseDateText(text);
  if (config.mode === 'relative') {
    const relativeDay = text.match(/(?:第\s*)?(\d{1,9})\s*(?:天|日)/);
    if (relativeDay) {
      const dayOffset = Math.max(0, Number(relativeDay[1]) - 1);
      const date = addMinutesToDate(config, config.start, dayOffset * 1_440);
      return normalizeDate(config, {
        ...date,
        hour: parsedTime.hour ?? fallback.hour,
        minute: parsedTime.minute ?? fallback.minute,
      }, date);
    }
  }

  // formatWorldClock uses localized month names and "·第N日", which the
  // legacy numeric parser cannot read. Match the clock's own display format so
  // a player can edit only HH:mm without accidentally resetting the date.
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
  const hasDateOrTime = parsed.year != null || parsed.month != null || parsed.day != null
    || parsed.hour != null || parsed.minute != null;
  if (!hasDateOrTime) return null;
  return normalizeDate(config, { ...fallback, ...parsed }, fallback);
}

function absoluteMinutes(config: WorldClockConfig, date: WorldClockDate): number {
  return dateToDayNumber(config, date) * 1_440 + date.hour * 60 + date.minute;
}

/** 将变量面板中手动编辑的显示时间同步回权威结构化时钟。 */
export function reconcileEditedWorldClock(raw: WorldClockState, displayText: string): WorldClockState {
  const clock = normalizeWorldClockState(raw);
  const target = parseLegacyCurrent(clock.calendar, displayText.trim(), clock.current);
  if (!target) return clock;
  const elapsedMinutes = Math.min(
    maxElapsedMinutesForCalendar(clock.calendar),
    Math.max(0, absoluteMinutes(clock.calendar, target) - absoluteMinutes(clock.calendar, clock.calendar.start)),
  );
  if (elapsedMinutes === clock.elapsedMinutes) return clock;
  return {
    ...clock,
    current: addMinutesToDate(clock.calendar, clock.calendar.start, elapsedMinutes),
    elapsedMinutes,
    recentAdvance: {
      minutes: Math.abs(elapsedMinutes - clock.elapsedMinutes),
      reason: '玩家手动校正世界时间',
      source: 'manual',
    },
  };
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
    if (typeof parsed.evidence === 'string' && parsed.evidence.trim()) {
      suggestion.evidence = parsed.evidence.trim().slice(0, 200);
    }
    return suggestion;
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

const NARRATIVE_PHASE_MINUTES: Record<NarrativeTimePhase, number> = {
  late_night: 1 * 60,
  dawn: 5 * 60,
  morning: 8 * 60,
  noon: 12 * 60,
  afternoon: 14 * 60,
  dusk: 18 * 60,
  evening: 19 * 60,
  night: 21 * 60,
};

const NARRATIVE_DAY_PART_PHASES: Record<string, NarrativeTimePhase> = {
  凌晨: 'late_night',
  黎明: 'dawn',
  破晓: 'dawn',
  清晨: 'dawn',
  早晨: 'morning',
  早上: 'morning',
  上午: 'morning',
  中午: 'noon',
  正午: 'noon',
  午后: 'afternoon',
  下午: 'afternoon',
  傍晚: 'dusk',
  薄暮: 'dusk',
  黄昏: 'dusk',
  晚上: 'evening',
  入夜: 'night',
  夜晚: 'night',
  深夜: 'late_night',
  午夜: 'late_night',
  子夜: 'late_night',
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

function phaseMinute(phase: NarrativeTimePhase): number {
  return NARRATIVE_PHASE_MINUTES[phase];
}

function parseNarrativeNumber(raw: string): number | null {
  const value = raw.trim();
  if (value === '半') return 0.5;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  let total = 0;
  let pending = 0;
  for (const character of value) {
    if (character in digits) {
      pending = digits[character];
      continue;
    }
    const unit = character === '十' ? 10 : character === '百' ? 100 : character === '千' ? 1_000 : 0;
    if (!unit) return null;
    total += (pending || 1) * unit;
    pending = 0;
  }
  return total + pending;
}

function replaceRangeWithSpaces(text: string, start: number, end: number): string {
  return `${text.slice(0, start)}${' '.repeat(Math.max(0, end - start))}${text.slice(end)}`;
}

/** Remove dialogue, recollection and plans before looking for elapsed-time facts. */
function maskNonCurrentTimeReferences(input: string): string {
  let text = input;
  const quotePattern = /“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|\"[^\"\n]*\"/g;
  for (const match of [...text.matchAll(quotePattern)].reverse()) {
    if (match.index != null) text = replaceRangeWithSpaces(text, match.index, match.index + match[0].length);
  }
  const timeHint = /(?:凌晨|黎明|清晨|早晨|上午|中午|正午|午后|下午|傍晚|薄暮|黄昏|晚上|夜晚|深夜|午夜|今晚|昨夜|昨晚|明天|第二天|次日|翌日|隔天|\d+\s*(?:分钟|小时|天|日|周)后)/;
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

type NarrativeEvidenceStrength = 'high' | 'soft';
type NarrativeEventKind = 'duration' | 'phase' | 'next-day' | 'exact-date' | 'meal' | 'sleep';

interface NarrativeTimeEvent {
  index: number;
  end: number;
  kind: NarrativeEventKind;
  strength: NarrativeEvidenceStrength;
  label: string;
  minutes?: number;
  phase?: NarrativeTimePhase;
  target?: WorldClockDate;
  forceNextDay?: boolean;
}

interface NarrativeTimeInference extends TimeAdvanceSuggestion {
  strength: NarrativeEvidenceStrength;
}

function addNarrativeEvent(events: NarrativeTimeEvent[], event: NarrativeTimeEvent): void {
  const duplicate = events.some(existing => existing.index === event.index
    && existing.end === event.end
    && existing.kind === event.kind
    && existing.phase === event.phase
    && existing.minutes === event.minutes);
  const overlappingDuration = event.kind === 'duration' && events.some(existing => existing.kind === 'duration'
    && existing.minutes === event.minutes
    && event.index < existing.end
    && event.end > existing.index);
  if (!duplicate && !overlappingDuration) events.push(event);
}

function resolveModelTimeAdvance(suggestion: TimeAdvanceSuggestion, rawClock: WorldClockState): TimeAdvanceSuggestion {
  if (!suggestion.targetPhase) return suggestion;
  const clock = normalizeWorldClockState(rawClock);
  const currentMinute = clock.current.hour * 60 + clock.current.minute;
  const explicitDayOffset = suggestion.dayOffset ?? 0;
  let anchorMinutes = explicitDayOffset * 1_440 + phaseMinute(suggestion.targetPhase) - currentMinute;
  if (
    anchorMinutes < 0
    && suggestion.dayOffset == null
    && /(?:次日|翌日|第二天|隔天|过夜|一夜|醒来)/.test(`${suggestion.reason} ${suggestion.evidence || ''}`)
  ) anchorMinutes += 1_440;
  if (anchorMinutes <= suggestion.minutes || anchorMinutes < 0 || anchorMinutes > MAX_TIME_ADVANCE_MINUTES) return suggestion;
  return {
    ...suggestion,
    minutes: anchorMinutes,
    reason: suggestion.reason || '正文推进至新的时段',
  };
}

/**
 * Build a chronological mini-timeline from completed facts in the visible
 * narrative. This is both a fallback for lightweight models and a guardrail
 * against a mechanical `+1 hour` metadata guess. Dialogue, memories and plans
 * are masked first so merely mentioning tomorrow or last night cannot move the
 * authoritative clock.
 */
export function inferNarrativeTimeAdvance(rawText: string, rawClock: WorldClockState): NarrativeTimeInference | null {
  const visibleText = stripTimeAdvanceTags(rawText).replace(/<[^>]+>/g, '').trim();
  if (!visibleText) return null;
  const clock = normalizeWorldClockState(rawClock);
  const text = maskNonCurrentTimeReferences(visibleText);
  if (!text.trim()) return null;
  const events: NarrativeTimeEvent[] = [];

  const exactDatePattern = /((?:\d{1,6}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)(?:\s*(?:凌晨|深夜|清晨|早上|上午|中午|正午|下午|傍晚|黄昏|晚上|夜晚)?\s*\d{1,2}\s*(?:点|时)(?:\s*\d{1,2}\s*分)?)?)/g;
  for (const match of text.matchAll(exactDatePattern)) {
    if (match.index == null) continue;
    const target = parseLegacyCurrent(clock.calendar, match[1], clock.current);
    if (target) addNarrativeEvent(events, {
      index: match.index, end: match.index + match[0].length, kind: 'exact-date', strength: 'high',
      label: '明确日期', target,
    });
  }

  const dayPartWords = '凌晨|黎明|破晓|深夜|午夜|子夜|清晨|早晨|早上|上午|中午|正午|午后|下午|傍晚|薄暮|黄昏|晚上|入夜|夜晚';
  const nextDayPattern = new RegExp(`(?:第二天|次日|翌日|隔日|隔天)(?:的)?\\s*(${dayPartWords})?`, 'g');
  for (const match of text.matchAll(nextDayPattern)) {
    if (match.index == null) continue;
    addNarrativeEvent(events, {
      index: match.index, end: match.index + match[0].length, kind: 'next-day', strength: 'high',
      label: match[1] ? `次日${match[1]}` : '次日', phase: NARRATIVE_DAY_PART_PHASES[match[1] || '上午'] || 'morning',
      forceNextDay: true,
    });
  }

  const numberToken = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千]+|半)';
  const unitToken = '(分钟|分|小时|小時|天|日|周|週|月)';
  const durationPatterns = [
    new RegExp(`(${numberToken})\\s*(?:个)?\\s*${unitToken}(?:之后|以后|后|过去)`, 'g'),
    new RegExp(`(?:又|再|随后)?\\s*(?:过了|过去了|经过了?|经历了?|持续了?|耗费了?|花了?)\\s*(${numberToken})\\s*(?:个)?\\s*${unitToken}`, 'g'),
  ];
  for (const pattern of durationPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue;
      const value = parseNarrativeNumber(match[1]);
      if (value == null || value <= 0) continue;
      addNarrativeEvent(events, {
        index: match.index, end: match.index + match[0].length, kind: 'duration', strength: 'high',
        label: match[0].trim(), minutes: durationToMinutes(value, match[2]),
      });
    }
  }

  const lexicalDurations: Record<string, number> = {
    片刻: 5, 少顷: 5, 须臾: 5, 一会儿: 10, 不久: 15, 半晌: 30, 良久: 45, 许久: 60,
  };
  const lexicalPattern = /(?:又|再|随后)?(?:过了|等待了?|等了)?\s*(片刻|少顷|须臾|一会儿|不久|半晌|良久|许久)(?!以前|之前|前)(?:之后|以后|后|过去)?/g;
  for (const match of text.matchAll(lexicalPattern)) {
    if (match.index == null) continue;
    addNarrativeEvent(events, {
      index: match.index, end: match.index + match[0].length, kind: 'duration', strength: 'soft',
      label: match[1], minutes: lexicalDurations[match[1]],
    });
  }

  const phaseCues: Array<[NarrativeTimePhase, RegExp]> = [
    ['dawn', /凌晨|清晨|破晓|黎明|晨曦(?:初露|浮现)|天边泛白|天色(?:渐渐|逐渐)?亮(?:了|起来)|鸡鸣/g],
    ['morning', /早晨|一大早|晨光(?:照进|洒入|透入)|朝阳(?:升起|初升)/g],
    ['noon', /正午|中午|晌午|日上中天|太阳(?:升至|悬在)头顶/g],
    ['afternoon', /午后|下午/g],
    ['dusk', /薄暮|黄昏|暮色(?:降临|四合|渐浓)|夕阳(?:渐渐)?(?:西斜|落下|沉入)|日落|天色(?:渐渐|逐渐)?暗(?:下|了|下来)|影子(?:渐渐)?拉长/g],
    ['evening', /傍晚|华灯初上|街灯(?:逐一|陆续|纷纷)?亮起|灯火初上/g],
    ['night', /入夜|夜幕(?:降临|低垂)|夜色(?:笼罩|降临|渐深)|繁星(?:出现|点点)|月亮(?:升起|爬上)|万家灯火/g],
    ['late_night', /午夜|子夜|深夜|夜深(?:人静)?/g],
  ];
  for (const [phase, pattern] of phaseCues) {
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue;
      addNarrativeEvent(events, {
        index: match.index, end: match.index + match[0].length, kind: 'phase', strength: 'high',
        label: match[0], phase,
      });
    }
  }

  const mealPattern = /(?:(?:吃|用|享用)(?:完|过|罢)?(?:了)?\s*(早饭|早餐|午饭|午餐|中饭|晚饭|晚餐)|(?:早饭|早餐|午饭|午餐|中饭|晚饭|晚餐)\s*(?:已经)?(?:吃完|用完|用毕|结束))/g;
  for (const match of text.matchAll(mealPattern)) {
    if (match.index == null) continue;
    const prefix = text.slice(Math.max(0, match.index - 6), match.index);
    if (/(?:准备|打算|正要|想要|计划)/.test(prefix)) continue;
    const meal = match[1] || match[0];
    const isBreakfast = /早饭|早餐/.test(meal);
    const isLunch = /午饭|午餐|中饭/.test(meal);
    addNarrativeEvent(events, {
      index: match.index, end: match.index + match[0].length, kind: 'meal', strength: 'soft',
      label: isBreakfast ? '完成早餐' : isLunch ? '完成午餐' : '完成晚餐',
      phase: isBreakfast ? 'morning' : isLunch ? 'noon' : 'evening',
      minutes: isBreakfast ? 20 : isLunch ? 30 : 40,
    });
  }

  const sleepPattern = /一夜(?:悄然)?过去|一觉(?:醒来|睡到)|睡醒(?:时|后)?|从睡梦中醒来|醒来时|睁开眼(?:时)?/g;
  for (const match of text.matchAll(sleepPattern)) {
    if (match.index == null) continue;
    const nearbyNextDay = events.some(event => event.kind === 'next-day'
      && event.index >= match.index && event.index - match.index < 40);
    const nearbyExplicitDuration = events.some(event => event.kind === 'duration' && event.strength === 'high'
      && Math.abs(event.index - match.index) < 40);
    if (nearbyNextDay || nearbyExplicitDuration) continue;
    const context = text.slice(Math.max(0, match.index - 32), Math.min(text.length, match.index + match[0].length + 32));
    const isNap = /午睡|小憩|打盹/.test(context);
    const isOvernight = !isNap && (/(?:一夜|天亮|晨光|黎明|清晨|早晨|翌日|第二天|晚饭|晚餐|睡下|入睡|就寝)/.test(context)
      || clock.current.hour >= 18);
    addNarrativeEvent(events, {
      index: match.index, end: match.index + match[0].length, kind: 'sleep', strength: isOvernight ? 'high' : 'soft',
      label: isNap ? '小憩后醒来' : isOvernight ? '过夜后醒来' : '睡眠后醒来',
      minutes: isOvernight ? undefined : isNap ? 60 : 8 * 60,
      phase: isOvernight ? 'morning' : undefined,
      forceNextDay: isOvernight,
    });
  }

  const priority: Record<NarrativeEventKind, number> = {
    'exact-date': 0, 'next-day': 1, duration: 2, meal: 3, sleep: 4, phase: 5,
  };
  events.sort((a, b) => a.index - b.index || priority[a.kind] - priority[b.kind] || a.end - b.end);

  let cursor = { ...clock.current };
  let elapsed = 0;
  let strongest: NarrativeEvidenceStrength = 'soft';
  const appliedLabels: string[] = [];
  const advanceCursor = (minutesInput: number, event: NarrativeTimeEvent): void => {
    const minutes = Math.min(MAX_TIME_ADVANCE_MINUTES - elapsed, Math.max(0, Math.round(minutesInput)));
    if (minutes <= 0) return;
    cursor = addMinutesToDate(clock.calendar, cursor, minutes);
    elapsed += minutes;
    if (event.strength === 'high') strongest = 'high';
    if (!appliedLabels.includes(event.label)) appliedLabels.push(event.label);
  };
  const moveToPhase = (phase: NarrativeTimePhase, event: NarrativeTimeEvent): void => {
    const currentMinute = cursor.hour * 60 + cursor.minute;
    const targetMinute = phaseMinute(phase);
    let dayOffset = event.forceNextDay ? 1 : 0;
    if (!event.forceNextDay && targetMinute < currentMinute) {
      const isNewDayPhase = (phase === 'late_night' && currentMinute >= 5 * 60 && currentMinute < 21 * 60)
        || (['dawn', 'morning', 'noon', 'afternoon'].includes(phase) && currentMinute >= 18 * 60);
      if (isNewDayPhase) dayOffset = 1;
      else return;
    }
    advanceCursor(dayOffset * 1_440 + targetMinute - currentMinute, event);
  };

  for (const event of events) {
    if (elapsed >= MAX_TIME_ADVANCE_MINUTES) break;
    if (event.kind === 'exact-date' && event.target) {
      advanceCursor(absoluteMinutes(clock.calendar, event.target) - absoluteMinutes(clock.calendar, cursor), event);
    } else if (event.kind === 'next-day' && event.phase) {
      moveToPhase(event.phase, event);
    } else if (event.kind === 'phase' && event.phase) {
      moveToPhase(event.phase, event);
    } else if (event.kind === 'meal' && event.phase) {
      moveToPhase(event.phase, event);
      advanceCursor(event.minutes || 0, event);
    } else if (event.kind === 'sleep') {
      if (event.phase) moveToPhase(event.phase, event);
      else advanceCursor(event.minutes || 0, event);
    } else if (event.kind === 'duration') {
      advanceCursor(event.minutes || 0, event);
    }
  }

  if (elapsed <= 0) return null;
  return {
    minutes: elapsed,
    reason: `正文时间线：${appliedLabels.slice(-3).join('、') || '场景自然推进'}`,
    strength: strongest,
  };
}

export interface ResolvedTimeAdvance extends TimeAdvanceSuggestion {
  source: 'ai' | 'narrative' | 'player-explicit';
}

function durationToMinutes(value: number, unit: string): number {
  const multiplier = /小时|小時/.test(unit) ? 60
    : /天|日/.test(unit) ? 1_440
      : /周|週/.test(unit) ? 10_080
        : /月/.test(unit) ? 43_200
          : 1;
  return Math.min(MAX_TIME_ADVANCE_MINUTES, Math.max(1, Math.round(value * multiplier)));
}

/**
 * Last-resort fallback for a direct player command with an explicit duration.
 * Intentional verb gating avoids treating questions or quoted durations as
 * elapsed time. Ambiguous turns deliberately return null instead of ticking a
 * world-default amount that may contradict the visible narrative.
 */
export function inferExplicitPlayerTimeAdvance(userText: string): TimeAdvanceSuggestion | null {
  const text = (userText || '').trim();
  if (!text) return null;
  if (/[?？]/.test(text) || /(?:是否|会不会|要不要|能不能|多久|多少(?:分钟|小时|天)|够不够)/.test(text)) return null;
  const match = text.match(/(?:等待?|休息|停留|跳过|快进|度过|耗时|花(?:上|费)?|训练|修炼|学习|工作|赶路|旅行|睡(?:眠|觉)?)[^。！？!?\n]{0,18}?(\d+(?:\.\d+)?)\s*(分钟|分|小时|小時|天|日|周|週|月)/i);
  if (!match) return null;
  return {
    minutes: durationToMinutes(Number(match[1]), match[2]),
    reason: '玩家明确要求经过这段时间',
  };
}

/**
 * Resolve one turn's clock delta by evidence strength. Explicit time written
 * in the visible narrative wins over metadata, then model metadata, then a
 * direct player duration command. With no evidence the clock stays put.
 */
export function resolveTurnTimeAdvance(input: {
  rawResponse: string;
  narrativeText: string;
  userText: string;
  clock: WorldClockState;
}): ResolvedTimeAdvance | null {
  const narrative = inferNarrativeTimeAdvance(input.narrativeText, input.clock);
  if (narrative?.strength === 'high') {
    return { minutes: narrative.minutes, reason: narrative.reason, source: 'narrative' };
  }
  const parsedAi = parseTimeAdvance(input.rawResponse);
  const ai = parsedAi ? resolveModelTimeAdvance(parsedAi, input.clock) : null;
  if (narrative && (!ai || narrative.minutes > ai.minutes)) {
    return { minutes: narrative.minutes, reason: narrative.reason, source: 'narrative' };
  }
  if (ai) return { ...ai, source: 'ai' };
  const explicitPlayer = inferExplicitPlayerTimeAdvance(input.userText);
  return explicitPlayer ? { ...explicitPlayer, source: 'player-explicit' } : null;
}

export function estimateTurnMinutes(userText: string, configInput?: Partial<WorldClockConfig>): { minutes: number; reason: string } {
  const text = userText || '';
  const config = normalizeTimeSystemConfig(configInput);
  const explicit = text.match(/(\d+(?:\.\d+)?)\s*(分钟|分|小时|小時|天|日|周|週|月)/i);
  if (explicit) {
    const value = Number(explicit[1]);
    const unit = explicit[2].toLowerCase();
    return { minutes: durationToMinutes(value, unit), reason: '用户明确说明的时长' };
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
