import { mock, test, expect } from 'bun:test';

const calls: Array<[string, unknown]> = [];

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args?: unknown) => {
    calls.push([command, args]);
    if (command === 'get_event_runtime') {
      return {
        id: 'runtime-tauri-test',
        manifest: { id: 'runtime-tauri-test', type: 'rule' },
        files: { 'schema/rules.json': JSON.stringify({ version: 1, rules: [] }) },
      };
    }
    throw new Error(`unexpected command: ${command}`);
  },
}));
mock.module('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}));

const g = globalThis as unknown as { window?: Record<string, unknown> };
g.window = g.window ?? {};
g.window.__TAURI_INTERNALS__ = {};

test('getRuntimePack routes Tauri reads through get_event_runtime', async () => {
  const eventApi = await import('./eventApi');
  const runtime = await eventApi.getRuntimePack('runtime-tauri-test');

  expect(runtime.id).toBe('runtime-tauri-test');
  expect(runtime.files['schema/rules.json']).toContain('"rules"');
  expect(calls).toEqual([['get_event_runtime', { id: 'runtime-tauri-test' }]]);
});
