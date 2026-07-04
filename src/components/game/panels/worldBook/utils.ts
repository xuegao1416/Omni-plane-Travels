import { findWorldDef } from '../../../../data/worldLoader';
import type { WorldBookEntryDef } from '../../../../data/worlds-schema';
import type { MappedEntry } from './types';

/** Map raw WorldBookEntryDef[] into MappedEntry[] */
export function mapEntries(worldId: string): MappedEntry[] {
  const world = findWorldDef(worldId);
  const wbEntries: WorldBookEntryDef[] = world?.worldBookEntries ?? [];

  return wbEntries.map((e: WorldBookEntryDef, i: number) => ({
    id: e.uid != null ? `${e.uid}-${i}` : `entry-${i}`,
    comment: e.comment ?? '',
    content: e.content ?? '',
    constant: !!e.constant,
    enabled: !e.disable,
    keys: e.key ?? [],
    position: (e.position ?? 'after_char') as 'before_char' | 'after_char',
    order: e.order ?? 0,
    depth: e.depth ?? 0,
    entryType: e.entryType,
  }));
}

/** Filter entries by search text and disabled-toggle */
export function filterEntries(
  entries: MappedEntry[],
  search: string,
  showDisabled: boolean,
): MappedEntry[] {
  let result = entries;
  if (!showDisabled) {
    result = result.filter(e => e.enabled);
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(e =>
      (e.comment ?? '').toLowerCase().includes(q) ||
      (e.content ?? '').toLowerCase().includes(q) ||
      (e.keys ?? []).some((k: string) => (k ?? '').toLowerCase().includes(q))
    );
  }
  return result;
}

/** Group entries into constant / keyword-triggered / other */
export interface GroupedEntries {
  constant: MappedEntry[];
  triggered: MappedEntry[];
  other: MappedEntry[];
}

export function groupEntries(entries: MappedEntry[]): GroupedEntries {
  return {
    constant: entries.filter(e => e.constant),
    triggered: entries.filter(e => !e.constant && e.keys.length > 0),
    other: entries.filter(e => !e.constant && e.keys.length === 0),
  };
}
