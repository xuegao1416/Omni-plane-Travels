import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import type { EventRule, Manifest, RuleFile } from './schema';
import { deleteWebEvent, getWebEvent, putWebEvent } from './eventDb';
import { eventWorldEvolution, runEventRulesOnTick } from './eventIntegration';
import { getWebEnabledEventIds } from './webEventStore';

test('an enabled saved rule pack is selected for the next tick', async () => {
  const packId = 'enabled-rule-e2e';
  const manifest: Manifest = {
    id: packId,
    name: 'Enabled rule E2E',
    version: '1.0.0',
    author: 'test',
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: '2.7.0',
    type: 'rule',
    coverColor: '#3b82f6',
    icon: 'Zap',
    permissions: ['modify_world_state'],
  };
  const rules: EventRule[] = [
    { id: 'enabled-rule', when: { all: [] }, then: [{ set: { path: 'enabled_tick', value: true } }] },
  ];

  await putWebEvent({
    id: packId,
    manifest,
    enabled: true,
    status: 'enabled',
    installedAt: new Date().toISOString(),
    files: {
      'manifest.json': JSON.stringify(manifest),
      'schema/rules.json': JSON.stringify({ version: 1, rules } as RuleFile),
    },
  });

  eventWorldEvolution.clear();
  try {
    const enabledIds = await getWebEnabledEventIds();
    expect(enabledIds).toContain(packId);

    const record = await getWebEvent(packId);
    const ruleFile = JSON.parse(record!.files['schema/rules.json'] as string) as RuleFile;
    eventWorldEvolution.registerPack({
      eventPackId: packId,
      rules: ruleFile.rules,
      permissions: manifest.permissions ?? [],
      runtime: { onceFired: {}, cooldownRemaining: {} },
    });

    const ctx = runEventRulesOnTick({}, 1, []);
    expect((ctx as Record<string, unknown>).enabled_tick).toBe(true);
  } finally {
    eventWorldEvolution.clear();
    await deleteWebEvent(packId);
  }
});
