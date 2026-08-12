import 'fake-indexeddb/auto';
import { test, expect } from 'bun:test';
import { putWebEvent, deleteWebEvent, type WebEventRecord } from './eventDb';
import { webGetRuntimePack } from './webEventStore';
import type { Manifest } from './schema';

const manifest: Manifest = {
  id: 'runtime-web-test',
  name: 'Runtime Web Test',
  version: '1.0.0',
  author: 'tester',
  engine: 'opt-event',
  schemaVersion: 1,
  minAppVersion: '2.7.0',
  type: 'card',
  coverColor: '#3b82f6',
  icon: 'FileText',
  cards: ['schema/event-card-1.json'],
};

test('web runtime pack returns manifest and text schema files', async () => {
  await putWebEvent({
    id: manifest.id,
    manifest,
    enabled: true,
    status: 'enabled',
    installedAt: new Date().toISOString(),
    files: {
      'schema/rules.json': JSON.stringify({ version: 1, rules: [] }),
      'schema/event-card-1.json': JSON.stringify({ nodes: [], connections: [] }),
      'assets/ignored.bin': new Blob(['binary']),
    },
  } satisfies WebEventRecord);

  const runtime = await webGetRuntimePack(manifest.id);

  expect(runtime.id).toBe(manifest.id);
  expect(runtime.manifest.id).toBe(manifest.id);
  expect(runtime.files['schema/rules.json']).toContain('"version":1');
  expect(runtime.files['schema/event-card-1.json']).toContain('"nodes"');
  expect(runtime.files['assets/ignored.bin']).toBeUndefined();

  await deleteWebEvent(manifest.id);
});
