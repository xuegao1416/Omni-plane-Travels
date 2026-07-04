import type { WorldBookEntryDef } from '../../../data/worlds-schema';

/** Find a single entry by entryType from worldBookEntries */
export function findEntryByType(entries: WorldBookEntryDef[] | undefined, type: string): WorldBookEntryDef | undefined {
  return entries?.find(e => e.entryType === type);
}

/** Find all entries matching entryType from worldBookEntries */
export function findAllEntriesByType(entries: WorldBookEntryDef[] | undefined, type: string): WorldBookEntryDef[] {
  return entries?.filter(e => e.entryType === type) ?? [];
}
