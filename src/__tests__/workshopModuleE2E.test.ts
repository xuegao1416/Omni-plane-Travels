// 玩法模块端到端：作者发布 → 玩家从创意工坊下载安装 → 在世界里启用 → 新游戏里显示面板、按钮各做各的事
// → 已有存档预览、应用、恢复 → 作者发布新版本后更新。服务端走真实路由（D1 用 bun:sqlite 模拟），客户端走真实安装流程。
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import app from '../server/index';
import { createSession } from '../server/session';
import type { Bindings } from '../server/types';
import { createFakeD1 } from './helpers/fakeD1';
import { STORAGE_KEYS } from '../config/storageKeys';
import { getDB, putGlobal, SAVE_SCHEMA_VERSION } from '../storage/db';
import { createDefaultGameState, type GameState } from '../schema/variables';
import { executeInstall, previewInstall } from '../workshop/service';
import { disableModuleInWorld, enableModuleInWorld, getModuleWorldStatus, listModuleSaveOptions } from '../workshop/moduleWorlds';
import { clearCustomGameplayModules } from '../custom-modules/storage';
import { describeCustomModuleButtonOutcome, runCustomModulesForWorld } from '../custom-modules/engineBridge';
import { applySaveModuleApplication, listSaveModuleRecoveries, previewSaveModuleApplication, restoreSaveModuleRecovery } from '../custom-modules/saveApplication';
import { CustomModulePanel } from '../components/game/panels/CustomModulePanel';

const WORLD = { id: 'smith_town', name: '铁匠镇', description: '一个小镇' };
let env: Bindings;
const realFetch = globalThis.fetch;

function bench(version = '1.0.0', extra: Record<string, unknown> = {}) {
  return {
    kind: 'custom-gameplay-module', schemaVersion: 3, id: 'forge-bench', name: '铁匠台', version, author: 'player', scope: 'world',
    inputs: {}, capabilities: ['currency'], items: {},
    state: { crafted: { type: 'number', default: 0, min: 0 }, repaired: { type: 'number', default: 0, min: 0 } },
    permissions: { read: [], write: 'own-state-only' },
    logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [
      { id: 'forge', actions: [{ type: 'currency.consume', amount: 10 }, { type: 'add', path: 'crafted', value: 1 }] },
      { id: 'repair', actions: [{ type: 'add', path: 'repaired', value: 1 }] },
    ] },
    view: { slot: 'right-panel', title: '铁匠台', components: [
      { type: 'number', label: '已锻造', path: 'crafted' },
      { type: 'number', label: '已修理', path: 'repaired' },
      { type: 'button', label: '锻造（10 钱）', event: 'forge' },
      { type: 'button', label: '修理', event: 'repair' },
    ] },
    ...extra,
  };
}

async function author() {
  await env.DB.prepare('INSERT INTO users (id, email, username, created_at) VALUES (?, ?, ?, ?)').bind('author', 'author@x.test', 'author', Date.now()).run();
  return { Authorization: `Bearer ${await createSession(env, 'author', 'web')}` };
}

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function install(itemId: string) {
  const preview = await previewInstall(itemId);
  expect(preview.blockers).toEqual([]);
  return executeInstall(preview);
}

function newGame(money = 25): GameState {
  const state = createDefaultGameState();
  state.玩家.货币资源.主货币 = { 名称: '铜钱', 数量: money };
  return state;
}

async function press(state: GameState, event: string) {
  const result = await runCustomModulesForWorld(state, WORLD.id, 'onButton', { event: { type: 'button', moduleId: 'forge-bench', event } });
  return { result, message: describeCustomModuleButtonOutcome(result, 'forge-bench', '铁匠台') };
}

/** 已经开局玩过的存档：开局时已固定过模块（customModuleBindingsInitialized），之后启用的模块不会自己进来。 */
async function seedSave(id: string) {
  const gameState = newGame(40);
  gameState.customModuleBindingsInitialized = true;
  const db = await getDB();
  await db.put('saves', { id, name: `存档 ${id}`, timestamp: Date.now(), worldId: WORLD.id, schemaVersion: SAVE_SCHEMA_VERSION, round: 3, gameState, messageCount: 0, lastMessageSeq: -1 });
}

beforeEach(async () => {
  env = { DB: createFakeD1().db, SESSION_SECRET: 'secret', BREVO_API_KEY: '', EMAIL_FROM: '', WORKSHOP_ADMIN_IDS: '' };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), init, env)) as typeof fetch;
  localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify([WORLD]));
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(STORAGE_KEYS.CUSTOM_WORLDS);
  await clearCustomGameplayModules();
  await putGlobal('workshopInstalls.v1', []);
  const db = await getDB();
  for (const store of ['saves', 'global', 'module_states', 'module_checkpoints'] as const) await db.clear(store);
});

describe('创意工坊里的玩法模块', () => {
  test('模块只能用声明式组件；带 HTML 或脚本字段的模块发布被拒', async () => {
    const headers = await author();
    const rejected = await call('POST', '/api/workshop', headers, { type: 'gameplay_module', title: '坏模块', data: bench('1.0.0', { html: '<script>alert(1)</script>' }) });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('INVALID_GAMEPLAY_MODULE');
  });

  test('单独安装 → 在世界启用 → 新游戏显示面板，按钮各做各的事，失败有提示', async () => {
    const headers = await author();
    const published = await call('POST', '/api/workshop', headers, { type: 'gameplay_module', title: '铁匠台', data: bench() });
    expect(published.status).toBe(201);
    await install(published.body.id);

    expect((await getModuleWorldStatus('forge-bench'))?.enabled).toEqual([]);
    const idle = newGame();
    expect((await runCustomModulesForWorld(idle, WORLD.id, 'onGameStart', { round: 0 })).activeModuleIds).toEqual([]);

    await enableModuleInWorld('forge-bench', WORLD.id);
    expect((await getModuleWorldStatus('forge-bench'))?.enabled).toEqual([{ id: WORLD.id, name: '铁匠镇' }]);

    const state = newGame();
    expect((await runCustomModulesForWorld(state, WORLD.id, 'onGameStart', { round: 0 })).activeModuleIds).toEqual(['forge-bench']);
    const html = renderToStaticMarkup(createElement(CustomModulePanel, { gameState: state, worldId: WORLD.id }));
    expect(html).toContain('铁匠台');
    expect(html).toContain('锻造（10 钱）');
    expect(html).toContain('修理');

    expect((await press(state, 'repair')).message).toBeUndefined();
    expect(state.customModules!['forge-bench'].values).toEqual({ crafted: 0, repaired: 1 });
    expect(state.玩家.货币资源.主货币.数量).toBe(25);

    await press(state, 'forge');
    await press(state, 'forge');
    const broke = await press(state, 'forge');
    expect(state.customModules!['forge-bench'].values).toEqual({ crafted: 2, repaired: 1 });
    expect(state.玩家.货币资源.主货币.数量).toBe(5);
    expect(broke.message).toBe('「铁匠台」：铜钱不足');

    await disableModuleInWorld('forge-bench', WORLD.id);
    const later = newGame();
    expect((await runCustomModulesForWorld(later, WORLD.id, 'onGameStart', { round: 0 })).activeModuleIds).toEqual([]);
  });

  test('已有存档：启用后预览、应用（带恢复点），可以恢复；作者发布新版本后更新到世界与存档', async () => {
    const headers = await author();
    const published = await call('POST', '/api/workshop', headers, { type: 'gameplay_module', title: '铁匠台', data: bench() });
    await install(published.body.id);
    await seedSave('old');
    expect(await listModuleSaveOptions('forge-bench')).toEqual([]);

    await enableModuleInWorld('forge-bench', WORLD.id);
    const [option] = await listModuleSaveOptions('forge-bench');
    expect(option).toMatchObject({ saveId: 'old', worldId: WORLD.id, worldName: '铁匠镇', active: false });

    const preview = await previewSaveModuleApplication(option.saveId, option.module);
    expect(preview.conflicts).toEqual([]);
    expect(preview.changes[0]).toContain('新增 铁匠台 1.0.0');
    const recovery = await applySaveModuleApplication(preview);
    const db = await getDB();
    expect((await db.get('saves', 'old')).gameState.customModules['forge-bench'].moduleVersion).toBe('1.0.0');

    await restoreSaveModuleRecovery(recovery.id);
    expect((await db.get('saves', 'old')).gameState.customModules?.['forge-bench']).toBeUndefined();
    expect((await listSaveModuleRecoveries('old'))[0].restoredAt).toBeDefined();
    await applySaveModuleApplication(await previewSaveModuleApplication('old', option.module));

    // 作者发布 1.1.0：已安装的玩家更新后，启用的世界换成新版本；已有存档仍是 1.0.0，可以预览并应用更新。
    const updated = await call('PUT', `/api/workshop/${published.body.id}`, headers, { data: bench('1.1.0'), version: '1.1.0', changelog: '更结实的铁砧' });
    expect(updated.status).toBe(200);
    await install(published.body.id);
    const fresh = newGame();
    await runCustomModulesForWorld(fresh, WORLD.id, 'onGameStart', { round: 0 });
    expect(fresh.customModules!['forge-bench'].moduleVersion).toBe('1.1.0');
    const [next] = await listModuleSaveOptions('forge-bench');
    expect(next.module.version).toBe('1.1.0');
    const upgrade = await previewSaveModuleApplication(next.saveId, next.module);
    expect(upgrade.changes[0]).toContain('1.0.0 → 1.1.0');
    await applySaveModuleApplication(upgrade);
    expect((await db.get('saves', 'old')).gameState.customModules['forge-bench'].moduleVersion).toBe('1.1.0');
  });
});
