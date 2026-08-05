// Web 端 Event 存储层测试（用 fake-indexeddb 模拟浏览器 IndexedDB）
import 'fake-indexeddb/auto';
import { afterEach, test, expect } from 'bun:test';
import JSZip from 'jszip';
import {
  webImportFromFile,
  webListPacks,
  webEnablePack,
  webDisablePack,
  webUninstallPack,
  webValidatePack,
  createEmptyPack,
  createPackWithEvent,
  saveEventToPack,
  deleteEventFromPack,
  renameEventInPack,
  listEventsInPack,
  savePackMeta,
  savePeriodicRulesToPack,
  webExportPack,
  installWorldEventPacks,
} from './webEventStore';
import { ensureEventApiError, EventApiError } from './eventErrors';
import { allWebEvents, deleteWebEvent, getWebEvent, putWebEvent } from './eventDb';
import type { CardWorkflowDefinition, EventIndexEntry, Manifest, PeriodicRule } from './schema';
import type { WorldDef } from '../data/worlds-schema';

afterEach(async () => {
  const records = await allWebEvents();
  for (const record of records) await deleteWebEvent(record.id);
});

const manifest: Manifest = {
  id: 'test-mod',
  name: '测试事件',
  version: '1.0.0',
  author: 'tester',
  engine: 'opt-event',
  schemaVersion: 1,
  minAppVersion: '2.7.0',
  type: 'card',
  coverColor: '#3b82f6',
  icon: 'FileText',
  cards: ['schema/card.json'],
};

const legacyPuckCard = {
  version: 1,
  puck: {
    root: { props: {} },
    components: {
      title: [{ id: 'legacy-title', props: { title: 'An old title' } }],
      narrative: [{ id: 'legacy-narrative', props: { text: 'An old narrative' } }],
      choice: [{ id: 'legacy-choice', props: { choices: ['Advance', { label: 'Wait' }] } }],
    },
  },
  cards: [
    { id: 'legacy-title', componentId: 'title', title: 'An old title' },
    { id: 'legacy-narrative', componentId: 'narrative', title: 'An old narrative' },
    { id: 'legacy-choice', componentId: 'choice', title: 'An old choice' },
  ],
};

async function buildZip(
  packManifest: Manifest = manifest,
  cardFile: unknown = legacyPuckCard,
  additionalFiles: Record<string, string | Blob | Uint8Array> = {},
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(packManifest));
  zip.file('schema/card.json', JSON.stringify(cardFile));
  zip.file('assets/keep.bin', new Uint8Array([0, 1, 255, 42]));
  for (const [path, content] of Object.entries(additionalFiles)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob.arrayBuffer();
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject');
}

function workflowFor(entry: EventIndexEntry): CardWorkflowDefinition {
  return {
    version: 1,
    id: entry.id,
    name: entry.name,
    nodes: [],
    connections: [],
  };
}

async function seedCanonicalPack(
  packId: string,
  entries: EventIndexEntry[],
  extraFiles: Record<string, string> = {},
): Promise<void> {
  const pack = await createEmptyPack(`Pack ${packId}`);
  const record = await getWebEvent(pack);
  expect(record).toBeDefined();
  record!.id = packId;
  record!.manifest = { ...record!.manifest, id: packId };
  record!.files['manifest.json'] = JSON.stringify(record!.manifest, null, 2);
  record!.files['schema/events.json'] = JSON.stringify({ version: 2, events: entries }, null, 2);
  for (const entry of entries) {
    record!.files[`schema/event-${entry.id}.json`] = JSON.stringify(workflowFor(entry), null, 2);
  }
  Object.assign(record!.files, extraFiles);
  await deleteWebEvent(pack);
  await putWebEvent(record!);
}

async function readStoredIndex(packId: string): Promise<{ version: number; name?: string; events: EventIndexEntry[] }> {
  const record = await getWebEvent(packId);
  expect(record).toBeDefined();
  return JSON.parse(record!.files['schema/events.json'] as string) as {
    version: number;
    name?: string;
    events: EventIndexEntry[];
  };
}

test('EventApiError 包装保留已知错误并将未知错误降级为 IO_ERROR', () => {
  const known = new EventApiError({
    code: 'INPUT_CONFLICT',
    message: 'conflict',
    context: { filePath: 'schema/card.json' },
    filePath: 'schema/card.json',
  });
  expect(ensureEventApiError(known)).toBe(known);

  const unknown = ensureEventApiError(new Error('read failed'));
  expect(unknown).toBeInstanceOf(EventApiError);
  expect(unknown).toMatchObject({
    name: 'EventApiError',
    code: 'IO_ERROR',
    message: 'read failed',
  });
});

test('web 导入 → 列表 → 启用/禁用 → 卸载', async () => {
  try {
    const f = await buildZip();
    const meta = await webImportFromFile(f);
    expect(meta.id).toBe('test-mod');

    const record = await getWebEvent('test-mod');
    expect(record).toBeDefined();
    expect(record?.files['schema/card.json']).toBeUndefined();
    const index = JSON.parse(record?.files['schema/events.json'] as string) as {
      version: number;
      events: Array<{ id: string; name: string }>;
    };
    expect(index.version).toBe(2);
    expect(index.events).toHaveLength(1);
    expect(index.events[0]).toEqual({ id: expect.any(String), name: manifest.name });

    const eventId = index.events[0]!.id;
    const workflow = JSON.parse(record?.files[`schema/event-${eventId}.json`] as string) as {
      nodes: Array<{ id: string; typeId: string }>;
      connections: unknown[];
    };
    expect(workflow.nodes).toHaveLength(3);
    expect(workflow.nodes.map((node) => [node.id, node.typeId])).toEqual([
      ['legacy-title', 'narrative.title'],
      ['legacy-narrative', 'narrative.text'],
      ['legacy-choice', 'choice.static'],
    ]);
    expect(workflow.connections).toHaveLength(2);

    const asset = record?.files['assets/keep.bin'];
    expect(asset).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await (asset as Blob).arrayBuffer())]).toEqual([0, 1, 255, 42]);

    const list0 = await webListPacks();
    expect(list0.length).toBe(1);
    expect(list0[0].enabled).toBe(false);
    expect(list0[0].status).toBe('installed');

    await webEnablePack('test-mod');
    const list1 = await webListPacks();
    expect(list1[0].enabled).toBe(true);
    expect(list1[0].status).toBe('enabled');

    await webDisablePack('test-mod');
    const list2 = await webListPacks();
    expect(list2[0].enabled).toBe(false);
    expect(list2[0].status).toBe('disabled');

    const list3 = await webUninstallPack('test-mod').then(() => webListPacks());
    expect(list3.length).toBe(0);
  } finally {
    await webUninstallPack('test-mod');
  }
});

test('web 本地结构校验', async () => {
  const ok = await webValidatePack(manifest);
  expect(ok.ok).toBe(true);

  const bad = await webValidatePack({ ...manifest, id: 'Bad Id' });
  expect(bad.ok).toBe(false);
  expect(bad.errors.some((e) => e.field === 'id')).toBe(true);
});

test('web 导入非法 manifest 应抛错', async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ ...manifest, id: 'Bad Id' }));
  const blob = await zip.generateAsync({ type: 'blob' });
  const buf = await blob.arrayBuffer();
  await expect(webImportFromFile(buf)).rejects.toThrow();
});

test('web 导入非法 ZIP 应抛 EventApiError + ZIP_INVALID', async () => {
  const error = await captureError(() => webImportFromFile(new Uint8Array([0x6e, 0x6f, 0x74, 0x2d, 0x7a, 0x69, 0x70])));
  expect(error).toBeInstanceOf(EventApiError);
  expect(error).toMatchObject({
    name: 'EventApiError',
    code: 'ZIP_INVALID',
  });
});

test('web 导入 malformed manifest.json 应抛 EventApiError + 稳定错误码', async () => {
  const zip = new JSZip();
  zip.file('manifest.json', '{"id":');
  const blob = await zip.generateAsync({ type: 'blob' });
  const buf = await blob.arrayBuffer();
  const error = await captureError(() => webImportFromFile(buf));
  expect(error).toBeInstanceOf(EventApiError);
  expect(error).toMatchObject({
    name: 'EventApiError',
    code: 'MANIFEST_INVALID',
    filePath: 'manifest.json',
    context: { filePath: 'manifest.json' },
  });
});

test('web migration failure does not create a new IndexedDB record and keeps format context', async () => {
  const failedManifest = { ...manifest, id: 'failed-mod' };
  const unsupportedCard = {
    version: 1,
    puck: {
      root: { props: {} },
      components: {
        video: [{ id: 'legacy-video', props: { src: 'video.mp4' } }],
      },
    },
    cards: [{ id: 'legacy-video', componentId: 'video', title: 'Video' }],
  };
  const buf = await buildZip(failedManifest, unsupportedCard);

  const error = await captureError(() => webImportFromFile(buf));
  expect(error).toBeInstanceOf(EventApiError);
  expect(error).toMatchObject({
    name: 'EventApiError',
    code: 'LEGACY_COMPONENT_UNSUPPORTED',
    filePath: 'schema/card.json',
    context: {
      filePath: 'schema/card.json',
      eventId: expect.any(String),
      componentId: 'legacy-video',
      componentType: 'video',
    },
  });
  expect(await getWebEvent(failedManifest.id)).toBeUndefined();
});

test('web migration failure does not overwrite an existing record with the same ID', async () => {
  const existingManifest = { ...manifest, id: 'existing-mod', name: 'Original event' };
  try {
    await webImportFromFile(await buildZip(existingManifest));
    const before = await getWebEvent(existingManifest.id);
    expect(before).toBeDefined();

    const conflictingBuf = await buildZip(existingManifest, legacyPuckCard, {
      'schema/events.json': JSON.stringify({ version: 2, events: [] }),
    });
    const error = await captureError(() => webImportFromFile(conflictingBuf));
    expect(error).toBeInstanceOf(EventApiError);
    expect(error).toMatchObject({
      name: 'EventApiError',
      code: 'INPUT_CONFLICT',
      filePath: 'schema/card.json',
      context: { filePath: 'schema/card.json' },
    });

    const after = await getWebEvent(existingManifest.id);
    expect(after?.manifest).toEqual(before?.manifest);
    expect(after?.enabled).toBe(before?.enabled);
    expect(after?.status).toBe(before?.status);
    expect(after?.files['schema/events.json']).toBe(before?.files['schema/events.json']);
    expect(after?.files['schema/card.json']).toBeUndefined();
  } finally {
    await webUninstallPack(existingManifest.id);
  }
});

test('createEmptyPack writes a canonical v2 index without legacy card files', async () => {
  const packId = await createEmptyPack('空白 v2 包');
  const record = await getWebEvent(packId);

  expect(record?.files['schema/card.json']).toBeUndefined();
  expect(JSON.parse(record!.files['schema/events.json'] as string)).toEqual({
    version: 2,
    name: '空白 v2 包',
    events: [],
  });
});

test('createPackWithEvent writes one canonical index entry and matching workflow', async () => {
  const entry: EventIndexEntry = { id: 'evt-one', name: '事件一' };
  const workflow = workflowFor(entry);

  await createPackWithEvent(entry, workflow, {
    id: 'pack-with-event',
    name: '单事件包',
    type: 'card',
  });

  const record = await getWebEvent('pack-with-event');
  expect(record?.files['schema/card.json']).toBeUndefined();
  expect(JSON.parse(record!.files['schema/events.json'] as string)).toMatchObject({
    version: 2,
    events: [entry],
  });
  expect(JSON.parse(record!.files['schema/event-evt-one.json'] as string)).toEqual(workflow);
});

test('saveEventToPack writes canonical metadata, workflow, and periodic rules separately', async () => {
  const packId = await createEmptyPack('保存测试包');
  const entry: EventIndexEntry = { id: 'evt-one', name: '事件一' };
  const periodicRules: PeriodicRule[] = [{ id: 'periodic-one', intervalTicks: 5, actions: [] }];

  await saveEventToPack(packId, entry, workflowFor(entry), periodicRules);

  const record = await getWebEvent(packId);
  const index = JSON.parse(record!.files['schema/events.json'] as string) as Record<string, unknown> & {
    events: EventIndexEntry[];
  };
  expect(index.version).toBe(2);
  expect(index.events).toEqual([entry]);
  expect(index).not.toHaveProperty('periodicRules');
  expect(record!.files['schema/card.json']).toBeUndefined();
  expect(JSON.parse(record!.files['schema/event-evt-one.json'] as string)).toEqual(workflowFor(entry));
  expect(JSON.parse(record!.files['schema/rules.json'] as string)).toMatchObject({
    version: 1,
    rules: [],
    periodicRules,
  });
});

test('saveEventToPack rejects a workflow whose id or name disagrees with index metadata', async () => {
  const packId = await createEmptyPack('不一致测试包');
  const entry: EventIndexEntry = { id: 'evt-one', name: '事件一' };
  const mismatched = { ...workflowFor(entry), id: 'evt-two' };

  const error = await captureError(() => saveEventToPack(packId, entry, mismatched));

  expect(error).toBeInstanceOf(EventApiError);
  expect(error).toMatchObject({
    name: 'EventApiError',
    code: 'INDEX_FILE_MISMATCH',
  });
});

test('renameEventInPack synchronizes index/workflow names and removes stale workflow files', async () => {
  const entry: EventIndexEntry = { id: 'evt-one', name: '旧名称' };
  const stale = workflowFor({ id: 'evt-stale', name: '残留' });
  await seedCanonicalPack('rename-pack', [entry], {
    'schema/event-evt-stale.json': JSON.stringify(stale),
  });

  await renameEventInPack('rename-pack', 'evt-one', '新名称');

  const record = await getWebEvent('rename-pack');
  const index = JSON.parse(record!.files['schema/events.json'] as string) as {
    version: number;
    events: EventIndexEntry[];
  };
  const workflow = JSON.parse(record!.files['schema/event-evt-one.json'] as string) as CardWorkflowDefinition;
  expect(index.version).toBe(2);
  expect(index.events).toEqual([{ id: 'evt-one', name: '新名称' }]);
  expect(workflow).toMatchObject({ id: 'evt-one', name: '新名称' });
  expect(record!.files['schema/event-evt-stale.json']).toBeUndefined();
  expect(record!.files['schema/card.json']).toBeUndefined();
});

test('deleteEventFromPack removes only the selected canonical event and all stale workflow files', async () => {
  const kept: EventIndexEntry = { id: 'evt-kept', name: '保留事件' };
  const removed: EventIndexEntry = { id: 'evt-removed', name: '删除事件' };
  const stale = workflowFor({ id: 'evt-stale', name: '残留' });
  await seedCanonicalPack('delete-pack', [kept, removed], {
    'schema/event-evt-stale.json': JSON.stringify(stale),
  });

  await deleteEventFromPack('delete-pack', removed.id);

  const record = await getWebEvent('delete-pack');
  const index = JSON.parse(record!.files['schema/events.json'] as string) as {
    version: number;
    events: EventIndexEntry[];
  };
  expect(index.version).toBe(2);
  expect(index.events).toEqual([kept]);
  expect(record!.files['schema/event-evt-removed.json']).toBeUndefined();
  expect(record!.files['schema/event-evt-stale.json']).toBeUndefined();
  expect(record!.files['schema/event-evt-kept.json']).toBeDefined();
  expect(record!.files['schema/card.json']).toBeUndefined();
});

test('listEventsInPack returns canonical metadata without fabricated cards', async () => {
  const entry: EventIndexEntry = { id: 'evt-one', name: '事件一', description: '说明' };
  await seedCanonicalPack('list-pack', [entry]);

  const events = await listEventsInPack('list-pack');

  expect(events).toEqual([entry]);
  expect('cards' in (events[0] as object)).toBe(false);
});

test('savePeriodicRulesToPack keeps periodic rules out of events.json', async () => {
  const packId = await createEmptyPack('周期规则包');
  const periodicRules: PeriodicRule[] = [{ id: 'periodic-one', intervalTicks: 3, actions: [] }];

  await savePeriodicRulesToPack(packId, periodicRules);

  const record = await getWebEvent(packId);
  const index = JSON.parse(record!.files['schema/events.json'] as string) as Record<string, unknown>;
  expect(index.version).toBe(2);
  expect(index).not.toHaveProperty('periodicRules');
  expect(JSON.parse(record!.files['schema/rules.json'] as string)).toMatchObject({ periodicRules });
});

test('webExportPack exports the same canonical files without schema/card.json', async () => {
  const entry: EventIndexEntry = { id: 'evt-one', name: '事件一' };
  const workflow = workflowFor(entry);
  await createPackWithEvent(entry, workflow, {
    id: 'export-pack',
    name: '导出包',
    type: 'card',
  });
  const record = await getWebEvent('export-pack');
  let exportedBlob: Blob | undefined;
  const originalDocument = (globalThis as { document?: unknown }).document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const anchor = {
    href: '',
    download: '',
    click: () => undefined,
    remove: () => undefined,
  };

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => anchor,
      body: { appendChild: () => undefined },
    },
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      exportedBlob = blob;
      return 'blob:test';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: () => undefined,
  });

  try {
    await webExportPack('export-pack');
    expect(exportedBlob).toBeInstanceOf(Blob);
    const zip = await JSZip.loadAsync(await exportedBlob!.arrayBuffer());
    expect(zip.file('schema/card.json')).toBeNull();
    expect(zip.file('schema/events.json')).not.toBeNull();
    expect(zip.file('schema/event-evt-one.json')).not.toBeNull();
    expect(JSON.parse(await zip.file('schema/events.json')!.async('string'))).toEqual(
      JSON.parse(record!.files['schema/events.json'] as string),
    );
    expect(JSON.parse(await zip.file('schema/event-evt-one.json')!.async('string'))).toEqual(
      JSON.parse(record!.files['schema/event-evt-one.json'] as string),
    );
  } finally {
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  }
});

function worldWithEventPack(eventPacks: NonNullable<WorldDef['eventPacks']>): WorldDef {
  return {
    id: 'world-event-pack-test',
    name: '世界事件包测试',
    description: '测试世界',
    entryId: null,
    eventPacks,
  };
}

test('installWorldEventPacks writes canonical card metadata and required workflows', async () => {
  const events = [
    { id: 'world-event-one', name: '世界事件一', workflow: workflowFor({ id: 'world-event-one', name: '世界事件一' }) },
    { id: 'world-event-two', name: '世界事件二', workflow: workflowFor({ id: 'world-event-two', name: '世界事件二' }) },
  ];
  await installWorldEventPacks(worldWithEventPack([{
    id: 'world-card-pack',
    type: 'card',
    name: '世界卡片包',
    events,
  }]));

  const record = await getWebEvent('world-card-pack');
  expect(record).toBeDefined();
  const index = JSON.parse(record!.files['schema/events.json'] as string) as {
    version: number;
    events: Array<Record<string, unknown> & { id: string; name: string }>;
  };
  expect(index.version).toBe(2);
  expect(index.events).toEqual([
    { id: 'world-event-one', name: '世界事件一' },
    { id: 'world-event-two', name: '世界事件二' },
  ]);
  expect(index.events.every((entry) => !('cards' in entry))).toBe(true);
  expect(index.events.every((entry) => !('periodicRules' in entry))).toBe(true);
  expect(record!.files['schema/card.json']).toBeUndefined();

  for (const entry of index.events) {
    const storedWorkflow = JSON.parse(
      record!.files[`schema/event-${entry.id}.json`] as string,
    ) as CardWorkflowDefinition;
    expect(storedWorkflow).toMatchObject({ id: entry.id, name: entry.name });
  }
});

test('installWorldEventPacks rejects a card event without a workflow', async () => {
  await expect(installWorldEventPacks(worldWithEventPack([{
    id: 'world-card-missing-workflow',
    type: 'card',
    name: '缺工作流包',
    events: [{ id: 'missing-workflow', name: '缺失工作流' }],
  }]))).rejects.toThrow(/workflow/i);

  expect(await getWebEvent('world-card-missing-workflow')).toBeUndefined();
});

test('installWorldEventPacks does not overwrite an existing pack when card workflow validation fails', async () => {
  const entry: EventIndexEntry = { id: 'existing-event', name: '已有事件' };
  await createPackWithEvent(entry, workflowFor(entry), {
    id: 'world-card-existing',
    name: '已有卡片包',
    type: 'card',
  });
  const before = await getWebEvent('world-card-existing');
  expect(before).toBeDefined();

  await expect(installWorldEventPacks(worldWithEventPack([{
    id: 'world-card-existing',
    type: 'card',
    name: '新的坏包',
    events: [{ id: 'missing-workflow', name: '缺失工作流' }],
  }]))).rejects.toThrow(/workflow/i);

  const after = await getWebEvent('world-card-existing');
  expect(after).toEqual(before);
});

test('savePackMeta keeps the exported manifest synchronized', async () => {
  const packId = await createEmptyPack('Original pack name');

  await savePackMeta(packId, { name: 'Renamed pack name' });

  const record = await getWebEvent(packId);
  expect(record).toBeDefined();
  expect(JSON.parse(record!.files['manifest.json'] as string)).toMatchObject({
    id: packId,
    name: 'Renamed pack name',
  });
});

test('installWorldEventPacks writes a canonical empty index for rule packs', async () => {
  await installWorldEventPacks(worldWithEventPack([{
    id: 'world-rule-pack',
    type: 'rule',
    name: '世界规则包',
    rules: [],
    periodicRules: [],
  }]));

  const record = await getWebEvent('world-rule-pack');
  expect(record).toBeDefined();
  expect(JSON.parse(record!.files['schema/events.json'] as string)).toEqual({
    version: 2,
    name: '世界规则包',
    events: [],
  });
});
