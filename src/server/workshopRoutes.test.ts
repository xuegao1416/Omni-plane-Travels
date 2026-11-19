import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'bun:test';
import app from './index';
import { createSession } from './session';
import { MIGRATIONS_DIR, createFakeD1 } from '../__tests__/helpers/fakeD1';
import { join } from 'node:path';
import type { Bindings } from './types';

let env: Bindings;

const world = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `世界 ${id}`, description: '测试世界', ...extra });
const eventPack = (id: string) => ({ manifest: { id, name: `事件 ${id}`, version: '1.0.0', type: 'rule' }, rules: [] });

async function signIn(id: string, displayName: string | null = null) {
  await env.DB.prepare('INSERT INTO users (id, email, username, created_at, display_name) VALUES (?, ?, ?, ?, ?)')
    .bind(id, `${id}@secret-mail.test`, id, Date.now(), displayName).run();
  const token = await createSession(env, id, 'web');
  return { id, headers: { Authorization: `Bearer ${token}` } };
}

async function call(method: string, path: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...options.headers } };
  if (options.body !== undefined) init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  const res = await app.request(path, init, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function publish(author: { headers: Record<string, string> }, body: Record<string, unknown>) {
  const res = await call('POST', '/api/workshop', { headers: author.headers, body: { type: 'world_package', title: '标题', data: world('w'), ...body } });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeEach(() => {
  env = { DB: createFakeD1().db, SESSION_SECRET: 'test-secret', BREVO_API_KEY: '', EMAIL_FROM: '', WORKSHOP_ADMIN_IDS: 'admin' };
});

describe('workshop v3 migration', () => {
  test('rebuilds legacy rows: real type, version history, draft → unlisted, private presets hidden', () => {
    const sqlite = new Database(':memory:');
    const dir = MIGRATIONS_DIR;
    const files = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
    for (const name of files.filter(file => file < '0010')) sqlite.exec(readFileSync(join(dir, name), 'utf8'));
    const insert = sqlite.query(`INSERT INTO workshop_items (id, owner_id, type, content_type, title, description, tags, data_json, status, download_count, created_at, updated_at, version)
      VALUES (?, 'o', ?, ?, ?, NULL, '["奇幻"]', ?, ?, 7, 1, 2, ?)`);
    insert.run('mod', 'world_package', 'gameplay_module', '模块', JSON.stringify({ id: 'forge', name: 'Forge' }), 'published', '1.2.0');
    insert.run('draft', 'world_package', null, '草稿', JSON.stringify({ id: 'w', name: 'W' }), 'draft', '1.0.0');
    insert.run('private', 'character_preset', 'character_preset', '主角', '{}', 'published', '1.0.0');
    sqlite.exec(readFileSync(join(dir, files.find(file => file.startsWith('0010'))!), 'utf8'));

    const rows = sqlite.query('SELECT id, type, content_id, status, download_count, data_size FROM workshop_items ORDER BY id').all() as any[];
    expect(rows).toEqual([
      { id: 'draft', type: 'world_package', content_id: 'w', status: 'unlisted', download_count: 7, data_size: Buffer.byteLength(JSON.stringify({ id: 'w', name: 'W' })) },
      { id: 'mod', type: 'gameplay_module', content_id: 'forge', status: 'published', download_count: 7, data_size: Buffer.byteLength(JSON.stringify({ id: 'forge', name: 'Forge' })) },
      { id: 'private', type: 'character_preset', content_id: null, status: 'hidden', download_count: 7, data_size: 2 },
    ]);
    expect(sqlite.query('SELECT item_id, version FROM workshop_versions ORDER BY item_id').all()).toEqual([
      { item_id: 'draft', version: '1.0.0' }, { item_id: 'mod', version: '1.2.0' }, { item_id: 'private', version: '1.0.0' },
    ]);
    // 新类型不再受旧 CHECK 限制。
    sqlite.query(`INSERT INTO workshop_items (id, owner_id, type, title, data_json, created_at, updated_at) VALUES ('x', 'o', 'visual_theme', 't', '{}', 1, 1)`).run();
  });
});

describe('workshop routes', () => {
  test('publishes, lists, searches and shows a public author name without leaking the email', async () => {
    const named = await signIn('alice', '星图绘师');
    const anonymous = await signIn('bob-0000-1111');
    await publish(named, { title: '雾港奇谈', description: '蒸汽与海雾', tags: ['蒸汽朋克'], data: world('fog') });
    await publish(anonymous, { title: '沙海', type: 'event_pack', data: eventPack('dunes') });

    const all = await call('GET', '/api/workshop');
    expect(all.body.total).toBe(2);
    const fog = all.body.items.find((item: any) => item.title === '雾港奇谈');
    expect(fog.author).toEqual({ id: 'alice', name: '星图绘师' });
    expect(fog.contentId).toBe('fog');
    const dunes = all.body.items.find((item: any) => item.title === '沙海');
    expect(dunes.author.name).toBe('旅者·bob000');
    expect(JSON.stringify(all.body)).not.toContain('secret-mail');

    expect((await call('GET', '/api/workshop?q=海雾')).body.items.map((item: any) => item.title)).toEqual(['雾港奇谈']);
    expect((await call('GET', '/api/workshop?q=dunes')).body.items.map((item: any) => item.title)).toEqual(['沙海']);
    expect((await call('GET', '/api/workshop?type=event_pack')).body.total).toBe(1);
    expect((await call('GET', '/api/workshop?tag=蒸汽朋克')).body.total).toBe(1);
    // LIKE 通配符不会匹配全部条目。
    expect((await call('GET', '/api/workshop?tag=%25')).body.total).toBe(0);
    expect((await call('GET', '/api/workshop?q=%25')).body.total).toBe(0);
    expect((await call('GET', '/api/workshop?author=alice')).body.total).toBe(1);
  });

  test('rejects malformed JSON, private presets, bad versions and oversized content with precise errors', async () => {
    const author = await signIn('alice');
    expect((await call('POST', '/api/workshop', { headers: author.headers, body: '{"title":' })).body.error).toBe('INVALID_JSON');
    expect((await call('POST', '/api/workshop', { headers: author.headers, body: { type: 'history_preset', title: 'x', data: {} } })).body.error).toBe('PRIVATE_CONTENT_TYPE');
    expect((await call('POST', '/api/workshop', { headers: author.headers, body: { type: 'world_package', title: 'x', version: 'v2', data: world('a') } })).body.error).toBe('INVALID_VERSION');
    const big = await call('POST', '/api/workshop', { headers: author.headers, body: { type: 'world_package', title: 'x', data: world('a', { lore: '字'.repeat(400_000) }) } });
    expect(big.status).toBe(413);
    expect((await call('POST', '/api/workshop', { body: { type: 'world_package', title: 'x', data: world('a') } })).status).toBe(401);
  });

  test('a new version needs a higher number, keeps history, and old versions stay downloadable', async () => {
    const author = await signIn('alice');
    const id = await publish(author, { version: '1.0.0', data: world('w', { lore: 'v1' }) });

    const same = await call('PUT', `/api/workshop/${id}`, { headers: author.headers, body: { version: '1.0.0', data: world('w', { lore: 'v1b' }) } });
    expect(same.status).toBe(409);
    expect(same.body).toMatchObject({ error: 'VERSION_NOT_INCREASED', suggestedVersion: '1.0.1' });
    const stale = await call('PUT', `/api/workshop/${id}`, { headers: author.headers, body: { expectedVersion: '0.9.0', title: '新标题' } });
    expect(stale.body.error).toBe('VERSION_CONFLICT');

    const next = await call('PUT', `/api/workshop/${id}`, { headers: author.headers, body: { version: '1.1.0', changelog: '新增地图', data: world('w', { lore: 'v2' }), expectedVersion: '1.0.0' } });
    expect(next.body).toMatchObject({ ok: true, version: '1.1.0', newVersion: true });
    const rename = await call('PUT', `/api/workshop/${id}`, { headers: author.headers, body: { title: '改名不升版本' } });
    expect(rename.body).toMatchObject({ ok: true, version: '1.1.0', newVersion: false });
    const depsOnly = await call('PUT', `/api/workshop/${id}`, { headers: author.headers, body: { minAppVersion: '9.0.0' } });
    expect(depsOnly.body.error).toBe('VERSION_REQUIRED');

    const versions = await call('GET', `/api/workshop/${id}/versions`);
    expect(versions.body.versions.map((entry: any) => [entry.version, entry.changelog])).toEqual([['1.1.0', '新增地图'], ['1.0.0', null]]);
    expect((await call('GET', `/api/workshop/${id}/download`)).body.data.lore).toBe('v2');
    const old = await call('GET', `/api/workshop/${id}/download?version=1.0.0`);
    expect(old.body).toMatchObject({ version: '1.0.0', data: { lore: 'v1' } });
    expect((await call('GET', `/api/workshop/${id}/download?version=3.0.0`)).body.error).toBe('VERSION_NOT_FOUND');
    expect((await call('PUT', `/api/workshop/${id}`, { headers: author.headers, body: { type: 'event_pack' } })).body.error).toBe('TYPE_IMMUTABLE');
    const other = await signIn('mallory');
    expect((await call('PUT', `/api/workshop/${id}`, { headers: other.headers, body: { title: 'x' } })).status).toBe(403);
  });

  test('install plans order dependencies leaf-first, list recommendations without installing them, and flag unavailable items', async () => {
    const author = await signIn('alice');
    expect((await call('POST', '/api/workshop', { headers: author.headers, body: { type: 'event_pack', title: '缺依赖', data: eventPack('x'), dependencies: [{ id: 'nope' }] } })).body.error).toBe('DEPENDENCY_UNAVAILABLE');
    const base = await publish(author, { type: 'event_pack', title: '基础事件', data: eventPack('base') });
    const unlisted = await publish(author, { type: 'event_pack', title: '隐藏依赖', data: eventPack('hidden'), status: 'unlisted' });
    const extra = await publish(author, { type: 'event_pack', title: '推荐内容', data: eventPack('extra') });
    const root = await publish(author, {
      title: '主世界', data: world('main'),
      dependencies: [{ id: base, version: '1.0.0' }, { id: unlisted }],
      recommendations: [{ id: extra, reason: '更多事件' }],
    });

    const plan = await call('GET', `/api/workshop/${root}/install-plan`);
    expect(plan.status).toBe(200);
    expect(plan.body.items.map((item: any) => item.title)).toEqual(['基础事件', '隐藏依赖', '主世界']);
    expect(plan.body.recommendations).toEqual([{ id: extra, reason: '更多事件', available: true, title: '推荐内容', type: 'event_pack', currentVersion: '1.0.0' }]);
    expect((await call('GET', '/api/workshop')).body.items.map((item: any) => item.title)).not.toContain('隐藏依赖');

    expect((await call('PATCH', `/api/workshop/${base}/status`, { headers: author.headers, body: { status: 'archived' } })).status).toBe(200);
    const blocked = await call('GET', `/api/workshop/${root}/install-plan`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.errors).toEqual([expect.objectContaining({ code: 'UNAVAILABLE', id: base, status: 'archived' })]);
    expect((await call('GET', `/api/workshop/${base}/download`)).status).toBe(410);

    // 依赖不能绕回自己。
    await call('PATCH', `/api/workshop/${base}/status`, { headers: author.headers, body: { status: 'published' } });
    const cycle = await call('PUT', `/api/workshop/${base}`, { headers: author.headers, body: { version: '1.0.1', data: eventPack('base'), dependencies: [{ id: root }] } });
    expect(cycle.body.error).toBe('DEPENDENCY_CYCLE');
  });

  test('downloads are counted once per user per day', async () => {
    const author = await signIn('alice');
    const reader = await signIn('reader');
    const id = await publish(author, {});
    await call('GET', `/api/workshop/${id}/download`, { headers: reader.headers });
    await call('GET', `/api/workshop/${id}/download`, { headers: reader.headers });
    await call('GET', `/api/workshop/${id}/download`, { headers: { 'x-workshop-client': 'device-aaaa-bbbb' } });
    await call('GET', `/api/workshop/${id}/download`, { headers: { 'x-workshop-client': 'device-aaaa-bbbb' } });
    expect((await call('GET', `/api/workshop/${id}`)).body.item.downloadCount).toBe(2);
  });

  test('ratings and favorites keep aggregates, viewer state and sorting in sync', async () => {
    const author = await signIn('alice');
    const fans = await Promise.all(['u1', 'u2', 'u3'].map(id => signIn(id)));
    const loved = await publish(author, { title: '好评' });
    const meh = await publish(author, { title: '一般' });
    expect((await call('PUT', `/api/workshop/${loved}/rating`, { headers: author.headers, body: { score: 5 } })).body.error).toBe('SELF_RATING');
    expect((await call('PUT', `/api/workshop/${loved}/rating`, { headers: fans[0].headers, body: { score: 9 } })).body.error).toBe('INVALID_SCORE');
    for (const fan of fans) await call('PUT', `/api/workshop/${loved}/rating`, { headers: fan.headers, body: { score: 5 } });
    await call('PUT', `/api/workshop/${loved}/rating`, { headers: fans[0].headers, body: { score: 4 } });
    await call('PUT', `/api/workshop/${meh}/rating`, { headers: fans[0].headers, body: { score: 2 } });
    await call('PUT', `/api/workshop/${loved}/favorite`, { headers: fans[1].headers });
    await call('PUT', `/api/workshop/${loved}/favorite`, { headers: fans[1].headers });

    const detail = await call('GET', `/api/workshop/${loved}`, { headers: fans[1].headers });
    expect(detail.body.item).toMatchObject({ ratingCount: 3, ratingAverage: 4.7, favoriteCount: 1 });
    expect(detail.body.item.viewer).toEqual({ isOwner: false, rating: 5, favorited: true, reported: false });
    expect((await call('GET', '/api/workshop?sort=rating')).body.items.map((item: any) => item.title)).toEqual(['好评', '一般']);
    expect((await call('GET', '/api/workshop/favorites', { headers: fans[1].headers })).body.items.map((item: any) => item.id)).toEqual([loved]);

    await call('DELETE', `/api/workshop/${loved}/favorite`, { headers: fans[1].headers });
    await call('DELETE', `/api/workshop/${loved}/rating`, { headers: fans[0].headers });
    expect((await call('GET', `/api/workshop/${loved}`)).body.item).toMatchObject({ ratingCount: 2, ratingAverage: 5, favoriteCount: 0 });
  });

  test('reports auto-hide after enough distinct reporters, and only admins can review and restore', async () => {
    const author = await signIn('alice');
    const id = await publish(author, { title: '可疑条目' });
    const reporters = await Promise.all(['r1', 'r2', 'r3', 'r4', 'r5'].map(name => signIn(name)));
    expect((await call('POST', `/api/workshop/${id}/report`, { headers: reporters[0].headers, body: { reason: 'nonsense' } })).body.error).toBe('INVALID_REASON');
    expect((await call('POST', `/api/workshop/${id}/report`, { headers: reporters[0].headers, body: { reason: 'spam', detail: '广告' } })).status).toBe(201);
    expect((await call('POST', `/api/workshop/${id}/report`, { headers: reporters[0].headers, body: { reason: 'spam' } })).body.error).toBe('ALREADY_REPORTED');
    let last: any;
    for (const reporter of reporters.slice(1)) last = await call('POST', `/api/workshop/${id}/report`, { headers: reporter.headers, body: { reason: 'malicious' } });
    expect(last.body.hidden).toBe(true);
    expect((await call('GET', '/api/workshop')).body.total).toBe(0);
    expect((await call('GET', `/api/workshop/${id}`)).status).toBe(404);
    expect((await call('GET', `/api/workshop/${id}`, { headers: author.headers })).body.item.status).toBe('hidden');
    expect((await call('PATCH', `/api/workshop/${id}/status`, { headers: author.headers, body: { status: 'published' } })).body.error).toBe('HIDDEN_BY_MODERATION');

    expect((await call('GET', '/api/workshop/admin/reports', { headers: author.headers })).status).toBe(403);
    const admin = await signIn('admin');
    const reports = await call('GET', '/api/workshop/admin/reports', { headers: admin.headers });
    expect(reports.body.reports).toHaveLength(5);
    expect(reports.body.reports[0].itemTitle).toBe('可疑条目');
    for (const report of reports.body.reports) {
      await call('POST', `/api/workshop/admin/reports/${report.id}`, { headers: admin.headers, body: { action: 'dismiss', note: '误报' } });
    }
    expect((await call('PATCH', `/api/workshop/admin/items/${id}`, { headers: admin.headers, body: { status: 'published', featured: true } })).body).toMatchObject({ featured: true, status: 'published' });
    expect((await call('GET', '/api/workshop?sort=featured')).body.items[0]).toMatchObject({ id, featured: true });
    expect((await call('GET', '/api/workshop/admin/reports', { headers: admin.headers })).body.reports).toHaveLength(0);
    expect((await call('GET', '/api/me', { headers: admin.headers })).body.user.workshopAdmin).toBe(true);
  });

  test('soft delete keeps a tombstone that dependents and update checks can explain', async () => {
    const author = await signIn('alice');
    const dep = await publish(author, { type: 'event_pack', title: '依赖', data: eventPack('dep') });
    const root = await publish(author, { title: '世界', dependencies: [{ id: dep }] });
    expect((await call('DELETE', `/api/workshop/${dep}`, { headers: (await signIn('mallory')).headers })).status).toBe(403);
    expect((await call('DELETE', `/api/workshop/${dep}`, { headers: author.headers })).status).toBe(200);

    expect((await call('GET', `/api/workshop/${dep}/download`)).status).toBe(404);
    expect((await call('GET', `/api/workshop/${root}/install-plan`)).body.errors).toEqual([expect.objectContaining({ code: 'UNAVAILABLE', id: dep, status: 'deleted' })]);
    expect((await call('GET', '/api/workshop/mine', { headers: author.headers })).body.items.map((item: any) => item.id)).toEqual([root]);
    const updates = await call('GET', `/api/workshop/updates?ids=${dep}@1.0.0,${root}@1.0.0,unknown`);
    expect(Object.fromEntries(updates.body.items.map((item: any) => [item.id, item.status]))).toEqual({ [dep]: 'deleted', [root]: 'published' });
  });

  test('display names are set through the profile endpoint and trimmed', async () => {
    const author = await signIn('alice');
    const saved = await call('PUT', '/api/me/profile', { headers: author.headers, body: { displayName: '  雾港旅人\u0007  ' } });
    expect(saved.body.displayName).toBe('雾港旅人');
    expect((await call('GET', '/api/me', { headers: author.headers })).body.user).toMatchObject({ displayName: '雾港旅人', workshopAdmin: false });
  });
});
