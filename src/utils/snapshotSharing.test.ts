import { expect, test } from 'bun:test';
import { cloneSnapshotWithSharing, shareSnapshotHistory } from './snapshotSharing';

test('snapshot sharing detaches changed state and reuses only immutable historical branches', () => {
  const live = { npc: { name: '甲', facts: ['商人'] }, events: [{ id: 'first', text: '开局' }], amount: 1 };
  const first = cloneSnapshotWithSharing(live);
  live.amount = 2;
  live.events.push({ id: 'second', text: '出发' });
  const second = cloneSnapshotWithSharing(live, first);
  expect(second).toEqual(live);
  expect(second.npc).toBe(first.npc);
  expect(second.events[0]).toBe(first.events[0]);
  expect(second.events).not.toBe(live.events);
  live.npc.facts.push('秘密'); live.events[0]!.text = '编辑';
  expect(first.npc.facts).toEqual(['商人']);
  expect(second.events[0]?.text).toBe('开局');
  expect(first.amount).toBe(1);
  expect(second.amount).toBe(2);
});

test('sharing preserves removed fields, array truncations and explicit undefined', () => {
  const old = cloneSnapshotWithSharing<{ deleted?: number; items: number[]; explicit: undefined }>({ deleted: 1, items: [1, 2], explicit: undefined });
  const next = cloneSnapshotWithSharing({ items: [1], explicit: undefined }, old);
  expect(next).toEqual({ items: [1], explicit: undefined });
  expect(Object.hasOwn(next, 'deleted')).toBe(false);
  expect(Object.hasOwn(next, 'explicit')).toBe(true);
});

test('decoded full histories share unchanged payloads and clones preserve the sharing', () => {
  const histories = Array.from({ length: 100 }, (_, turn) => ({ turn, facts: { text: '正文'.repeat(1000), embedding: [1, 2, 3] } }));
  const shared = shareSnapshotHistory(histories);
  expect(shared).toEqual(histories);
  expect(shared.every(value => value.facts === shared[0]!.facts)).toBe(true);
  const captured = structuredClone(shared);
  expect(captured[99]!.facts).toBe(captured[0]!.facts);
  expect(captured[0]!.facts).not.toBe(shared[0]!.facts);
});

test('shared references and data keys survive detachment without accepting cycles', () => {
  const leaf = { fact: 'test' };
  const live = JSON.parse('{"__proto__":{"safe":true}}');
  live.a = leaf; live.b = leaf;
  const snapshot = cloneSnapshotWithSharing(live);
  expect(snapshot.a).toBe(snapshot.b);
  expect(snapshot.a).not.toBe(leaf);
  expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
  expect(snapshot.__proto__).toEqual({ safe: true });
  live.cycle = live;
  expect(() => cloneSnapshotWithSharing(live)).toThrow('circular');
});
