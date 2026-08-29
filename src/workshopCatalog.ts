/** Public workshop categories. Keep this list shared by discovery and local assets. */
export const PUBLIC_WORKSHOP_TYPES = [
  'world_package',
  'npc_template',
  'gameplay_module',
  'event_pack',
  'workflow_pack',
  'adventure_pack',
  'visual_theme',
] as const;

/** These presets may contain private player material and never leave the device. */
export const LOCAL_ONLY_ASSET_TYPES = [
  'character_preset',
  'history_preset',
] as const;

export const LOCAL_ASSET_TYPES = [
  ...PUBLIC_WORKSHOP_TYPES,
  ...LOCAL_ONLY_ASSET_TYPES,
] as const;

export type PublicWorkshopType = typeof PUBLIC_WORKSHOP_TYPES[number];
export type LocalOnlyAssetType = typeof LOCAL_ONLY_ASSET_TYPES[number];
export type WorkshopAssetType = typeof LOCAL_ASSET_TYPES[number];

const PUBLIC_WORKSHOP_TYPE_SET = new Set<string>(PUBLIC_WORKSHOP_TYPES);
const LOCAL_ONLY_ASSET_TYPE_SET = new Set<string>(LOCAL_ONLY_ASSET_TYPES);

export function isPublicWorkshopType(value: string): value is PublicWorkshopType {
  return PUBLIC_WORKSHOP_TYPE_SET.has(value);
}

export function isLocalOnlyAssetType(value: string): value is LocalOnlyAssetType {
  return LOCAL_ONLY_ASSET_TYPE_SET.has(value);
}
