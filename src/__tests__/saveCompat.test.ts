import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteSave, exportSave, importSaveFromData, importSaveFromFile, loadGame } from '../storage/db';
import { restoreGameplayManager } from '../engine/sessionRestore';
import type { WorldDef } from '../data/worlds-schema';
import type { GameState } from '../schema/variables';
import { summarizeCompatState } from './helpers/compatSummary';

/**
 * 线上存档兼容：6 个交接初始档 + 基线旧代码推进 8 回合得到的中期档。
 * 期望值由 scripts/fixtures/generateMidgameSaves.ts 在 10b4eec 上生成，重构不得改变玩家可见数值。
 */
const ROOT = join(import.meta.dir, 'fixtures/saves');
const baseline = JSON.parse(readFileSync(join(ROOT, 'expectations.json'), 'utf8')) as Record<string, Record<string, unknown>>;

/**
 * 有意的语义变化（逐条写明，期望文件本身保持基线原样）：
 * 1. 经营重写：旧版「经营资金」并入钱袋（主货币），金额相加；经营摘要里的 funds 记 null。
 */
function intentional(summary: unknown): unknown {
  const value = summary as { currency: { amount: number | null }; business: { funds: number | null } | null };
  if (!value.business || value.business.funds === null) return summary;
  return {
    ...value,
    currency: { ...value.currency, amount: (value.currency.amount ?? 0) + (value.business.funds ?? 0) },
    business: { ...value.business, funds: null },
  };
}
const expectations = Object.fromEntries(Object.entries(baseline).map(([file, entries]) =>
  [file, Object.fromEntries(Object.entries(entries).map(([key, summary]) => [key, intentional(summary)]))])) as Record<string, Record<string, unknown>>;

async function importFixture(relative: string) {
  const file = relative.split('/').at(-1)!;
  const meta = await importSaveFromFile(new File([readFileSync(join(ROOT, relative))], file));
  const save = (await loadGame(meta.id))!;
  return { meta, save, world: save.customWorld as WorldDef | undefined };
}

describe('线上存档兼容', () => {
  for (const [relative, expected] of Object.entries(expectations)) {
    test(`${relative} 读档后玩家可见数值不变`, async () => {
      const { meta, save, world } = await importFixture(relative);
      try {
        expect(save.worldId).toBe(world?.id ?? save.worldId);
        const manager = restoreGameplayManager(save, world);
        expect(summarizeCompatState(manager.getState(), world)).toEqual(expected.loaded as never);
      } finally {
        await deleteSave(meta.id);
      }
    });

    const rollbacks = Object.keys(expected).filter(key => key.startsWith('rollback:'));
    if (rollbacks.length > 0) {
      test(`${relative} 回滚到旧消息快照仍能恢复当时的状态`, async () => {
        const { meta, save, world } = await importFixture(relative);
        try {
          for (const key of rollbacks) {
            const message = save.messages.find(item => item.id === key.slice('rollback:'.length));
            expect(message?.snapshot).toBeDefined();
            const manager = restoreGameplayManager(save, world);
            manager.restoreSnapshot(structuredClone(message!.snapshot) as GameState);
            expect(summarizeCompatState(manager.getState(), world)).toEqual(expected[key] as never);
          }
        } finally {
          await deleteSave(meta.id);
        }
      });
    }

    test(`${relative} 迁移后按新结构存盘再读档，数值不变`, async () => {
      const { meta, save, world } = await importFixture(relative);
      try {
        const migrated = restoreGameplayManager(save, world);
        const bundle = migrated.createModulePersistenceBundle(save.id);
        if (bundle.coreState.resources !== undefined) throw new Error('资源状态必须存进 survival 分区，不能留在核心文档');
        const survival = bundle.current.find(record => record.moduleId === 'survival');
        if (world?.modules?.some(module => module.moduleId === 'survival' && module.enabled)) expect(survival?.schemaVersion).toBe(2);
        const reloaded = restoreGameplayManager({ ...save, gameState: bundle.coreState, moduleStates: bundle.current, moduleCheckpoints: bundle.checkpoints }, world);
        expect(summarizeCompatState(reloaded.getState(), world)).toEqual(expected.loaded as never);
      } finally {
        await deleteSave(meta.id);
      }
    });

    test(`${relative} 导出再导入后数值不变`, async () => {
      const { meta } = await importFixture(relative);
      let reimportedId: string | undefined;
      try {
        const blob = await exportSave(meta.id);
        const reimported = await importSaveFromData(JSON.parse(await blob.text()));
        reimportedId = reimported.id;
        const save = (await loadGame(reimported.id))!;
        const world = save.customWorld as WorldDef | undefined;
        const manager = restoreGameplayManager(save, world);
        expect(summarizeCompatState(manager.getState(), world)).toEqual(expected.loaded as never);
      } finally {
        await deleteSave(meta.id);
        if (reimportedId) await deleteSave(reimportedId);
      }
    });
  }
});
