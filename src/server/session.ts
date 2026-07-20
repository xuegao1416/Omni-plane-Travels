/**
 * session.ts — 基于 D1 的会话存储 + Web Crypto HMAC 签名的会话令牌。
 *
 * 设计（遵循 spec.md §3 / architecture.md）：
 *  - 会话主存储用 D1 `sessions` 表（替代 KV）。KV 免费额度仅 1000 写/日且最终一致，
 *    会话存 KV 会导致注销后旧会话跨区仍可能可用；D1 提供强一致、可按 id 精确注销。
 *  - 令牌格式：`<sessionId>.<hmac(sessionId)>`，HMAC 用 SESSION_SECRET 签名，防伪造。
 *  - Web 端走 HttpOnly Cookie（Path=/api），桌面端走 Authorization: Bearer。
 *  - 同一令牌格式，cookie 与 bearer 共用。
 *  - D1 无自动 TTL：MVP 靠 getSession 惰性删除过期行 + logout 删除；不引入定时清理。
 */
import type { Bindings, SessionData } from './types';
import { bytesToB64url, b64urlToBytes, hmacSha256, timingSafeEqualStr } from './crypto';

/** 会话有效期：30 天。 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_NAME = 'session';

/** 创建会话，写入 D1 `sessions` 表并返回签名令牌。 */
export async function createSession(
  env: Bindings,
  userId: string,
  clientType: SessionData['clientType'],
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, client_type, created_at, expires_at) VALUES (?,?,?,?,?)',
  )
    .bind(id, userId, clientType, now, expiresAt)
    .run();
  const sig = await hmacSha256(env.SESSION_SECRET, id);
  return `${id}.${bytesToB64url(sig)}`;
}

/** 校验并读取会话；无效/过期/不存在返回 null（过期行惰性清理）。 */
export async function getSession(
  env: Bindings,
  token: string | null | undefined,
): Promise<SessionData | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = bytesToB64url(await hmacSha256(env.SESSION_SECRET, id));
  if (!timingSafeEqualStr(expected, sig)) return null;

  const row = await env.DB.prepare(
    'SELECT user_id, client_type, created_at, expires_at FROM sessions WHERE id = ?',
  )
    .bind(id)
    .first<{ user_id: string; client_type: SessionData['clientType']; created_at: number; expires_at: number }>();
  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return {
    userId: row.user_id,
    clientType: row.client_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** 注销会话（删除 D1 `sessions` 表记录）。 */
export async function destroySession(
  env: Bindings,
  token: string | null | undefined,
): Promise<void> {
  if (!token) return;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return;
  const id = token.slice(0, dot);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

/** 从请求中提取令牌：优先 Bearer，其次 Cookie。 */
export function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const cookie = req.headers.get('Cookie');
  if (cookie) {
    for (const part of cookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === COOKIE_NAME) return decodeURIComponent(v);
    }
  }
  return null;
}

/** 构造 Set-Cookie（会话）头值。secure 仅在 https 站点下添加，便于本地 http 开发。 */
export function buildSessionCookie(token: string, secure: boolean, maxAge: number): string {
  const attrs = [`Path=/api`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAge}`];
  if (secure) attrs.push('Secure');
  return `${COOKIE_NAME}=${token}; ${attrs.join('; ')}`;
}

/** 构造清除 Cookie 的头值。 */
export function buildClearCookie(secure: boolean): string {
  const attrs = [`Path=/api`, `HttpOnly`, `SameSite=Lax`, `Max-Age=0`];
  if (secure) attrs.push('Secure');
  return `${COOKIE_NAME}=; ${attrs.join('; ')}`;
}

/** 内部：把 base64url 令牌还原为 sessionId（供测试/调试，一般不外部使用）。 */
export function sessionIdFromToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  try {
    b64urlToBytes(token.slice(dot + 1));
    return token.slice(0, dot);
  } catch {
    return null;
  }
}
