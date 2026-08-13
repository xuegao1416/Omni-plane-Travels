import type { WorldClockConfig } from '../time/worldClock';

const gregorianMonths = [
  ['一月', 31], ['二月', 28], ['三月', 31], ['四月', 30], ['五月', 31], ['六月', 30],
  ['七月', 31], ['八月', 31], ['九月', 30], ['十月', 31], ['十一月', 30], ['十二月', 31],
].map(([name, days]) => ({ name: String(name), days: Number(days) }));

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function gregorian(start: WorldClockConfig['start'], defaultTurnMinutes: number): WorldClockConfig {
  return {
    mode: 'gregorian', calendarName: '公历', eraName: '', start,
    months: gregorianMonths, weekdays, defaultTurnMinutes,
    timeOfDayLabels: [],
  };
}

function custom(calendarName: string, eraName: string, start: WorldClockConfig['start'], defaultTurnMinutes: number): WorldClockConfig {
  return {
    mode: 'custom', calendarName, eraName, start,
    months: Array.from({ length: 12 }, (_, index) => ({ name: `${index + 1}月`, days: 30 })),
    weekdays, defaultTurnMinutes,
    timeOfDayLabels: [],
  };
}

export const BUILTIN_WORLD_CLOCKS: Record<string, WorldClockConfig> = {
  japanese_school: gregorian({ year: 2025, month: 4, day: 7, hour: 8, minute: 0 }, 20),
  desire_metropolis: gregorian({ year: 2025, month: 10, day: 1, hour: 8, minute: 0 }, 30),
  wuxia_world: custom('江湖历', '江湖纪年', { year: 1, month: 1, day: 1, hour: 8, minute: 0 }, 30),
  wasteland_apocalypse: custom('余烬历', '余烬纪年', { year: 207, month: 9, day: 1, hour: 6, minute: 0 }, 45),
  stranded_island: {
    mode: 'relative', calendarName: '生存日数', eraName: '',
    start: { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
    months: Array.from({ length: 12 }, (_, index) => ({ name: `生存月${index + 1}`, days: 30 })),
    weekdays, defaultTurnMinutes: 30, timeOfDayLabels: [],
  },
  border_trade: gregorian({ year: 1993, month: 12, day: 1, hour: 8, minute: 0 }, 30),
};
