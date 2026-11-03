import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { createWorkshopSession } from './workshopSession';
import { insertWorkshopSession, persistWorkshopSession, loadWorkshopSessions, removeWorkshopSession } from './workshopPersistence';
import { putGlobal } from '../storage/db';

describe('workshop transaction persistence', () => {
  test('rejects a stale writer and keeps worlds isolated', async () => {
    const world = { id: crypto.randomUUID(), name: 'World' };
    const a = await insertWorkshopSession(createWorkshopSession(world));
    const b = await insertWorkshopSession(createWorkshopSession({ ...world, id: crypto.randomUUID() }));
    const saved = await persistWorkshopSession({ ...a, title: '最新' }, a.version);
    await expect(persistWorkshopSession({ ...a, title: '过时' }, a.version)).rejects.toThrow('会话已');
    expect((await loadWorkshopSessions(world))[0].title).toBe('最新');
    expect((await loadWorkshopSessions(b.world))).toHaveLength(1);
    await removeWorkshopSession(saved.id, world.id, saved.version);
    expect(await loadWorkshopSessions(world)).toHaveLength(0);
  });
  test('migrates once and preserves completed tools after interrupted execution', async () => {
    const world = { id: crypto.randomUUID(), name: 'Legacy' };
    await putGlobal('customModuleAgentSessions.v3', { [world.id]: { sessionVersion: 2, world, conversation: [{ role: 'user', content: '旧对话' }] } });
    const migrated = await loadWorkshopSessions(world);
    expect(migrated).toHaveLength(1);
    const running = { ...migrated[0], messages: [...migrated[0].messages, {
      id: 'tool-message', role: 'assistant' as const, status: 'running' as const, createdAt: 1,
      parts: [{ type: 'tool' as const, toolCallId: 'one', name: 'createDraft', input: {}, output: { revision: 1 }, status: 'complete' as const }],
    }] };
    await persistWorkshopSession(running, running.version);
    const restored = await loadWorkshopSessions(world);
    expect(restored).toHaveLength(1);
    expect(restored[0].messages.at(-1)?.status).toBe('stopped');
    expect(restored[0].messages.at(-1)?.parts[0]).toMatchObject({ status: 'complete', output: { revision: 1 } });
  });
});
