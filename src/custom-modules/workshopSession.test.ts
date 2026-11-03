import { describe, expect, test } from 'bun:test';
import { createWorkshopSession, commitWorkshopRevision, patchWorkshopDraft, deleteWorkshopMessage, truncateWorkshopConversation, restoreWorkshopRevision, migrateWorkshopSession } from './workshopSession';

const world = { id: 'test-world', name: '测试世界' };
const draft = {
  kind: 'custom-gameplay-module', schemaVersion: 2, id: 'test-module', name: '测试模块',
  version: '1.0.0', author: 'test', scope: 'world', inputs: {},
  state: { count: { type: 'number', default: 0 } },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] },
  permissions: { read: [], write: 'own-state-only' },
};

describe('workshop independent conversation and revisions', () => {
  test('rejects stale or invalid patches without erasing the valid revision', () => {
    const first = commitWorkshopRevision(createWorkshopSession(world), draft, 0, '创建');
    expect(() => patchWorkshopDraft(first, [{ op: 'replace', path: '/name', value: '新名称' }], 0, '改名')).toThrow('版本');
    expect(() => patchWorkshopDraft(first, [{ op: 'replace', path: '/state/count/type', value: 'invalid' }], 1, '错误')).toThrow();
    expect(first.revisions[0].module.name).toBe('测试模块');
    const next = patchWorkshopDraft(first, [{ op: 'replace', path: '/name', value: '新名称' }], 1, '改名');
    expect(next.revisions).toHaveLength(2);
    expect(next.revisions[1].module.name).toBe('新名称');
    expect(restoreWorkshopRevision(next, first.revisions[0].id).revisions[2].module.name).toBe('测试模块');
  });
  test('deleting a tool message removes the whole pair but retains drafts', () => {
    const first = commitWorkshopRevision(createWorkshopSession(world), draft, 0, '创建');
    first.messages = [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: '创建' }], status: 'complete', createdAt: 1 },
      { id: 'a', role: 'assistant', parts: [{ type: 'tool', toolCallId: 'call', name: 'create_draft', input: {}, output: {}, status: 'complete' }], status: 'complete', createdAt: 2 },
    ];
    const deleted = deleteWorkshopMessage(first, 'a');
    expect(deleted.messages.map(m => m.id)).toEqual(['u']);
    expect(deleted.currentRevision).toBe(1);
    expect(truncateWorkshopConversation(first, 'u').messages).toHaveLength(0);
    expect(truncateWorkshopConversation(first, 'u').revisions).toHaveLength(1);
  });
  test('blocks prototype paths and imports V2 transcript once with a valid draft', () => {
    const session = commitWorkshopRevision(createWorkshopSession(world), draft, 0, '创建');
    expect(() => patchWorkshopDraft(session, [{ op: 'add', path: '/__proto__/bad', value: true }], 1, '错误')).toThrow();
    const legacy = { sessionVersion: 2, world, conversation: [{ role: 'user', content: '目标' }], lastValidDraft: draft };
    const migrated = migrateWorkshopSession(legacy, world);
    expect(migrated?.messages[0].parts).toEqual([{ type: 'text', text: '目标' }]);
    expect(migrated?.currentRevision).toBe(1);
  });
});
