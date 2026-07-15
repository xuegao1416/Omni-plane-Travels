// Mod 接线测试：
//   (a) 纯函数：注册一个假 mod rule → 调 runEventRulesOnTick → 断言 world context 被改
//   (b) 集成：fake-indexeddb 支撑的 webEventStore 走通 导入 rule mod → getEventDetail + getWebEvent → 注册 → 生效
import 'fake-indexeddb/auto';
import { test, expect } from 'bun:test';
import JSZip from 'jszip';
import {
  eventWorldEvolution,
  runEventRulesOnTick,
} from './eventIntegration';
import { webImportFromFile, webGetEventDetail, webUninstallMod } from './webEventStore';
import { getWebEvent } from './eventDb';
import type { Manifest, EventRule, RuleFile } from './schema';

const ruleManifest: Manifest = {
  id: 'rule-mod-a',
  name: '规则ModA',
  version: '1.0.0',
  author: 'tester',
  engine: 'opt-event',
  schemaVersion: 1,
  minAppVersion: '2.6.1',
  type: 'rule',
  coverColor: '#3b82f6',
  icon: 'Zap',
  rules: ['schema/rules.json'],
  permissions: ['modify_world_state'],
};

async function buildRuleZip(rules: EventRule[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(ruleManifest));
  zip.file('schema/rules.json', JSON.stringify({ version: 1, rules } as RuleFile));
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob.arrayBuffer();
}

test('(a) 注册假 mod rule → runEventRulesOnTick 改变 world context', () => {
  eventWorldEvolution.clear();
  const rules: EventRule[] = [
    { id: 'r1', when: { all: [] }, then: [{ set: { path: 'mod_flag', value: 42 } }] },
  ];
  eventWorldEvolution.register({
    eventPackId: 'fake',
    rules,
    permissions: ['modify_world_state'],
    runtime: { onceFired: {}, cooldownRemaining: {} },
  });

  const ctx = runEventRulesOnTick({ 玩家: {} }, 1, []);
  expect((ctx as Record<string, unknown>).mod_flag).toBe(42);

  // no-op 透传：未注册任何 mod 时 context 不变且不抛错
  eventWorldEvolution.clear();
  const ctx2 = runEventRulesOnTick({ 玩家: { 血量: 10 } }, 2, []);
  expect((ctx2 as Record<string, unknown>).玩家).toEqual({ 血量: 10 });

  eventWorldEvolution.clear();
});

test('(b) fake-indexeddb: webEventStore 导入 rule mod → getEventDetail + 注册 → 每 tick 生效', async () => {
  eventWorldEvolution.clear();

  const rules: EventRule[] = [
    { id: 'r2', when: { all: [] }, then: [{ set: { path: 'web_mod_flag', value: 'on' } }] },
  ];
  const buf = await buildRuleZip(rules);
  const meta = await webImportFromFile(buf);
  expect(meta.id).toBe('rule-mod-a');

  // getEventDetail（web 走 webGetEventDetail）拿到 manifest（含 permissions）
  const detail = await webGetEventDetail('rule-mod-a');
  expect(detail.manifest.permissions).toContain('modify_world_state');

  // 从包内 schema/rules.json 取规则内容
  const rec = await getWebEvent('rule-mod-a');
  expect(rec).toBeDefined();
  const raw = rec!.files['schema/rules.json'];
  expect(typeof raw).toBe('string');
  const parsed = JSON.parse(raw as string) as RuleFile;
  expect(parsed.rules.length).toBe(1);

  // 注册
  eventWorldEvolution.register({
    eventPackId: 'rule-mod-a',
    rules: parsed.rules,
    permissions: detail.manifest.permissions ?? [],
    runtime: { onceFired: {}, cooldownRemaining: {} },
  });

  // 模拟 tick：world context 被规则修改
  const ctx = runEventRulesOnTick({ 玩家: {} }, 1, []);
  expect((ctx as Record<string, unknown>).web_mod_flag).toBe('on');

  eventWorldEvolution.clear();

  // 防止污染共享的 fake-indexeddb（后续测试文件依赖干净的 mod 列表）
  await webUninstallMod('rule-mod-a').catch(() => {});
});
