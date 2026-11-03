import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { createModuleWorkshopStore } from './workshopStore';
import { commitWorkshopRevision, patchWorkshopDraft } from './workshopSession';

const config = { provider: 'custom' as const, baseUrl: 'http://localhost/v1', model: 'test', apiKey: '' };
const draft = {
  kind: 'custom-gameplay-module', schemaVersion: 2, id: 'store-test', name: 'Counter', author: 'test', version: '1.0.0', scope: 'world', inputs: {},
  state: { count: { type: 'number', default: 0 } }, logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] }, permissions: { read: [], write: 'own-state-only' },
};

describe('workshop execution ownership', () => {
  test('switching sessions during import cannot replace the newly selected draft', async () => {
    const store = createModuleWorkshopStore(async () => {});
    await store.getState().openWorld({ id: crypto.randomUUID(), name: 'Import race' });
    await store.getState().importModule(JSON.stringify(draft));
    const firstId = store.getState().activeSessionId!;
    await store.getState().createSession();
    await store.getState().importModule(JSON.stringify({ ...draft, id: 'other-draft', name: 'Other draft' }));
    const otherId = store.getState().activeSessionId!;
    await store.getState().selectSession(firstId);
    const importing = store.getState().importModule(JSON.stringify({ ...draft, id: 'incoming-draft' }));
    const switching = store.getState().selectSession(otherId);
    await Promise.all([importing, switching]);
    const other = store.getState().sessions.find(session => session.id === otherId)!;
    expect(other.revisions).toHaveLength(1);
    expect(other.revisions[0].module.id).toBe('other-draft');
    expect(store.getState().activeSessionId).toBe(otherId);
    const refreshed = createModuleWorkshopStore(async () => {});
    await refreshed.getState().openWorld(store.getState().world!);
    const imported = refreshed.getState().sessions.find(session => session.revisions[0]?.module.id === 'incoming-draft');
    expect(imported?.currentRevision).toBe(1);
  });
  test('stopping and refreshing preserves completed work without replay or late writes', async () => {
    let ready!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const runner: Parameters<typeof createModuleWorkshopStore>[0] = async options => {
      calls += 1;
      await options.updateSession(session => commitWorkshopRevision(session, draft, 0, '已完成'));
      ready(); await gate;
      await options.updateSession(session => patchWorkshopDraft(session, [{ op: 'replace', path: '/name', value: '迟到' }], 1, '停止后的写入'));
    };
    const store = createModuleWorkshopStore(runner);
    const world = { id: crypto.randomUUID(), name: 'Stop and refresh' };
    await store.getState().openWorld(world);
    const running = store.getState().send('创建', config); await started;
    store.getState().stop(); release(); await running;
    const refreshed = createModuleWorkshopStore(runner);
    await refreshed.getState().openWorld(world);
    expect(calls).toBe(1);
    expect(refreshed.getState().sessions[0].revisions).toHaveLength(1);
    expect(refreshed.getState().sessions[0].runs[0].status).toBe('stopped');
    expect(refreshed.getState().sessions[0].revisions[0].module.name).toBe('Counter');
  });
  test('a failed run keeps its draft and a later request can resume normally', async () => {
    let calls = 0;
    const store = createModuleWorkshopStore(async options => {
      calls += 1;
      if (calls === 1) {
        await options.updateSession(session => commitWorkshopRevision(session, draft, 0, '完成的创建'));
        throw Object.assign(new Error('rate limit'), { statusCode: 429 });
      }
      expect(options.getSession().currentRevision).toBe(1);
      await options.updateSession(session => patchWorkshopDraft(session, [{ op: 'replace', path: '/name', value: '恢复后' }], 1, '恢复'));
    });
    await store.getState().openWorld({ id: crypto.randomUUID(), name: 'Retry' });
    await store.getState().send('创建', config);
    expect(store.getState().error).toContain('限流');
    expect(store.getState().sessions[0].currentRevision).toBe(1);
    await store.getState().send('继续修改', config);
    expect(store.getState().error).toBeUndefined();
    expect(store.getState().sessions[0].runs.map(run => run.status)).toEqual(['failed', 'complete']);
    expect(store.getState().sessions[0].currentRevision).toBe(2);
  });
  test('switching worlds stops a late tool write but persists completed revisions', async () => {
    let ready!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const store = createModuleWorkshopStore(async options => {
      await options.updateSession(session => commitWorkshopRevision(session, draft, 0, '已完成的创建'));
      ready();
      await gate;
      await options.updateSession(session => patchWorkshopDraft(session, [{ op: 'replace', path: '/name', value: 'Late' }], 1, '迟到的修改'));
    });
    const a = { id: crypto.randomUUID(), name: 'A' };
    const b = { id: crypto.randomUUID(), name: 'B' };
    await store.getState().openWorld(a);
    const running = store.getState().send('创建', config);
    await started;
    await store.getState().openWorld(b);
    release(); await running;
    expect(store.getState().sessions[0].currentRevision).toBe(0);
    expect(store.getState().error).toBeUndefined();
    await store.getState().openWorld(a);
    expect(store.getState().sessions[0].revisions[0].module.name).toBe('Counter');
    expect(store.getState().sessions[0].revisions).toHaveLength(1);
    expect(store.getState().sessions[0].runs[0].status).toBe('stopped');
  });
  test('message edit and regenerate rebuild following context without reverting module history', async () => {
    const store = createModuleWorkshopStore(async options => {
      await options.updateSession(session => ({ ...session, messages: [...session.messages, {
        id: `${options.runId}:step:0`, role: 'assistant', status: 'complete', parts: [{ type: 'text', text: '回答' }], createdAt: Date.now(),
      }] }));
    });
    await store.getState().openWorld({ id: crypto.randomUUID(), name: 'World' });
    await store.getState().importModule(JSON.stringify(draft));
    await store.getState().send('第一个要求', config);
    const firstUser = store.getState().sessions[0].messages[0];
    await store.getState().send('第二个要求', config);
    await store.getState().editMessage(firstUser.id, '修改后的要求', config);
    const session = store.getState().sessions[0];
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].parts).toEqual([{ type: 'text', text: '修改后的要求' }]);
    expect(session.currentRevision).toBe(1);
    await store.getState().regenerate(session.messages[1].id, config);
    expect(store.getState().sessions[0].messages).toHaveLength(2);
    await store.getState().deleteMessage(store.getState().sessions[0].messages[1].id);
    expect(store.getState().sessions[0].currentRevision).toBe(1);
  });
});
