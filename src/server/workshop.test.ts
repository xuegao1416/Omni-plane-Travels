import { describe, expect, test } from 'bun:test';
import { checkDependencies, resolveInstallPlan, toPublic, validateWorkshopContent } from './workshop';
import type { WorkshopItemRow } from './types';

function row(overrides: Partial<WorkshopItemRow> = {}): WorkshopItemRow {
  return {
    id: 'item', owner_id: 'owner', type: 'world_package', content_type: 'gameplay_module',
    title: 'Module', description: null, tags: '[]', data_json: '{}', status: 'published',
    download_count: 3, created_at: 1, updated_at: 2, category: 'rules',
    dependencies_json: '[{"id":"core","version":"2.9.0"}]', recommendations_json: '[]', version: '1.0.0', min_app_version: '3.0.0',
    compatibility_json: '{"web":true}', featured: 1,
    screenshots_json: '["https://example.com/shot.webp"]',
    ...overrides,
  };
}

describe('workshop v2 metadata', () => {
  test('rejects malformed publishable content and accepts each supported shape', () => {
    const valid: Record<string, unknown> = {
      world_package: { id: 'world-a', name: 'World A', description: 'A world', modules: [] },
      npc_template: { id: 'npc-template', name: 'NPC', npc: { name: 'NPC', gender: 'unknown' } },
      gameplay_module: { kind: 'custom-gameplay-module', schemaVersion: 1, id: 'mod', name: 'M', version: '1.0.0', author: 'a', scope: 'world', state: {}, logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] }, permissions: { read: [], write: 'own-state-only' } },
      event_pack: { manifest: { id: 'events', name: 'Events', version: '1.0.0', type: 'rule' }, rules: [] },
      workflow_pack: { id: 'flow', name: 'Flow', version: 1, nodes: [], connections: [] },
      adventure_pack: { id: 'adventure', name: 'Adventure', scenes: [] },
      visual_theme: { id: 'theme', name: 'Theme', tokens: {} },
    };

    for (const [type, data] of Object.entries(valid)) {
      expect(validateWorkshopContent(type as never, data).ok).toBe(true);
      expect(validateWorkshopContent(type as never, {}).ok).toBe(false);
    }
    expect(validateWorkshopContent('character_preset', { id: 'player' }).ok).toBe(false);
    expect(validateWorkshopContent('history_preset', { id: 'history', name: 'History', segments: { prologue: '开始' } }).ok).toBe(false);
  });
  test('maps the public content type and discovery metadata', () => {
    const item = toPublic(row());
    expect(item.type).toBe('gameplay_module');
    expect(item.dependencies[0]?.id).toBe('core');
    expect(item.screenshots).toEqual(['https://example.com/shot.webp']);
    expect(item.featured).toBe(true);
  });

  test('compares dependency versions lexicographically', () => {
    expect(checkDependencies(row(), { core: '3.0.0' }).ok).toBe(true);
    expect(checkDependencies(row(), { core: '2.8.9' }).incompatible).toHaveLength(1);
    expect(checkDependencies(row(), {}).missing).toHaveLength(1);
  });

  test('builds a recursive install plan in dependency order', async () => {
    const rows: Record<string, WorkshopItemRow> = {
      root: row({ id: 'root', version: '1.0.0', dependencies_json: '[{"id":"module-a","version":"1.0.0"}]' }),
      'module-a': row({ id: 'module-a', version: '1.2.0', dependencies_json: '[{"id":"module-b","version":"1.0.0"}]' }),
      'module-b': row({ id: 'module-b', version: '1.1.0', dependencies_json: '[]' }),
    };
    const result = await resolveInstallPlan('root', async id => rows[id] ?? null);
    expect(result.ok).toBe(true);
    expect(result.items.map(item => item.id)).toEqual(['module-b', 'module-a', 'root']);
    expect(result.errors).toEqual([]);
  });

  test('reports cycles, missing dependencies, and incompatible versions', async () => {
    const rows: Record<string, WorkshopItemRow> = {
      root: row({ id: 'root', dependencies_json: '[{"id":"cycle-a","version":"2.0.0"},{"id":"missing","version":"1.0.0"}]' }),
      'cycle-a': row({ id: 'cycle-a', version: '1.0.0', dependencies_json: '[{"id":"root","version":"1.0.0"}]' }),
    };
    const result = await resolveInstallPlan('root', async id => rows[id] ?? null);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.code === 'CYCLE')).toBe(true);
    expect(result.errors.some(error => error.code === 'MISSING')).toBe(true);
    expect(result.errors.some(error => error.code === 'INCOMPATIBLE')).toBe(true);
  });

  test('keeps world recommendations in the structured plan', async () => {
    const root = row({
      id: 'world',
      content_type: 'world_package',
      dependencies_json: '[]',
      recommendations_json: '[{"id":"npc-1","type":"npc_template","optional":true,"reason":"推荐角色"}]',
    });
    const result = await resolveInstallPlan('world', async id => id === 'world' ? root : null);
    expect(result.recommendations).toEqual([{ id: 'npc-1', type: 'npc_template', optional: true, reason: '推荐角色' }]);
    expect(result.errors).toEqual([]);
  });

  test('does not block installation on an optional dependency', async () => {
    const root = row({ id: 'root', dependencies_json: '[{"id":"optional-ui","optional":true}]' });
    const result = await resolveInstallPlan('root', async id => id === 'root' ? root : null);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('checks every version constraint for a shared dependency', async () => {
    const rows: Record<string, WorkshopItemRow> = {
      root: row({ id: 'root', dependencies_json: '[{"id":"branch-a"},{"id":"branch-b"}]' }),
      'branch-a': row({ id: 'branch-a', dependencies_json: '[{"id":"shared","version":"1.0.0"}]' }),
      'branch-b': row({ id: 'branch-b', dependencies_json: '[{"id":"shared","version":"3.0.0"}]' }),
      shared: row({ id: 'shared', version: '2.0.0', dependencies_json: '[]' }),
    };
    const result = await resolveInstallPlan('root', async id => rows[id] ?? null);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'INCOMPATIBLE', id: 'shared', requiredVersion: '3.0.0', actualVersion: '2.0.0',
    }));
  });
});
