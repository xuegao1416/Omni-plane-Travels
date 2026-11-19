import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { STORAGE_KEYS } from '../config/storageKeys';
import { WORLDS } from '../data/worldLoader';
import { clearCustomGameplayModules, getCustomGameplayModule, getCustomGameplayModulesForWorld } from '../custom-modules/storage';
import { allWebEvents, deleteWebEvent, getWebEvent } from '../modules/eventDb';
import { compileRuntimePack } from '../events/catalog';
import { readCanonicalEventPack } from '../modules/eventPackFormat';
import { putGlobal } from '../storage/db';
import { getNpcTemplates } from '../storage/templateStore';
import { WorkshopApiError, type WorkshopApi } from './api';
import { compileAdventure } from './adventure';
import { installWorkshopContent } from './installers';
import { listInstalls } from './installs';
import { compareVersions, resolvePublishVersion, workshopContentId, type WorkshopItemSummary } from './protocol';
import { getPublication, publishLocalAsset } from './publish';
import { executeInstall, previewInstall, previewUninstall, uninstall } from './service';
import { themeCss, themePalettes, toRgbTriple } from './visualTheme';

const moduleDefinition = (id = 'workshop-module') => ({
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id,
  name: 'Workshop Module',
  version: '1.0.0',
  author: 'test',
  scope: 'world',
  state: { count: { type: 'number', default: 0 } },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] },
  permissions: { read: [], write: 'own-state-only' },
});

const meta = (id: string, type: WorkshopItemSummary['type'], version = '1.0.0') => ({ id, type: type as never, version, title: `条目 ${id}`, authorName: '作者' });

function customWorlds(): Array<{ id: string; name: string }> {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
}

async function resetLocal() {
  localStorage.removeItem(STORAGE_KEYS.CUSTOM_WORLDS);
  localStorage.removeItem(STORAGE_KEYS.NPC_TEMPLATES);
  await clearCustomGameplayModules();
  for (const record of await allWebEvents()) await deleteWebEvent(record.id);
  for (const key of ['workshopInstalls.v1', 'workshopRuntimeAssets.v1', 'workshopPublications.v1']) await putGlobal(key, []);
}

beforeEach(resetLocal);
afterEach(resetLocal);

/** 内存里的工坊：按条目的 dependencies 生成安装计划，下载返回登记的数据。 */
function fakeWorkshop(entries: Array<{ item: Partial<WorkshopItemSummary> & { id: string; type: WorkshopItemSummary['type'] }; data: unknown }>) {
  const store = new Map(entries.map(entry => [entry.item.id, entry]));
  const summary = (id: string): WorkshopItemSummary => {
    const entry = store.get(id)!;
    return {
      ownerId: 'owner', author: { id: 'owner', name: '作者' }, contentType: entry.item.type, contentId: workshopContentId(entry.item.type, entry.data),
      version: '1.0.0', title: `条目 ${id}`, description: null, changelog: null, tags: [], category: null, status: 'published', downloadCount: 0,
      favoriteCount: 0, ratingCount: 0, ratingAverage: null, createdAt: 1, updatedAt: 1, dependencies: [], recommendations: [], minAppVersion: null,
      compatibility: {}, featured: false, screenshots: [], dataSize: 1, ...entry.item,
    } as WorkshopItemSummary;
  };
  const downloads: string[] = [];
  const api = {
    plan: async (rootId: string) => {
      const items: WorkshopItemSummary[] = [];
      const visit = (id: string) => {
        if (items.some(item => item.id === id)) return;
        for (const dependency of summary(id).dependencies) visit(dependency.id);
        items.push(summary(id));
      };
      visit(rootId);
      return { ok: true, rootId, items, recommendations: [], errors: [] };
    },
    download: async (id: string) => {
      downloads.push(id);
      const entry = store.get(id)!;
      return { id, type: entry.item.type, version: summary(id).version, title: summary(id).title, data: entry.data } as never;
    },
    updates: async (ids: readonly string[]) => ids.filter(id => store.has(id)).map(id => ({ id, title: summary(id).title, version: summary(id).version, status: 'published' as const, updatedAt: 1 })),
  };
  return {
    api: api as unknown as WorkshopApi,
    downloads,
    set(id: string, patch: { item?: Partial<WorkshopItemSummary>; data?: unknown }) {
      const entry = store.get(id)!;
      store.set(id, { item: { ...entry.item, ...patch.item }, data: patch.data ?? entry.data });
    },
  };
}

describe('workshop installers', () => {
  test('binds a module only to the explicit target world, and rollback removes it', async () => {
    const operation = await installWorkshopContent({ item: meta('workshop-item', 'gameplay_module'), data: moduleDefinition(), worldId: 'world-a' });
    expect((await getCustomGameplayModulesForWorld('world-a')).map(item => item.module.id)).toEqual(['workshop-module']);
    expect(await getCustomGameplayModulesForWorld('world-b')).toEqual([]);
    await operation.rollback();
    expect(await getCustomGameplayModulesForWorld('world-a')).toEqual([]);
  });

  test('never shadows a built-in world and only overwrites a local world when asked to', async () => {
    const builtin = WORLDS[0];
    const copy = await installWorkshopContent({ item: meta('item-a1b2c3', 'world_package'), data: { id: builtin.id, name: '同名世界', description: 'x' }, conflict: 'replace' });
    expect(copy.targets[0].id).toBe(`${builtin.id}-wsitema1`);
    expect(copy.warnings[0]).toContain('另存');

    localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify([{ id: 'mine', name: '我自己的世界', description: '' }]));
    const kept = await installWorkshopContent({ item: meta('item-x', 'world_package'), data: { id: 'mine', name: '工坊世界', description: 'x' } });
    expect(customWorlds().map(world => world.name)).toEqual(['我自己的世界', '工坊世界']);
    await kept.rollback();
    expect(customWorlds().map(world => world.name)).toEqual(['我自己的世界']);

    await installWorkshopContent({ item: meta('item-x', 'world_package'), data: { id: 'mine', name: '工坊世界', description: 'x' }, conflict: 'replace' });
    expect(customWorlds().map(world => world.name)).toEqual(['工坊世界']);
  });
});

describe('adventure packs', () => {
  const adventure = {
    id: 'Lost-Temple', name: '失落神殿', description: '一段短冒险',
    scenes: [
      { id: 'gate', title: '神殿大门', text: '石门半掩。', options: [{ label: '推门而入', next: 'hall', effects: [{ stat: 'attrB', delta: -5 }] }, { label: '离开' }] },
      { id: 'hall', title: '大厅', text: '壁画在火光里晃动。' },
      { id: 'treasure', title: '宝库', text: '金光一片。', options: [{ label: '收下宝物', effects: [{ currency: 50 }] }] },
      { id: 'orphan', title: '无人知晓', text: '没有路通向这里。', options: [{ label: '回去' }] },
      { id: 'epilogue', title: '尾声', text: '多年以后。', trigger: { on: ['turn.ended'], when: { fact: 'flags.神殿', op: '==', value: true }, once: true } },
    ],
  };

  test('compiles scenes into a readable card pack: one opening trigger, follow-ups out of the deck, linear steps chained', () => {
    const compiled = compileAdventure(adventure, { version: '1.2.0', author: '作者' });
    expect(compiled.packId).toBe('adventure-lost-temple');
    const pack = readCanonicalEventPack(compiled.files);
    // hall 没写选项，自动“继续”接到 treasure；orphan 不可达被跳过；epilogue 有自己的触发器。
    expect(pack.eventIds).toEqual(['gate', 'hall', 'treasure', 'epilogue']);
    expect(compiled.warnings.join('\n')).toContain('无人知晓');
    const definitions = compileRuntimePack({ manifest: compiled.manifest, files: compiled.files } as never, files => [...readCanonicalEventPack(files).workflows]);
    const byId = Object.fromEntries(definitions.map(def => [def.eventId, def]));
    expect(byId.gate.trigger.on).toEqual(['turn.ended']);
    expect(byId.gate.once).toBe(true);
    expect(byId.hall.trigger.on).toEqual([]);
    expect(byId.treasure.trigger.on).toEqual([]);
    expect(byId.epilogue.trigger.on).toEqual(['turn.ended']);
    expect(definitions.some(def => def.trigger.on.includes('deck'))).toBe(false);
    const hallOptions = JSON.parse(pack.workflowByEventId.get('hall')!.nodes.find(node => node.typeId === 'choice.static')!.widgetValues!.options as string);
    expect(hallOptions).toEqual([{ label: '继续', next: 'treasure' }]);
  });

  test('installing keeps the source for editing and adds a disabled card pack that uninstall removes', async () => {
    const workshop = fakeWorkshop([{ item: { id: 'adv-1', type: 'adventure_pack' }, data: adventure }]);
    const preview = await previewInstall('adv-1', workshop.api);
    const result = await executeInstall(preview, {}, workshop.api);
    expect(result.labels[0]).toContain('4 个场景');
    const record = await getWebEvent('adventure-lost-temple');
    expect(record?.enabled).toBe(false);
    expect(record?.manifest.type).toBe('card');
    expect((await listInstalls())[0].targets.map(target => target.kind)).toEqual(['asset', 'event']);
    await uninstall('adv-1');
    expect(await getWebEvent('adventure-lost-temple')).toBeUndefined();
    expect(await listInstalls()).toEqual([]);
  });
});

describe('workshop install service', () => {
  const world = { id: 'fog-harbor', name: '雾港', description: '海雾与蒸汽' };

  test('installs a world with its module dependency, binds the module, records provenance, and skips satisfied dependencies later', async () => {
    const workshop = fakeWorkshop([
      { item: { id: 'mod', type: 'gameplay_module' }, data: moduleDefinition('fog-module') },
      { item: { id: 'world', type: 'world_package', dependencies: [{ id: 'mod', version: '1.0.0' }] }, data: world },
    ]);
    const preview = await previewInstall('world', workshop.api);
    expect(preview.entries.map(entry => [entry.item.id, entry.role, entry.action])).toEqual([['mod', 'dependency', 'install'], ['world', 'root', 'install']]);
    const result = await executeInstall(preview, {}, workshop.api);
    expect(result.worldId).toBe('fog-harbor');
    expect((await getCustomGameplayModulesForWorld('fog-harbor')).map(item => item.module.id)).toEqual(['fog-module']);
    const records = await listInstalls();
    expect(records.find(record => record.itemId === 'mod')).toMatchObject({ explicit: false, requiredBy: ['world'] });
    expect(records.find(record => record.itemId === 'world')).toMatchObject({ explicit: true, requiredBy: [], targets: [{ kind: 'world', id: 'fog-harbor', label: '雾港' }] });

    // 再装一次：依赖已满足，不重新下载；根条目重装。
    workshop.downloads.length = 0;
    const again = await previewInstall('world', workshop.api);
    expect(again.entries.map(entry => entry.action)).toEqual(['skip', 'reinstall']);
    await executeInstall(again, {}, workshop.api);
    expect(workshop.downloads).toEqual(['world']);
    expect(customWorlds()).toHaveLength(1);
  });

  test('updates in place (NPC templates are not duplicated) and drops assets the new version no longer uses', async () => {
    const workshop = fakeWorkshop([
      { item: { id: 'npc', type: 'npc_template' }, data: { id: 'npc-a', name: '老船长', npc: { name: '老船长' } } },
      { item: { id: 'events', type: 'event_pack' }, data: { manifest: { id: 'harbor-events', name: '港口事件', version: '1.0.0', type: 'rule' }, rules: [] } },
    ]);
    await executeInstall(await previewInstall('npc', workshop.api), {}, workshop.api);
    await executeInstall(await previewInstall('events', workshop.api), {}, workshop.api);

    workshop.set('npc', { item: { version: '1.1.0' }, data: { id: 'npc-a', name: '老船长（修订）', npc: { name: '老船长' } } });
    const update = await previewInstall('npc', workshop.api);
    expect(update.entries[0]).toMatchObject({ action: 'update', installedVersion: '1.0.0' });
    await executeInstall(update, {}, workshop.api);
    expect(getNpcTemplates().map(template => template.name)).toEqual(['老船长（修订）']);

    workshop.set('events', { item: { version: '2.0.0', contentId: 'harbor-events-v2' }, data: { manifest: { id: 'harbor-events-v2', name: '港口事件', version: '2.0.0', type: 'rule' }, rules: [] } });
    await executeInstall(await previewInstall('events', workshop.api), {}, workshop.api);
    // 更新原地覆盖上次写入的资产：沿用旧 id，不会多出一个包。
    expect((await allWebEvents()).map(record => record.id)).toEqual(['harbor-events']);
    expect((await listInstalls()).find(record => record.itemId === 'events')?.version).toBe('2.0.0');
  });

  test('a failing install rolls back everything it already wrote', async () => {
    const workshop = fakeWorkshop([
      { item: { id: 'world', type: 'world_package' }, data: world },
      { item: { id: 'broken', type: 'gameplay_module', dependencies: [{ id: 'world' }] }, data: { kind: 'custom-gameplay-module', id: 'broken-module' } },
    ]);
    const preview = await previewInstall('broken', workshop.api);
    await expect(executeInstall(preview, {}, workshop.api)).rejects.toThrow('安装「条目 broken」失败');
    expect(customWorlds()).toEqual([]);
    expect(await getCustomGameplayModule('broken-module')).toBeUndefined();
    expect(await listInstalls()).toEqual([]);
  });

  test('reports conflicts before installing and honours the chosen policy', async () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify([{ id: 'fog-harbor', name: '我改过的雾港', description: '' }]));
    const workshop = fakeWorkshop([{ item: { id: 'world', type: 'world_package' }, data: world }]);
    const preview = await previewInstall('world', workshop.api);
    expect(preview.entries[0].conflict).toEqual({ kind: 'world', id: 'fog-harbor', builtin: false });
    await executeInstall(preview, { conflicts: { world: 'replace' } }, workshop.api);
    expect(customWorlds().map(entry => entry.name)).toEqual(['雾港']);
  });

  test('uninstall removes orphaned dependencies, keeps explicit installs, and refuses while something depends on the item', async () => {
    const workshop = fakeWorkshop([
      { item: { id: 'shared', type: 'event_pack' }, data: { manifest: { id: 'shared-events', name: '共享事件', version: '1.0.0', type: 'rule' }, rules: [] } },
      { item: { id: 'mod', type: 'gameplay_module', dependencies: [{ id: 'shared' }] }, data: moduleDefinition('fog-module') },
      { item: { id: 'world', type: 'world_package', dependencies: [{ id: 'mod' }] }, data: world },
    ]);
    await executeInstall(await previewInstall('world', workshop.api), {}, workshop.api);
    const records = await listInstalls();
    expect(previewUninstall('mod', records).blockedBy.map(record => record.itemId)).toEqual(['world']);
    await expect(uninstall('mod')).rejects.toThrow('还依赖它');
    expect(previewUninstall('world', records).records.map(record => record.itemId).sort()).toEqual(['mod', 'shared', 'world']);

    // 玩家单独主动安装过共享事件包：卸载世界时保留它。
    await executeInstall(await previewInstall('shared', workshop.api), {}, workshop.api);
    await uninstall('world');
    expect((await listInstalls()).map(record => record.itemId)).toEqual(['shared']);
    expect(customWorlds()).toEqual([]);
    expect(await getCustomGameplayModule('fog-module')).toBeUndefined();
    expect(await getWebEvent('shared-events')).toBeDefined();
  });

  test('blocks items that need a newer app version', async () => {
    const workshop = fakeWorkshop([{ item: { id: 'future', type: 'world_package', minAppVersion: '99.0.0' }, data: world }]);
    const preview = await previewInstall('future', workshop.api);
    expect(preview.blockers[0]).toContain('99.0.0');
    await expect(executeInstall(preview, {}, workshop.api)).rejects.toThrow('99.0.0');
  });
});

describe('publishing local assets', () => {
  test('re-publishing the same local asset becomes a new version of the same item', async () => {
    const calls: Array<[string, unknown]> = [];
    let current = '1.0.0';
    let exists = true;
    const api = {
      create: async (input: { version?: string }) => { calls.push(['create', input.version]); current = input.version ?? '1.0.0'; exists = true; return { id: `item-${calls.length}`, version: current, status: 'published' }; },
      update: async (_id: string, input: { version: string }) => {
        calls.push(['update', input.version]);
        if (!exists) throw new WorkshopApiError(404, 'NOT_FOUND', '条目不存在');
        if (compareVersions(input.version, current) <= 0) throw new WorkshopApiError(409, 'VERSION_NOT_INCREASED', '旧版本', { currentVersion: current });
        current = input.version;
        return { ok: true, version: current, newVersion: true };
      },
    } as unknown as WorkshopApi;
    const input = { type: 'world_package' as const, title: '雾港', data: { id: 'fog' } };

    const first = await publishLocalAsset('world_package:fog', input, api);
    expect(first).toMatchObject({ created: true, version: '1.0.0' });
    const second = await publishLocalAsset('world_package:fog', input, api);
    expect(second).toMatchObject({ created: false, itemId: first.itemId, version: '1.0.1' });
    current = '1.4.0'; // 在别的设备上发布过更高版本
    expect((await publishLocalAsset('world_package:fog', input, api)).version).toBe('1.4.1');
    exists = false; // 原条目被删除：改为新建
    const recreated = await publishLocalAsset('world_package:fog', input, api);
    expect(recreated.created).toBe(true);
    expect((await getPublication('world_package:fog'))?.itemId).toBe(recreated.itemId);
  });
});

describe('workshop protocol helpers', () => {
  test('versions compare numerically and publishing always moves forward', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(resolvePublishVersion('2.0.0', '1.3.4')).toBe('2.0.0');
    expect(resolvePublishVersion('1.0.0', '1.3.4')).toBe('1.3.5');
    expect(resolvePublishVersion(undefined, '1.3.4')).toBe('1.3.5');
  });

  test('content ids come from each type’s own identifier', () => {
    expect(workshopContentId('event_pack', { manifest: { id: 'pack' } })).toBe('pack');
    expect(workshopContentId('workflow_pack', { id: 'flow', nodes: [] })).toBe('flow');
    expect(workshopContentId('world_package', { id: 'w' })).toBe('w');
    expect(workshopContentId('world_package', [])).toBeNull();
  });
});

describe('visual themes', () => {
  test('palettes accept hex or rgb triples for --d- tokens only, per theme', () => {
    expect(toRgbTriple('#ff8000')).toBe('255, 128, 0');
    expect(toRgbTriple('#abc')).toBe('170, 187, 204');
    expect(toRgbTriple('300, 0, 0')).toBeNull();
    const palettes = themePalettes({ tokens: { '--d-gold': '#ffcc00', color: 'red', '--d-ink': 'url(x)' }, themes: { dawn: { '--d-gold': '10, 20, 30' } } });
    expect(palettes).toEqual({ night: { '--d-gold': '255, 204, 0' }, dawn: { '--d-gold': '10, 20, 30' } });
    const css = themeCss(palettes);
    expect(css).toContain(":root:not([data-ui-theme='dawn']) {\n  --d-gold: 255, 204, 0;");
    expect(css).toContain(":root:root[data-ui-theme='dawn'] {\n  --d-gold: 10, 20, 30;");
    expect(css).not.toContain('!important');
  });
});
