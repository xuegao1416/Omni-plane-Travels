/**
 * index.ts — Hono 应用装配：中间件 + 全部 API 路由。
 */
import { Hono, Context, type Next } from 'hono';
import type { Bindings, SessionData, WorkshopItemType } from './types';
import { extractToken, getSession, destroySession, buildClearCookie } from './session';
import { handleSendCode, handleRegister, handleLogin, handleResetPassword } from './email-auth';
import { getUserById } from './db';
import {
  listSlots,
  getSlotContent,
  putSlot,
  deleteSlot,
  MAX_SLOT_BYTES,
} from './saves';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { bytesToB64url, hmacSha256 } from './crypto';
import {
  adminUpdateItem,
  checkUpdates,
  clearRating,
  createItem,
  deleteItem,
  getDownload,
  getItemDetail,
  getRow,
  isWorkshopAdmin,
  listFavoriteItems,
  listItems,
  listOwnerItems,
  listReports,
  listVersions,
  rateItem,
  reportItem,
  resolveInstallPlan,
  resolveReport,
  setFavorite,
  setItemStatus,
  updateItem,
  type WorkshopInput,
  type WorkshopResult,
} from './workshop';
import { WORKSHOP_LIMITS } from '../workshop/protocol';

type AppEnv = {
  Bindings: Bindings;
  Variables: { session: SessionData };
};

const app = new Hono<AppEnv>();

// —— CORS（仅对桌面端/Bearer 的 Origin 放行；同源 Web 无 Origin 头，自动跳过）——
const DESKTOP_ORIGIN_PREFIX = 'tauri://';
app.use('*', async (c: Context<AppEnv>, next: Next) => {
  const origin = c.req.header('Origin');
  const allowed = (c.env.ALLOWED_ORIGINS || 'tauri://localhost,http://localhost:8788')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && (allowed.includes(origin) || origin.startsWith(DESKTOP_ORIGIN_PREFIX))) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-Match, x-save-version, x-content-encoding, x-workshop-client');
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// —— 统一错误处理 ——
app.onError((err, c) => {
  console.error('[api] unhandled error', err);
  return c.json({ error: 'INTERNAL', message: '服务器内部错误' }, 500);
});

// —— 404 ——
app.notFound((c) => c.json({ error: 'NOT_FOUND', message: '接口不存在' }, 404));

// —— 鉴权中间件 ——
async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = extractToken(c.req.raw);
  const session = await getSession(c.env, token);
  if (!session) {
    return c.json({ error: 'UNAUTHORIZED', message: '未登录' }, 401);
  }
  c.set('session', session);
  await next();
}

// —— 健康检查 ——
app.get('/api/health', (c) => c.json({ ok: true }));

// —— 认证（邮箱验证码 + 密码双模式）——
app.post('/api/auth/send-code', (c) => handleSendCode(c.req.raw, c.env));
app.post('/api/auth/register', (c) => handleRegister(c.req.raw, c.env));
app.post('/api/auth/login', (c) => handleLogin(c.req.raw, c.env));
app.post('/api/auth/reset-password', (c) => handleResetPassword(c.req.raw, c.env));

app.post('/api/auth/logout', requireAuth, async (c) => {
  const token = extractToken(c.req.raw);
  await destroySession(c.env, token);
  const headers: Record<string, string> = {};
  if (token) headers['Set-Cookie'] = buildClearCookie(true);
  return c.json({ ok: true }, 200, headers);
});

// —— 当前用户 ——
app.get('/api/me', requireAuth, async (c) => {
  const s = c.get('session');
  const user = await getUserById(c.env, s.userId);
  if (!user) return c.json({ error: 'NOT_FOUND', message: '用户不存在' }, 404);
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name ?? null,
      workshopAdmin: isWorkshopAdmin(c.env, user.id),
    },
  });
});

// —— 云存档（全部需登录）——
app.use('/api/saves/*', requireAuth);

app.get('/api/saves', async (c) => {
  const s = c.get('session');
  const slots = await listSlots(c.env, s.userId);
  return c.json({ slots });
});

app.get('/api/saves/:slotId', async (c) => {
  const s = c.get('session');
  const content = await getSlotContent(c.env, s.userId, c.req.param('slotId')!);
  if (!content) return c.json({ error: 'NOT_FOUND', message: '槽位不存在' }, 404);
  return c.json({
    payload_json: content.payload_json,
    version: content.version,
  });
});

app.put('/api/saves/:slotId', async (c) => {
  const s = c.get('session');
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_SLOT_BYTES) {
    return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '单槽存档上限 10MB' }, 413);
  }
  const body = await c.req.json();
  const payloadJson = JSON.stringify(body);
  try {
    JSON.parse(payloadJson);
  } catch {
    return c.json({ error: 'INVALID_JSON', message: '存档内容必须是合法 JSON' }, 400);
  }
  const versionHeader = c.req.header('x-save-version') ?? null;
  const contentEncoding = c.req.header('x-content-encoding') ?? null;
  const res = await putSlot(c.env, s.userId, c.req.param('slotId')!, payloadJson, versionHeader, contentEncoding);
  return c.json(res.body, res.status as 200 | 403 | 409 | 413);
});

app.delete('/api/saves/:slotId', async (c) => {
  const s = c.get('session');
  const res = await deleteSlot(c.env, s.userId, c.req.param('slotId')!);
  return c.json(res.body, res.status as 200 | 404);
});

// —— 创意工坊 ——
// 浏览、详情、安装计划、下载公开；发布、修改、评分、收藏、举报需登录；举报处理与精选需管理员。
// 静态路径（mine / favorites / updates / admin）必须注册在 /:itemId 之前。

/** 1MB 内容 + 元数据与 JSON 转义余量。 */
const MAX_WORKSHOP_BODY_BYTES = 1_572_864;

type JsonBody = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

async function readJsonBody(c: Context<AppEnv>, maxBytes = 65_536): Promise<JsonBody> {
  const declared = Number(c.req.header('Content-Length') || 0);
  const tooLarge = () => ({ ok: false as const, response: c.json({ error: 'PAYLOAD_TOO_LARGE', message: '请求体过大' }, 413) });
  if (declared > maxBytes) return tooLarge();
  let text = '';
  try { text = await c.req.text(); } catch { text = ''; }
  if (new TextEncoder().encode(text).length > maxBytes) return tooLarge();
  try {
    const body = JSON.parse(text || 'null') as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) return { ok: true, body: body as Record<string, unknown> };
  } catch { /* fall through */ }
  return { ok: false, response: c.json({ error: 'INVALID_JSON', message: '请求体必须是 JSON 对象' }, 400) };
}

function workshopInput(body: Record<string, unknown>): WorkshopInput {
  const pick = <K extends keyof WorkshopInput>(key: K) => body[key] as WorkshopInput[K];
  return {
    title: pick('title'), description: pick('description'), changelog: pick('changelog'), type: pick('type'), contentType: pick('contentType'),
    tags: pick('tags'), data: pick('data'), version: pick('version'), expectedVersion: pick('expectedVersion'), category: pick('category'),
    dependencies: pick('dependencies'), recommendations: pick('recommendations'), minAppVersion: pick('minAppVersion'),
    compatibility: pick('compatibility'), screenshots: pick('screenshots'), status: pick('status'),
  };
}

function reply(c: Context<AppEnv>, result: WorkshopResult) {
  return c.json(result.body, result.status as ContentfulStatusCode);
}

async function optionalSession(c: Context<AppEnv>): Promise<SessionData | null> {
  const token = extractToken(c.req.raw);
  return token ? getSession(c.env, token) : null;
}

/** 下载去重用的客户端摘要：登录用户按账号，否则按客户端随机 id，最后才退回 IP+UA 的摘要（不存原文）。 */
async function downloadClientKey(c: Context<AppEnv>, session: SessionData | null): Promise<string> {
  if (session) return `u:${session.userId}`;
  const client = c.req.header('x-workshop-client');
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const raw = client && /^[a-z0-9-]{8,64}$/i.test(client) ? `c:${client}` : `i:${ip}|${c.req.header('User-Agent') || ''}`;
  return `${raw[0]}:${bytesToB64url(await hmacSha256(c.env.SESSION_SECRET, raw)).slice(0, 22)}`;
}

async function requireWorkshopAdmin(c: Context<AppEnv>, next: Next) {
  if (!isWorkshopAdmin(c.env, c.get('session')?.userId)) return c.json({ error: 'FORBIDDEN', message: '需要创意工坊管理员权限' }, 403);
  await next();
}

app.get('/api/workshop', async (c) => {
  const result = await listItems(c.env, {
    type: c.req.query('type'),
    tag: c.req.query('tag'),
    q: c.req.query('q'),
    author: c.req.query('author'),
    page: Number(c.req.query('page') || '1'),
    pageSize: Number(c.req.query('pageSize') || '20'),
    sort: c.req.query('sort'),
    category: c.req.query('category'),
  });
  return c.json(result);
});

app.get('/api/workshop/updates', async (c) => {
  const ids = (c.req.query('ids') || '').split(',').map(entry => entry.split('@')[0]);
  return c.json({ items: await checkUpdates(c.env, ids) });
});

app.get('/api/workshop/mine', requireAuth, async (c) => c.json({ items: await listOwnerItems(c.env, c.get('session').userId) }));
app.get('/api/workshop/favorites', requireAuth, async (c) => c.json({ items: await listFavoriteItems(c.env, c.get('session').userId) }));

app.get('/api/workshop/admin/reports', requireAuth, requireWorkshopAdmin, async (c) => c.json({ reports: await listReports(c.env, c.req.query('status')) }));
app.post('/api/workshop/admin/reports/:reportId', requireAuth, requireWorkshopAdmin, async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;
  return reply(c, await resolveReport(c.env, c.get('session').userId, c.req.param('reportId')!, parsed.body.action, parsed.body.note, parsed.body.hideItem));
});
app.patch('/api/workshop/admin/items/:itemId', requireAuth, requireWorkshopAdmin, async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;
  return reply(c, await adminUpdateItem(c.env, c.req.param('itemId')!, { featured: parsed.body.featured, status: parsed.body.status }));
});

app.get('/api/workshop/:itemId/install-plan', async (c) => {
  const plan = await resolveInstallPlan(c.req.param('itemId')!, id => getRow(c.env, id));
  return c.json(plan, plan.ok ? 200 : 409);
});

app.get('/api/workshop/:itemId/versions', async (c) => {
  const session = await optionalSession(c);
  return reply(c, await listVersions(c.env, c.req.param('itemId')!, session?.userId));
});

app.get('/api/workshop/:itemId/download', async (c) => {
  const session = await optionalSession(c);
  const clientKey = await downloadClientKey(c, session);
  return reply(c, await getDownload(c.env, c.req.param('itemId')!, clientKey, c.req.query('version') || undefined));
});

app.get('/api/workshop/:itemId', async (c) => {
  const session = await optionalSession(c);
  return reply(c, await getItemDetail(c.env, c.req.param('itemId')!, session?.userId));
});

app.post('/api/workshop', requireAuth, async (c) => {
  const parsed = await readJsonBody(c, MAX_WORKSHOP_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  return reply(c, await createItem(c.env, c.get('session').userId, workshopInput(parsed.body)));
});

app.put('/api/workshop/:itemId', requireAuth, async (c) => {
  const parsed = await readJsonBody(c, MAX_WORKSHOP_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const input = workshopInput(parsed.body);
  const ifMatch = c.req.header('If-Match');
  if (input.expectedVersion === undefined && ifMatch) input.expectedVersion = ifMatch.replace(/^W\//, '').replace(/"/g, '');
  return reply(c, await updateItem(c.env, c.get('session').userId, c.req.param('itemId')!, input));
});

app.patch('/api/workshop/:itemId/status', requireAuth, async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;
  return reply(c, await setItemStatus(c.env, c.get('session').userId, c.req.param('itemId')!, parsed.body.status));
});

app.delete('/api/workshop/:itemId', requireAuth, async (c) => reply(c, await deleteItem(c.env, c.get('session').userId, c.req.param('itemId')!)));

app.put('/api/workshop/:itemId/rating', requireAuth, async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;
  return reply(c, await rateItem(c.env, c.get('session').userId, c.req.param('itemId')!, parsed.body.score));
});
app.delete('/api/workshop/:itemId/rating', requireAuth, async (c) => reply(c, await clearRating(c.env, c.get('session').userId, c.req.param('itemId')!)));

app.put('/api/workshop/:itemId/favorite', requireAuth, async (c) => reply(c, await setFavorite(c.env, c.get('session').userId, c.req.param('itemId')!, true)));
app.delete('/api/workshop/:itemId/favorite', requireAuth, async (c) => reply(c, await setFavorite(c.env, c.get('session').userId, c.req.param('itemId')!, false)));

app.post('/api/workshop/:itemId/report', requireAuth, async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;
  return reply(c, await reportItem(c.env, c.get('session').userId, c.req.param('itemId')!, parsed.body.reason, parsed.body.detail));
});

/** 公开昵称（工坊作者名）。 */
app.put('/api/me/profile', requireAuth, async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;
  const raw = typeof parsed.body.displayName === 'string' ? parsed.body.displayName : '';
  const displayName = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, WORKSHOP_LIMITS.displayName);
  await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName || null, c.get('session').userId).run();
  return c.json({ ok: true, displayName: displayName || null });
});

// ——— 匿名游玩统计（无需鉴权；数据完全匿名）———
import { handlePostPlayStat } from './playStats';

app.post('/api/stats/play', (c) => handlePostPlayStat(c));

export default app;
