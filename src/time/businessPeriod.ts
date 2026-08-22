import type { WorldClockConfig, WorldClockState } from './worldClock';
import { getWorldClockPeriodKeys } from './worldClock';

/** Returns a stable settlement key, preferring the authoritative clock. */
export function getBusinessSettlementPeriodKey(
  cycleName: string,
  worldTime: string,
  turnId?: string,
  clock?: WorldClockState,
  config?: WorldClockConfig,
): string | null {
  if (/回合|轮/.test(cycleName)) return `turn:${turnId || worldTime || 'unknown'}`;
  if (clock) {
    if (!config) return null;
    const keys = getWorldClockPeriodKeys(clock, config);
    if (/月/.test(cycleName)) return keys.monthKey;
    if (/周|星期/.test(cycleName)) return keys.weekKey;
    return keys.dayKey;
  }
  if (!worldTime.trim()) return null;

  const normalized = worldTime.trim().replace(/\s+/g, ' ');
  if (/月/.test(cycleName)) {
    const month = normalized.match(/(\d{2,4})\s*[年\/-]\s*(\d{1,2})\s*月?/);
    return month ? `month:${month[1]}-${month[2]}` : `month:${normalized.replace(/(?:清晨|早晨|上午|中午|下午|傍晚|晚上|夜晚|深夜).*/, '')}`;
  }
  if (/周|星期/.test(cycleName)) {
    const explicitWeek = normalized.match(/第?\s*(\d+)\s*(?:周|星期)/);
    if (explicitWeek) return `week:${explicitWeek[1]}`;
    const date = normalized.match(/(\d{2,4})\s*[年\/-]\s*(\d{1,2})\s*[月\/-]\s*(\d{1,2})\s*日?/);
    if (date) {
      const day = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
      return `week:${Math.floor(day / 604800000)}`;
    }
    return `week:${normalized}`;
  }

  const day = normalized.match(/(?:第\s*(\d+)\s*天)|(\d{2,4}\s*[年\/-]\s*\d{1,2}\s*[月\/-]\s*\d{1,2}\s*日?)/);
  if (day) return `day:${day[1] || day[2].replace(/\s+/g, '')}`;
  return `day:${normalized.replace(/(?:清晨|早晨|上午|中午|下午|傍晚|晚上|夜晚|深夜).*/, '').trim()}`;
}
