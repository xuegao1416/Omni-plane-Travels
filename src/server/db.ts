/**
 * db.ts — D1 客户端封装与用户查找/创建辅助。
 */
import type { Bindings, UserRow } from './types';

export function getDb(env: Bindings) {
  return env.DB;
}

/** 按内部用户 id 查询用户。 */
export async function getUserById(env: Bindings, id: string): Promise<UserRow | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return row ?? null;
}

/** 按邮箱查询用户。 */
export async function getUserByEmail(env: Bindings, email: string): Promise<UserRow | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  return row ?? null;
}

/** 按邮箱查找用户，不存在则创建。返回内部用户行。 */
export async function upsertEmailUser(
  env: Bindings,
  email: string,
  passwordHash?: string,
): Promise<UserRow> {
  const existing = await getUserByEmail(env, email);

  if (existing) {
    // 如果传了密码哈希且用户还没有密码，更新密码
    if (passwordHash && !existing.password_hash) {
      await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(passwordHash, existing.id)
        .run();
      return { ...existing, password_hash: passwordHash };
    }
    return existing;
  }

  const id = crypto.randomUUID();
  const username = email.split('@')[0].slice(0, 64);
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, email, username, passwordHash || null, Date.now())
    .run();

  return {
    id,
    email,
    username,
    password_hash: passwordHash || null,
    created_at: Date.now(),
  };
}

/** 更新用户密码。 */
export async function updateUserPassword(env: Bindings, email: string, passwordHash: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
    .bind(passwordHash, email)
    .run();
}
