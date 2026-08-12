import type { WorldDef } from './worlds-schema';

export type CustomWorldDeleteReason = 'builtin' | 'referenced' | 'not-found';

export type CustomWorldDeleteResult =
  | { ok: true; worlds: WorldDef[] }
  | { ok: false; reason: CustomWorldDeleteReason; worlds: WorldDef[] };

/**
 * Pure list transition used by the start screen before persistence is updated.
 * A save reference is a hard stop: deleting a world must never cascade into saves.
 */
export function deleteCustomWorldFromList(
  worlds: WorldDef[],
  worldId: string,
  builtinIds: ReadonlySet<string>,
  referencedWorldIds: ReadonlySet<string> = new Set(),
): CustomWorldDeleteResult {
  if (builtinIds.has(worldId)) return { ok: false, reason: 'builtin', worlds };
  if (!worlds.some(world => world.id === worldId)) return { ok: false, reason: 'not-found', worlds };
  if (referencedWorldIds.has(worldId)) return { ok: false, reason: 'referenced', worlds };
  return { ok: true, worlds: worlds.filter(world => world.id !== worldId) };
}
