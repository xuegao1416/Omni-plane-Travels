import { describe, expect, test } from 'bun:test';
import { CreationDraftOwner, emptyCreationProfile, type CreationDraftStorage } from './creationDraftOwner';
import { STORAGE_KEYS } from '../config/storageKeys';

function storage(raw: string | null = null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(STORAGE_KEYS.JOURNEY_CREATION_DRAFT, raw);
  let failing = false;
  let writes = 0;
  const port: CreationDraftStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes++; if (failing) throw new DOMException('full', 'QuotaExceededError'); values.set(key, value); },
  };
  return { port, values, fail: (value: boolean) => { failing = value; }, writes: () => writes };
}

describe('single creation draft owner', () => {
  test('rejects invalid nested data and leaves the original record until explicit reset', () => {
    const raw = JSON.stringify({ version: 1, draft: { selectedWorld: 'w', profile: { ...emptyCreationProfile(), initialItems: { broken: { 数量: 'two' } } }, segments: {}, step: 1, includeAgeStages: true, started: true } });
    const db = storage(raw), owner = new CreationDraftOwner(db.port);
    expect(owner.getSnapshot().warning).toContain('原始');
    owner.edit({ profile: { ...emptyCreationProfile(), name: 'new' } });
    owner.retrySave();
    expect(db.values.get(STORAGE_KEYS.JOURNEY_CREATION_DRAFT)).toBe(raw);
    expect(owner.getSnapshot().profile.name).toBe('new');
    owner.reset('other');
    expect(db.values.get(STORAGE_KEYS.JOURNEY_CREATION_DRAFT)).not.toBe(raw);
  });

  test('quota failure retains all memory fields and a retry persists the same draft', () => {
    const db = storage(), owner = new CreationDraftOwner(db.port);
    owner.reset('world'); db.fail(true);
    owner.edit({ profile: { ...emptyCreationProfile(), name: 'traveller' }, segments: { prologue: 'handwritten' }, step: 3, includeAgeStages: false });
    expect(owner.getSnapshot().warning).toContain('本次会话');
    expect(owner.getSnapshot().segments.prologue).toBe('handwritten');
    db.fail(false); owner.retrySave();
    const restored = new CreationDraftOwner(db.port);
    expect(restored.getSnapshot().profile.name).toBe('traveller');
    expect(restored.getSnapshot().step).toBe(3);
    expect(restored.getSnapshot().includeAgeStages).toBe(false);
    expect(owner.getSnapshot().warning).toBe('');
  });

  test('reset clears the complete draft in one write and invalidates every operation', () => {
    const db = storage(), owner = new CreationDraftOwner(db.port);
    owner.edit({ selectedWorld: 'old', profile: { ...emptyCreationProfile(), name: 'old' }, segments: { prologue: 'old story' }, includeAgeStages: false, step: 4 });
    const operation = owner.beginOperation('history'), before = db.writes();
    owner.reset('hall-world');
    expect(db.writes() - before).toBe(1);
    expect(owner.getSnapshot()).toMatchObject({ selectedWorld: 'hall-world', profile: emptyCreationProfile(), segments: {}, includeAgeStages: true, step: 1, started: true });
    expect(operation.signal.aborted).toBe(true);
    expect(operation.commit({ segments: { prologue: 'late' } })).toBe(false);
  });

  test('hand edits and world changes prevent late stream and final writes', async () => {
    const owner = new CreationDraftOwner(storage().port);
    owner.reset('w');
    const old = owner.beginOperation('history');
    expect(old.commit({ segments: { prologue: 'stream fragment' } })).toBe(true);
    owner.edit({ segments: { prologue: 'manual correction' } });
    await Promise.resolve();
    expect(old.commit({ segments: { prologue: 'late final' } })).toBe(false);
    const current = owner.beginOperation('history');
    expect(old.finish()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    owner.edit({ selectedWorld: 'other' });
    expect(current.commit({ segments: { prologue: 'wrong world' } })).toBe(false);
    expect(owner.getSnapshot().segments.prologue).toBe('manual correction');
  });

  test('projections and operation inputs cannot mutate stored state through retained references', () => {
    const owner = new CreationDraftOwner(storage().port);
    const profile = { ...emptyCreationProfile(), name: 'before', moduleInitData: { nested: { value: 1 } } };
    owner.edit({ profile });
    const projection = owner.getSnapshot(), operation = owner.beginOperation('fill');
    profile.name = 'external mutation';
    expect(() => { projection.profile.name = 'projection mutation'; }).toThrow();
    expect(() => { (operation.inputs.profile.moduleInitData!.nested as { value: number }).value = 5; }).toThrow();
    owner.edit({ profile: { ...emptyCreationProfile(), name: 'after' } });
    expect(operation.inputs.profile.name).toBe('before');
    expect(owner.getSnapshot().profile.name).toBe('after');
  });

  test('completion clears the creation data without populating it from an active traveller', () => {
    const owner = new CreationDraftOwner(storage().port);
    owner.reset('w'); owner.edit({ profile: { ...emptyCreationProfile(), name: 'created' } });
    owner.complete();
    expect(owner.hasDraft()).toBe(false);
    expect(owner.getSnapshot().profile.name).toBe('');
    expect(owner.getSnapshot().segments).toEqual({});
  });

  test('an invalid generated profile cannot replace the last usable draft', () => {
    const db = storage(), owner = new CreationDraftOwner(db.port);
    owner.reset('w'); owner.edit({ profile: { ...emptyCreationProfile(), name: 'manual' } });
    const operation = owner.beginOperation('fill'), before = db.values.get(STORAGE_KEYS.JOURNEY_CREATION_DRAFT);
    const invalid = { ...emptyCreationProfile(), name: 'generated', initialItems: { bad: { 数量: 'two', 品质: '普通', 类型: '', 备注: '' } } };
    expect(() => operation.commit({ profile: invalid as unknown as ReturnType<typeof emptyCreationProfile> })).toThrow();
    expect(owner.getSnapshot().profile.name).toBe('manual');
    expect(db.values.get(STORAGE_KEYS.JOURNEY_CREATION_DRAFT)).toBe(before);
  });
});
