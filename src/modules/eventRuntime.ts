import type { EventRuntimePack } from './eventApi';

/** Keep global packs and packs explicitly bound to the active world. */
export function selectRuntimePacksForWorld(
  packs: readonly EventRuntimePack[],
  worldId?: string,
): EventRuntimePack[] {
  if (!worldId) return [...packs];
  return packs.filter((pack) => !pack.manifest.worldId || pack.manifest.worldId === worldId);
}
