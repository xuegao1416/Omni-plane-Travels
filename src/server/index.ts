/**
 * index.ts — Hono 应用装配：中间件 + 全部 API 路由。
 */
import { Hono, Context, Next } from 'hono';
import type { Bindings, SessionData, WorkshopItemType } from './types';
import type { WorkshopInput } from './workshop';
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
import {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  incrementDownloadCount,
} from './workshop';

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
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-save-version');
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
    return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '单槽存档上限 1MB' }, 413);
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

// —— 创意工坊（列表/详情 公开；上传/修改/删除 需登录）——
app.get('/api/workshop', async (c) => {
  const result = await listItems(c.env, {
    type: c.req.query('type'),
    tag: c.req.query('tag'),
    page: Number(c.req.query('page') || '1'),
    pageSize: Number(c.req.query('pageSize') || '20'),
  });
  return c.json({
    items: result.items,
    page: result.page,
    total: result.total,
    pageSize: result.pageSize,
  });
});

app.get('/api/workshop/:itemId', async (c) => {
  const item = await getItem(c.env, c.req.param('itemId')!);
  if (!item) return c.json({ error: 'NOT_FOUND', message: '条目不存在' }, 404);
  return c.json({ item });
});

app.get('/api/workshop/:itemId/download', async (c) => {
  try {
    const itemId = c.req.param('itemId')!;
    const item = await getItem(c.env, itemId);
    if (!item) return c.json({ error: 'NOT_FOUND', message: '条目不存在' }, 404);

    // 先增加下载计数
    await incrementDownloadCount(c.env, itemId);

    let tags: string[] = [];
    try { tags = item.tags ? JSON.parse(item.tags) : []; } catch { tags = []; }

    let data: unknown;
    try { data = JSON.parse(item.data_json); } catch { data = item.data_json; }

    return c.json({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      tags,
      data,
      download_count: item.download_count + 1,
      created_at: item.created_at,
      updated_at: item.updated_at,
    });
  } catch (err) {
    return c.json({ error: 'DOWNLOAD_FAILED', message: String(err) }, 500);
  }
});

app.post('/api/workshop', requireAuth, async (c) => {
  const s = c.get('session');
  const body = await c.req.json();
  const input: WorkshopInput = {
    title: body.title,
    description: body.description,
    type: body.type,
    tags: body.tags,
    data: body.data,
  };
  const res = await createItem(c.env, s.userId, input);
  return c.json(res.body, res.status as 201 | 400 | 413);
});

app.put('/api/workshop/:itemId', requireAuth, async (c) => {
  const s = c.get('session');
  const body = await c.req.json();
  const input: WorkshopInput = {
    title: body.title,
    description: body.description,
    type: body.type,
    tags: body.tags,
    data: body.data,
  };
  const res = await updateItem(c.env, s.userId, c.req.param('itemId')!, input);
  return c.json(res.body, res.status as 200 | 400 | 403 | 404 | 413);
});

app.delete('/api/workshop/:itemId', requireAuth, async (c) => {
  const s = c.get('session');
  const res = await deleteItem(c.env, s.userId, c.req.param('itemId')!);
  return c.json(res.body, res.status as 200 | 403 | 404);
});

export default app;
