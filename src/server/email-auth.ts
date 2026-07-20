/**
 * email-auth.ts — 邮箱登录（验证码 + 密码双模式）。
 *
 * 流程：
 *   注册：POST /api/auth/send-code { email } → POST /api/auth/register { email, code, password }
 *   登录：POST /api/auth/login { email, password }
 *   忘记密码：POST /api/auth/send-code { email } → POST /api/auth/reset-password { email, code, password }
 */
import type { Bindings } from './types';
import { createSession, buildSessionCookie, SESSION_TTL_SECONDS } from './session';
import { upsertEmailUser, getUserByEmail, updateUserPassword } from './db';

const CODE_TTL_SECONDS = 300;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 60;

function generateCode(): string {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => (b % 10).toString()).join('');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** PBKDF2 哈希密码 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  const hashArray = new Uint8Array(bits);
  const saltHex = Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hashArray, b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

/** 校验密码 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  const computed = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  return computed === hashHex;
}

/** 发送验证码邮件（通用） */
async function sendVerificationEmail(env: Bindings, email: string, code: string): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Omni Travels', email: env.EMAIL_FROM || 'wrongpai1416@gmail.com' },
      to: [{ email }],
      subject: 'Omni Travels 验证码',
      htmlContent: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;">
        <h2 style="color:#d4af37;">Omni Travels</h2>
        <p>你的验证码是：</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#333;padding:16px;background:#f5f5f5;border-radius:8px;text-align:center;">${code}</div>
        <p style="color:#666;font-size:14px;">验证码 5 分钟内有效。如果不是你本人操作，请忽略此邮件。</p>
      </div>`,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[email-auth] Brevo API 错误:', res.status, errText);
    throw new Error('发送邮件失败');
  }
}

/** POST /api/auth/send-code — 发送验证码（注册 / 忘记密码）。 */
export async function handleSendCode(req: Request, env: Bindings): Promise<Response> {
  let body: { email?: string };
  try { body = await req.json(); } catch {
    return Response.json({ error: 'INVALID_JSON', message: '请求格式错误' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return Response.json({ error: 'INVALID_EMAIL', message: '请输入有效的邮箱地址' }, { status: 400 });
  }

  // 限流
  const existing = await env.DB.prepare(
    'SELECT created_at FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(email).first<{ created_at: number }>();

  if (existing && Date.now() - existing.created_at < RATE_LIMIT_WINDOW * 1000) {
    return Response.json({ error: 'RATE_LIMITED', message: '请稍后再试' }, { status: 429 });
  }

  await env.DB.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run();

  const code = generateCode();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO email_codes (id, email, code, attempts, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)',
  ).bind(id, email, code, Date.now(), Date.now() + CODE_TTL_SECONDS * 1000).run();

  try {
    await sendVerificationEmail(env, email, code);
  } catch (err) {
    console.error('[email-auth] 发送邮件异常:', err);
    return Response.json({ error: 'EMAIL_SEND_FAILED', message: '发送邮件失败，请稍后重试' }, { status: 502 });
  }

  return Response.json({ ok: true, message: '验证码已发送到你的邮箱' });
}

/** 校验验证码（内部通用）。 */
async function verifyCode(env: Bindings, email: string, code: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  const record = await env.DB.prepare(
    'SELECT * FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(email).first<{ id: string; code: string; attempts: number; expires_at: number }>();

  if (!record) return { ok: false, error: '请先获取验证码', status: 400 };
  if (Date.now() > record.expires_at) {
    await env.DB.prepare('DELETE FROM email_codes WHERE id = ?').bind(record.id).run();
    return { ok: false, error: '验证码已过期，请重新获取', status: 400 };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('DELETE FROM email_codes WHERE id = ?').bind(record.id).run();
    return { ok: false, error: '验证码尝试次数过多，请重新获取', status: 429 };
  }
  if (record.code !== code) {
    await env.DB.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').bind(record.id).run();
    return { ok: false, error: '验证码错误', status: 400 };
  }

  await env.DB.prepare('DELETE FROM email_codes WHERE id = ?').bind(record.id).run();
  return { ok: true };
}

/** 签发会话 + 返回响应。 */
async function loginResponse(env: Bindings, req: Request, userId: string, username: string, email: string): Promise<Response> {
  const userAgent = req.headers.get('User-Agent') || '';
  const clientType = userAgent.includes('Tauri') ? 'desktop' : 'web';
  const token = await createSession(env, userId, clientType);

  if (clientType === 'desktop') {
    return Response.json({ ok: true, token, user: { id: userId, username, email } });
  }

  const secure = new URL(req.url).protocol === 'https:';
  const cookie = buildSessionCookie(token, secure, SESSION_TTL_SECONDS);
  return new Response(
    JSON.stringify({ ok: true, user: { id: userId, username, email } }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie } },
  );
}

/** POST /api/auth/register — 验证码 + 设置密码 → 注册。 */
export async function handleRegister(req: Request, env: Bindings): Promise<Response> {
  let body: { email?: string; code?: string; password?: string };
  try { body = await req.json(); } catch {
    return Response.json({ error: 'INVALID_JSON', message: '请求格式错误' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim();
  const password = body.password || '';

  if (!email || !isValidEmail(email)) {
    return Response.json({ error: 'INVALID_EMAIL', message: '请输入有效的邮箱地址' }, { status: 400 });
  }
  if (!code || code.length !== 6) {
    return Response.json({ error: 'INVALID_CODE', message: '请输入 6 位验证码' }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' }, { status: 400 });
  }

  // 检查是否已注册
  const existing = await getUserByEmail(env, email);
  if (existing?.password_hash) {
    return Response.json({ error: 'ALREADY_REGISTERED', message: '该邮箱已注册，请直接登录' }, { status: 409 });
  }

  const vr = await verifyCode(env, email, code);
  if (!vr.ok) return Response.json({ error: 'VERIFY_FAILED', message: vr.error }, { status: vr.status });

  const passwordHash = await hashPassword(password);
  const user = await upsertEmailUser(env, email, passwordHash);
  return loginResponse(env, req, user.id, user.username, email);
}

/** POST /api/auth/login — 邮箱 + 密码登录。 */
export async function handleLogin(req: Request, env: Bindings): Promise<Response> {
  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch {
    return Response.json({ error: 'INVALID_JSON', message: '请求格式错误' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !isValidEmail(email)) {
    return Response.json({ error: 'INVALID_EMAIL', message: '请输入有效的邮箱地址' }, { status: 400 });
  }
  if (!password) {
    return Response.json({ error: 'NO_PASSWORD', message: '请输入密码' }, { status: 400 });
  }

  const user = await getUserByEmail(env, email);
  if (!user || !user.password_hash) {
    return Response.json({ error: 'NOT_REGISTERED', message: '该邮箱未注册，请先注册' }, { status: 404 });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return Response.json({ error: 'WRONG_PASSWORD', message: '密码错误' }, { status: 401 });
  }

  return loginResponse(env, req, user.id, user.username, email);
}

/** POST /api/auth/reset-password — 验证码 + 新密码。 */
export async function handleResetPassword(req: Request, env: Bindings): Promise<Response> {
  let body: { email?: string; code?: string; password?: string };
  try { body = await req.json(); } catch {
    return Response.json({ error: 'INVALID_JSON', message: '请求格式错误' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim();
  const password = body.password || '';

  if (!email || !isValidEmail(email)) {
    return Response.json({ error: 'INVALID_EMAIL', message: '请输入有效的邮箱地址' }, { status: 400 });
  }
  if (!code || code.length !== 6) {
    return Response.json({ error: 'INVALID_CODE', message: '请输入 6 位验证码' }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' }, { status: 400 });
  }

  const user = await getUserByEmail(env, email);
  if (!user) {
    return Response.json({ error: 'NOT_REGISTERED', message: '该邮箱未注册' }, { status: 404 });
  }

  const vr = await verifyCode(env, email, code);
  if (!vr.ok) return Response.json({ error: 'VERIFY_FAILED', message: vr.error }, { status: vr.status });

  const passwordHash = await hashPassword(password);
  await updateUserPassword(env, email, passwordHash);
  return loginResponse(env, req, user.id, user.username, email);
}
