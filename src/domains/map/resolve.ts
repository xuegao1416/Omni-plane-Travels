/**
 * 地名对齐：把正文、AI 或界面给出的地点（id / 地名 / 别名 / 带前缀的位置描述）对到地图上的地点。
 */
import type { MapLocation } from './types';

const SEPARATORS = /[\s·・•,，。.、:：;；|/\\()（）[\]【】<>《》"'“”‘’\-—_]+/g;

export function normalizePlaceText(value: string): string {
  return value.replace(SEPARATORS, '').toLowerCase();
}

/** 返回最匹配的地点；找不到返回 undefined。 */
export function resolveLocation(query: unknown, locations: readonly MapLocation[]): MapLocation | undefined {
  if (typeof query !== 'string' && typeof query !== 'number') return undefined;
  const raw = String(query).trim();
  if (!raw) return undefined;
  const byId = locations.find(location => location.id === raw);
  if (byId) return byId;
  const text = normalizePlaceText(raw);
  if (!text) return undefined;
  let best: MapLocation | undefined;
  let bestScore = 0;
  for (const location of locations) {
    const names = [location.name, ...(location.aliases ?? [])].map(normalizePlaceText).filter(Boolean);
    for (const name of names) {
      let score = 0;
      if (name === text) score = 1000 + name.length;
      // 「临安城·北城门」包含「临安城」：位置描述里出现了地名，越长越具体。
      else if (text.includes(name) && name.length >= 2) score = 500 + name.length * 10 - (text.indexOf(name) > 0 ? 1 : 0);
      // 简称：「北城门」→「临安北城门」。
      else if (name.includes(text) && text.length >= 2) score = 200 + text.length * 10 - (name.length - text.length);
      if (score > bestScore) { bestScore = score; best = location; }
    }
  }
  return best;
}

/** 正文里提到了哪些地点（按出现先后，最多 limit 个）。 */
export function mentionedLocations(text: string, locations: readonly MapLocation[], limit = 6): MapLocation[] {
  if (!text) return [];
  const hits: Array<{ location: MapLocation; at: number }> = [];
  for (const location of locations) {
    const names = [location.name, ...(location.aliases ?? [])].filter(name => name.length >= 2);
    let at = -1;
    for (const name of names) {
      const index = text.indexOf(name);
      if (index >= 0 && (at < 0 || index < at)) at = index;
    }
    if (at >= 0) hits.push({ location, at });
  }
  return hits.sort((left, right) => left.at - right.at).slice(0, limit).map(hit => hit.location);
}
