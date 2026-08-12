import type { CustomNpc } from '../../storage/db';

const EMPTY_VALUES = new Set(['', null, undefined]);

function hasValue(value: unknown): boolean {
  if (EMPTY_VALUES.has(value as string | null | undefined)) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return String(value).trim().length > 0;
}

function comparableNpc(npc: CustomNpc): Record<string, unknown> {
  const { id: _id, ...editableFields } = npc;
  return editableFields;
}

export function isNpcDraftDirty(npc: CustomNpc, initial: CustomNpc | null): boolean {
  if (!initial) return Object.values(comparableNpc(npc)).some(hasValue);
  return JSON.stringify(comparableNpc(npc)) !== JSON.stringify(comparableNpc(initial));
}
