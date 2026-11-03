import 'fake-indexeddb/auto';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { ImageUrlPool } from './imageUrls';
import { imageDb, imageUrls } from './imageDb';

function setup() {
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  let reads = 0, creates = 0;
  const pool = new ImageUrlPool(async key => {
    reads++;
    const blob = blobs.get(key);
    return blob ? { blob } : null;
  }, { create: () => `blob:test-${++creates}`, revoke: url => revoked.push(url) });
  return { pool, blobs, revoked, counts: () => ({ reads, creates }) };
}

test('simultaneous displays share one read and URL, with idempotent last-user release', async () => {
  const s = setup(); s.blobs.set('a', new Blob(['a']));
  const [first, second] = await Promise.all([s.pool.acquire('a'), s.pool.acquire('a')]);
  expect(s.counts()).toEqual({ reads: 1, creates: 1 });
  first!.release(); first!.release(); expect(s.revoked).toEqual([]);
  second!.release(); expect(s.revoked).toEqual(['blob:test-1']);
});

test('more than 50 mounted pictures never evict a URL still in use', async () => {
  const s = setup(); const leases = [];
  for (let i = 0; i < 65; i++) {
    s.blobs.set(String(i), new Blob([String(i)])); leases.push(await s.pool.acquire(String(i)));
  }
  expect(s.revoked).toEqual([]);
  leases.forEach(lease => lease!.release()); expect(s.revoked).toHaveLength(65);
});

test('replacement exposes new bytes without revoking an old displayed revision', async () => {
  const s = setup(); s.blobs.set('a', new Blob(['old']));
  const old = await s.pool.acquire('a');
  s.blobs.set('a', new Blob(['new'])); s.pool.invalidate(['a']);
  const next = await s.pool.acquire('a');
  expect(next!.url).not.toBe(old!.url); expect(s.revoked).toEqual([]);
  expect(await next!.record.blob.text()).toBe('new');
  old!.release(); expect(s.revoked).toEqual([old!.url]); next!.release();
});

test('a late read after deletion cannot resurrect its old URL', async () => {
  let resolve!: (record: { blob: Blob } | null) => void;
  let reads = 0, creates = 0;
  const pool = new ImageUrlPool(() => ++reads === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(null), {
    create: () => `url:${++creates}`, revoke: () => {},
  });
  const pending = pool.acquire('a'); pool.invalidate(['a']); resolve({ blob: new Blob(['old']) });
  expect(await pending).toBeNull(); expect(creates).toBe(0);
});

const keys: string[] = [];
afterEach(async () => { for (const key of keys.splice(0)) await imageDb.deleteBlob(key); });
test('production writes and import compensation notify the shared display owner after commit', async () => {
  const key = `portrait-url-${crypto.randomUUID()}`; keys.push(key);
  await imageDb.saveBlob(key, new Blob(['old']), 'image/png', '显示验收人物');
  const first = await imageUrls.acquire(key);
  try {
    await imageDb.saveBlob(key, new Blob(['new']), 'image/png', '显示验收人物');
    const second = await imageUrls.acquire(key);
    expect(second!.url).not.toBe(first!.url); expect(await second!.record.blob.text()).toBe('new');
    second!.release();
    expect(await imageDb.findPortraitKeyByName('显示验收人物')).toBe(key);
    await imageDb.deleteBlob(key);
    expect(await imageUrls.acquire(key)).toBeNull();
    expect(await imageDb.findPortraitKeyByName('显示验收人物')).toBeNull();

    const record = { key, blob: new Blob(['imported']), mimeType: 'image/png', size: 8, createdAt: 1, npcName: '显示验收人物' };
    await imageDb.installTransferRecords([record], 'display-owner');
    const imported = await imageUrls.acquire(key);
    expect(await imported!.record.blob.text()).toBe('imported'); imported!.release();
    await imageDb.rollbackTransferRecords([key], 'display-owner');
    expect(await imageUrls.acquire(key)).toBeNull();
  } finally { first!.release(); }
});

test('failed deletion does not publish disappearance or retire the durable display', async () => {
  const key = `portrait-delete-${crypto.randomUUID()}`; keys.push(key);
  await imageDb.saveBlob(key, new Blob(['preserved']));
  const first = await imageUrls.acquire(key);
  const revision = imageUrls.getSnapshot();
  const transaction = IDBDatabase.prototype.transaction;
  const blocked = spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, names, mode, options) {
    if (this.name === 'WorldTravelGuideImageDB' && mode === 'readwrite') throw new Error('disk unavailable');
    return transaction.call(this, names, mode, options);
  });
  try {
    await expect(imageDb.deleteBlob(key)).rejects.toThrow('disk unavailable');
    expect(imageUrls.getSnapshot()).toBe(revision);
    const second = await imageUrls.acquire(key);
    expect(second!.url).toBe(first!.url);
    expect(await second!.record.blob.text()).toBe('preserved'); second!.release();
  } finally { blocked.mockRestore(); first!.release(); }
});

test('unsaved paid bytes are visible, then durable promotion updates existing displays without another generation', async () => {
  const key = `portrait-retained-${crypto.randomUUID()}`; keys.push(key);
  const record = { key, blob: new Blob(['paid']), mimeType: 'image/png', size: 4, createdAt: 1, npcName: '未落盘画像' };
  imageDb.retainGenerated(record);
  const first = await imageUrls.acquire(key);
  expect(await first!.record.blob.text()).toBe('paid');
  await imageDb.saveGenerated(record);
  const second = await imageUrls.acquire(key);
  expect(await second!.record.blob.text()).toBe('paid');
  first!.release(); second!.release();
});
