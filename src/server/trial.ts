import type { Context } from 'hono';
import type { Bindings, SessionData } from './types';
import { extractToken, getSession } from './session';
import { bytesToB64url, hmacSha256, timingSafeEqualStr } from './crypto';

export const DEFAULT_TRIAL_LIMIT = 3;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 32_000;
const TRIAL_TOKEN_PATTERN = /^([A-Za-z0-9_-]{32,64})\.([A-Za-z0-9_-]{43})$/;
const TRIAL_COOKIE = 'omni_trial_id';
/** 单次上游请求的最大预留时长；过期后下一次请求会回收该租约。 */
export const TRIAL_RESERVATION_TTL_MS = 10 * 60 * 1000;

type TrialMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface TrialCompletionBody {
  model?: string;
  messages: TrialMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: { type: 'text' | 'json_object' };
}

export interface TrialConfig {
  configured: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  limit: number;
}

export function getTrialConfig(env: Bindings): TrialConfig {
  const baseUrl = env.TRIAL_LLM_BASE_URL?.trim();
  const apiKey = env.TRIAL_LLM_API_KEY?.trim();
  const model = env.TRIAL_LLM_MODEL?.trim();
  const parsedLimit = Number(env.TRIAL_MAX_REQUESTS);
  const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_TRIAL_LIMIT;
  return { configured: Boolean(baseUrl && apiKey && model && resolveTrialEndpoint(baseUrl)), baseUrl, apiKey, model, limit };
}

export function resolveTrialEndpoint(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/chat/completions')) return url.toString();
    if (path.endsWith('/v1') || path.endsWith('/openai')) {
      url.pathname = `${path}/chat/completions`;
    } else if (path.endsWith('/v1beta')) {
      url.pathname = `${path}/openai/chat/completions`;
    } else {
      url.pathname = `${path}/v1/chat/completions`;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function parseTrialBody(input: unknown): { ok: true; value: TrialCompletionBody } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'INVALID_BODY' };
  const body = input as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return { ok: false, error: 'INVALID_MESSAGES' };
  }
  const messages: TrialMessage[] = [];
  for (const raw of body.messages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'INVALID_MESSAGE' };
    const message = raw as Record<string, unknown>;
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') return { ok: false, error: 'INVALID_ROLE' };
    if (typeof message.content !== 'string' || message.content.length > MAX_MESSAGE_CHARS) return { ok: false, error: 'INVALID_CONTENT' };
    messages.push({ role: message.role, content: message.content });
  }
  const numeric = (key: string, min: number, max: number) => {
    const value = body[key];
    return value == null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
  };
  if (!numeric('temperature', 0, 2) || !numeric('top_p', 0, 1) || !numeric('max_tokens', 1, 32_768)) {
    return { ok: false, error: 'INVALID_PARAMETERS' };
  }
  const responseFormat = body.response_format;
  if (responseFormat != null && (!responseFormat || typeof responseFormat !== 'object' ||
    (responseFormat as Record<string, unknown>).type !== 'json_object' && (responseFormat as Record<string, unknown>).type !== 'text')) {
    return { ok: false, error: 'INVALID_RESPONSE_FORMAT' };
  }
  return { ok: true, value: {
    messages,
    model: typeof body.model === 'string' ? body.model.slice(0, 200) : undefined,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    top_p: typeof body.top_p === 'number' ? body.top_p : undefined,
    max_tokens: typeof body.max_tokens === 'number' ? Math.floor(body.max_tokens) : undefined,
    response_format: responseFormat as TrialCompletionBody['response_format'],
  } };
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  for (const item of cookie.split(';')) {
    const index = item.indexOf('=');
    if (index < 0 || item.slice(0, index).trim() !== name) continue;
    const value = decodeURIComponent(item.slice(index + 1).trim());
    return value || null;
  }
  return null;
}

function trialSecret(env: Bindings): string {
  return env.TRIAL_ID_SECRET?.trim() || env.SESSION_SECRET;
}

async function signTrialToken(env: Bindings, opaqueId: string): Promise<string> {
  const signature = bytesToB64url(await hmacSha256(trialSecret(env), opaqueId));
  return `${opaqueId}.${signature}`;
}

async function verifyTrialToken(env: Bindings, token: string | null): Promise<string | null> {
  if (!token) return null;
  const match = TRIAL_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const expected = await signTrialToken(env, match[1]);
  return timingSafeEqualStr(expected, token) ? match[1] : null;
}

async function getClientIdentity(env: Bindings, request: Request, session: SessionData | null): Promise<{ key: string; token?: string; invalid?: boolean }> {
  if (session) return { key: `user:${session.userId}` };
  const supplied = request.headers.get('X-Trial-Client-Id')?.trim() || getCookie(request, TRIAL_COOKIE);
  if (supplied) {
    const opaqueId = await verifyTrialToken(env, supplied);
    if (!opaqueId) return { key: '', invalid: true };
    return { key: `anon:${opaqueId}`, token: supplied };
  }
  const opaqueId = crypto.randomUUID().replace(/-/g, '');
  return { key: `anon:${opaqueId}`, token: await signTrialToken(env, opaqueId) };
}

async function getIdentity(c: Context<any>): Promise<{ key: string; token?: string; invalid?: boolean }> {
  const session = await getSession(c.env, extractToken(c.req.raw));
  return getClientIdentity(c.env, c.req.raw, session);
}

async function readUsage(c: Context<any>, identity: string, limit: number): Promise<{ used: number; remaining: number }> {
  const now = Date.now();
  await cleanupExpiredReservations(c, identity, now);
  const row = await c.env.DB.prepare(`
    SELECT successful_count,
      (SELECT COUNT(*) FROM trial_reservations WHERE identity_key = ? AND expires_at > ?) AS reserved_count
    FROM trial_usage WHERE identity_key = ?
  `).bind(identity, now, identity).first() as { successful_count: number; reserved_count: number } | null;
  const used = Number(row?.successful_count || 0) + Number(row?.reserved_count || 0);
  return { used, remaining: Math.max(0, limit - used) };
}

async function cleanupExpiredReservations(c: Context<any>, identity: string, now: number): Promise<void> {
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM trial_reservations WHERE identity_key = ? AND expires_at <= ?').bind(identity, now),
    c.env.DB.prepare(`
      UPDATE trial_usage SET reserved_count = (
        SELECT COUNT(*) FROM trial_reservations WHERE identity_key = ? AND expires_at > ?
      ), updated_at = ? WHERE identity_key = ?
    `).bind(identity, now, now, identity),
  ]);
}

async function reserveUsage(c: Context<any>, identity: string, limit: number): Promise<string | null> {
  const now = Date.now();
  const expiresAt = now + TRIAL_RESERVATION_TTL_MS;
  const reservationId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO trial_usage (identity_key, successful_count, reserved_count, updated_at) VALUES (?, 0, 0, ?)
  `).bind(identity, now).run();
  await cleanupExpiredReservations(c, identity, now);

  // 每个请求拥有独立租约；容量判断和插入在同一 D1 batch 中完成。
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO trial_reservations (reservation_id, identity_key, expires_at)
      SELECT ?, ?, ? FROM trial_usage
      WHERE identity_key = ?
        AND successful_count + (
          SELECT COUNT(*) FROM trial_reservations
          WHERE identity_key = ? AND expires_at > ?
        ) < ?
    `).bind(reservationId, identity, expiresAt, identity, identity, now, limit),
    c.env.DB.prepare(`
      UPDATE trial_usage SET reserved_count = (
        SELECT COUNT(*) FROM trial_reservations WHERE identity_key = ? AND expires_at > ?
      ), updated_at = ? WHERE identity_key = ?
    `).bind(identity, now, now, identity),
  ]);
  return Number(results[0]?.meta?.changes || 0) > 0 ? reservationId : null;
}

async function settleUsage(c: Context<any>, identity: string, reservationId: string, succeeded: boolean): Promise<void> {
  const deleted = await c.env.DB.prepare(
    'DELETE FROM trial_reservations WHERE reservation_id = ? AND identity_key = ?',
  ).bind(reservationId, identity).run();
  if (Number(deleted.meta?.changes || 0) === 0) return;
  const now = Date.now();
  await c.env.DB.prepare(`
    UPDATE trial_usage SET
      reserved_count = (SELECT COUNT(*) FROM trial_reservations WHERE identity_key = ? AND expires_at > ?),
      successful_count = successful_count + ?, updated_at = ?
    WHERE identity_key = ?
  `).bind(identity, now, succeeded ? 1 : 0, now, identity).run();
}

function responseHeaders(identity: { token?: string }, remaining: number, request: Request): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Trial-Remaining': String(remaining) });
  if (identity.token) {
    const secure = new URL(request.url).protocol === 'https:';
    headers.set('Set-Cookie', `${TRIAL_COOKIE}=${identity.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`);
  }
  return headers;
}

export async function handleTrialStatus(c: Context<any>): Promise<Response> {
  const config = getTrialConfig(c.env);
  const identity = await getIdentity(c);
  if (identity.invalid) return c.json({ error: 'TRIAL_ID_INVALID', message: '体验身份已失效，请刷新页面后重试。' }, 401);
  const usage = config.configured ? await readUsage(c, identity.key, config.limit) : { used: 0, remaining: config.limit };
  const headers = responseHeaders(identity, usage.remaining, c.req.raw);
  return c.json({ ok: true, configured: config.configured, limit: config.limit, used: usage.used, remaining: usage.remaining, trialToken: identity.token }, 200, Object.fromEntries(headers.entries()));
}

export async function handleTrialCompletion(c: Context<any>): Promise<Response> {
  const config = getTrialConfig(c.env);
  const identity = await getIdentity(c);
  if (identity.invalid) return c.json({ error: 'TRIAL_ID_INVALID', message: '体验身份已失效，请刷新页面后重试。' }, 401);
  if (!config.configured) return c.json({ error: 'TRIAL_UNAVAILABLE', message: '免费体验暂未配置，请使用自己的 API。' }, 503);
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '请求内容过大。' }, 413);
  let raw: string;
  try { raw = await c.req.text(); } catch { return c.json({ error: 'INVALID_BODY', message: '请求体无效。' }, 400); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '请求内容过大。' }, 413);
  let parsedInput: unknown;
  try { parsedInput = JSON.parse(raw); } catch { return c.json({ error: 'INVALID_JSON', message: '请求必须是合法 JSON。' }, 400); }
  const parsed = parseTrialBody(parsedInput);
  if (!parsed.ok) return c.json({ error: parsed.error, message: '体验请求格式无效。' }, 400);
  if (c.req.header('X-Trial-Purpose') !== 'conversation') {
    return c.json({ error: 'INVALID_TRIAL_PURPOSE', message: '体验请求用途无效。' }, 400);
  }
  const reservationId = await reserveUsage(c, identity.key, config.limit);
  const usage = await readUsage(c, identity.key, config.limit);
  const headers = responseHeaders(identity, usage.remaining, c.req.raw);
  if (!reservationId) return c.json({ error: 'TRIAL_LIMIT_REACHED', message: '免费体验次数已用完，请配置自己的 API。', limit: config.limit, used: usage.used, remaining: 0 }, 429, Object.fromEntries(headers.entries()));
  const endpoint = resolveTrialEndpoint(config.baseUrl!);
  if (!endpoint) {
    await settleUsage(c, identity.key, reservationId, false);
    return c.json({ error: 'TRIAL_UNAVAILABLE', message: '免费体验服务配置无效，请配置自己的 API。' }, 503, Object.fromEntries(responseHeaders(identity, (await readUsage(c, identity.key, config.limit)).remaining, c.req.raw).entries()));
  }
  const upstreamBody = { ...parsed.value, model: config.model, stream: false };
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(upstreamBody),
    });
    if (!upstream.ok) {
      console.error('[trial] upstream status', upstream.status);
      await settleUsage(c, identity.key, reservationId, false);
      const released = await readUsage(c, identity.key, config.limit);
      return c.json({ error: upstream.status === 429 ? 'TRIAL_UPSTREAM_RATE_LIMITED' : 'TRIAL_UPSTREAM_ERROR', message: '免费体验服务暂时不可用，请稍后重试或配置自己的 API。', remaining: released.remaining }, upstream.status === 429 ? 429 : 502, Object.fromEntries(responseHeaders(identity, released.remaining, c.req.raw).entries()));
    }
    const json = await upstream.json<unknown>();
    await settleUsage(c, identity.key, reservationId, true);
    const completed = await readUsage(c, identity.key, config.limit);
    return new Response(JSON.stringify(json), { status: 200, headers: new Headers({ ...Object.fromEntries(responseHeaders(identity, completed.remaining, c.req.raw).entries()), 'Content-Type': 'application/json' }) });
  } catch (error) {
    console.error('[trial] upstream request failed', error instanceof Error ? error.message : String(error));
    await settleUsage(c, identity.key, reservationId, false);
    const released = await readUsage(c, identity.key, config.limit);
    return c.json({ error: 'TRIAL_UPSTREAM_ERROR', message: '免费体验服务暂时不可用，请稍后重试或配置自己的 API。', remaining: released.remaining }, 502, Object.fromEntries(responseHeaders(identity, released.remaining, c.req.raw).entries()));
  }
}
