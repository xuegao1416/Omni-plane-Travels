import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('getRuntimePack routes Tauri reads through get_event_runtime', () => {
  const source = readFileSync(new URL('./eventApi.ts', import.meta.url), 'utf8');
  expect(source).toContain('export async function getRuntimePack(id: string)');
  expect(source).toContain("return call<EventRuntimePack>('get_event_runtime', { id });");
});
