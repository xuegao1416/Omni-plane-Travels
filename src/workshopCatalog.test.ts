import { describe, expect, test } from 'bun:test';
import { LOCAL_ASSET_TYPES, LOCAL_ONLY_ASSET_TYPES, PUBLIC_WORKSHOP_TYPES } from './workshopCatalog';

describe('workshop and local asset catalog', () => {
  test('keeps local-only presets private and mirrors every public workshop type locally', () => {
    expect(PUBLIC_WORKSHOP_TYPES).toEqual([
      'world_package',
      'npc_template',
      'gameplay_module',
      'event_pack',
      'workflow_pack',
      'adventure_pack',
      'visual_theme',
    ]);
    expect(LOCAL_ONLY_ASSET_TYPES).toEqual(['character_preset', 'history_preset']);
    expect(LOCAL_ASSET_TYPES).toEqual([...PUBLIC_WORKSHOP_TYPES, ...LOCAL_ONLY_ASSET_TYPES]);
  });
});
