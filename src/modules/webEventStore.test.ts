// Web 端 Event 存储层测试（用 fake-indexeddb 模拟浏览器 IndexedDB）
import 'fake-indexeddb/auto';
import { test, expect } from 'bun:test';
import JSZip from 'jszip';
import {
  webImportFromFile,
  webListPacks,
  webEnablePack,
  webDisablePack,
  webUninstallPack,
  webValidatePack,
} from './webEventStore';
import type { Manifest } from './schema';

const manifest: Manifest = {
  id: 'test-mod',
  name: '测试事件',
  version: '1.0.0',
  author: 'tester',
  engine: 'opt-event',
  schemaVersion: 1,
  minAppVersion: '2.6.5',
  type: 'card',
  coverColor: '#3b82f6',
  icon: 'FileText',
  cards: ['schema/card.json'],
};

async function buildZip(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('schema/card.json', JSON.stringify({ version: 1, puck: { root: { props: {} }, components: {} }, cards: [] }));
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob.arrayBuffer();
}

test('web 导入 → 列表 → 启用/禁用 → 卸载', async () => {
  const f = await buildZip();
  const meta = await webImportFromFile(f);
  expect(meta.id).toBe('test-mod');

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

  await webUninstallPack('test-mod');
  const list3 = await webListPacks();
  expect(list3.length).toBe(0);
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
