/**
 * saves.ts — 云存档槽位 CRUD。
 *
 * 规则（spec.md §4 / §5 / §9）：
 *  - 每注册用户 ≤ 2 槽位（slot_index ∈ {1, 2}），超过返回 403。
 *  - 单槽软上限 1MB，超过返回 413。
 *  - 乐观并发：客户端带 x-save-version 上传；与现有 version 不符返回 409 + currentVersion。
 *  - 存档 JSON 直接存 D1（≤1MB），不需要 R2。
 *
 * 返回值为 { status, body }，由路由层转换为 Hono 响应，便于单元测试。
 */
import type { Bindings, SaveSlotRow } from './types';

export const MAX_SLOT_BYTES = 1_048_576; // 1MB
export const MAX_SLOTS = 2;

export interface SlotSummary {
  slotIndex: number;
  version: number;
  size: number;
  updatedAt: number;
}

export interface SaveResult {
  status: number;
  body: Record<string, unknown>;
}

/** 列出当前用户的全部槽位摘要。 */
export async function listSlots(env: Bindings, userId: string): Promise<SlotSummary[]> {
  const rows = await env.DB.prepare(
    'SELECT slot_index, version, payload_size, updated_at FROM save_slots WHERE user_id = ? ORDER BY slot_index',
  )
    .bind(userId)
    .all<SaveSlotRow>();
  return (rows.results || []).map((r) => ({
    slotIndex: r.slot_index,
    version: r.version,
    size: r.payload_size,
    updatedAt: r.updated_at,
  }));
}

/** 读取槽位内容（用于下载）。不存在返回 null。 */
export async function getSlotContent(
  env: Bindings,
  userId: string,
  slotId: string,
): Promise<{ payload_json: string; version: number } | null> {
  const slotIndex = Number(slotId);
  if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > MAX_SLOTS) return null;
  const row = await env.DB.prepare(
    'SELECT payload_json, version FROM save_slots WHERE user_id = ? AND slot_index = ?',
  )
    .bind(userId, slotIndex)
    .first<SaveSlotRow>();
  if (!row) return null;
  return { payload_json: row.payload_json, version: row.version };
}

/**
 * 上传/覆盖槽位。
 * @param payloadJson 存档 JSON 字符串（应为合法 JSON）
 * @param versionHeader 客户端 x-save-version 头（期望的当前版本号，新建槽应为 0 或省略）
 */
export async function putSlot(
  env: Bindings,
  userId: string,
  slotId: string,
  payloadJson: string,
  versionHeader: string | null,
): Promise<SaveResult> {
  const slotIndex = Number(slotId);
  if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > MAX_SLOTS) {
    return { status: 403, body: { error: 'SLOT_LIMIT', message: `每账户最多 ${MAX_SLOTS} 个存档槽位` } };
  }

  const payloadSize = new TextEncoder().encode(payloadJson).length;
  if (payloadSize > MAX_SLOT_BYTES) {
    return { status: 413, body: { error: 'PAYLOAD_TOO_LARGE', message: '单槽存档上限 1MB' } };
  }

  // 计算校验和
  const checksum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadJson));
  const checksumHex = Array.from(new Uint8Array(checksum)).map(b => b.toString(16).padStart(2, '0')).join('');

  const existing = await env.DB.prepare(
    'SELECT id, version FROM save_slots WHERE user_id = ? AND slot_index = ?',
  )
    .bind(userId, slotIndex)
    .first<SaveSlotRow>();

  if (existing) {
    const clientVersion = versionHeader != null ? Number(versionHeader) : -1;
    if (clientVersion !== existing.version) {
      return { status: 409, body: { currentVersion: existing.version } };
    }
    const newVersion = existing.version + 1;
    const generation = crypto.randomUUID();
    await env.DB.prepare(
      'UPDATE save_slots SET version = ?, generation = ?, payload_json = ?, payload_size = ?, checksum = ?, updated_at = ? WHERE id = ?',
    )
      .bind(newVersion, generation, payloadJson, payloadSize, checksumHex, Date.now(), existing.id)
      .run();
    return { status: 200, body: { version: newVersion, generation } };
  }

  // 新建槽：防御性检查总槽数（固定 2 索引时仅当 1、2 都占满才会触发）
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM save_slots WHERE user_id = ?')
    .bind(userId)
    .first<{ c: number }>();
  if ((countRow?.c ?? 0) >= MAX_SLOTS) {
    return { status: 403, body: { error: 'SLOT_LIMIT', message: `每账户最多 ${MAX_SLOTS} 个存档槽位` } };
  }

  const clientVersion = versionHeader != null ? Number(versionHeader) : 0;
  if (clientVersion !== 0) {
    return { status: 409, body: { currentVersion: 0 } };
  }

  const id = crypto.randomUUID();
  const generation = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO save_slots (id, user_id, slot_index, version, generation, payload_json, payload_size, checksum, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, slotIndex, 1, generation, payloadJson, payloadSize, checksumHex, Date.now())
    .run();
  return { status: 200, body: { version: 1, generation } };
}

/** 删除槽位。不存在返回 404。 */
export async function deleteSlot(
  env: Bindings,
  userId: string,
  slotId: string,
): Promise<SaveResult> {
  const slotIndex = Number(slotId);
  if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > MAX_SLOTS) {
    return { status: 404, body: { error: 'NOT_FOUND', message: '槽位不存在' } };
  }
  const row = await env.DB.prepare(
    'SELECT id FROM save_slots WHERE user_id = ? AND slot_index = ?',
  )
    .bind(userId, slotIndex)
    .first<SaveSlotRow>();
  if (!row) return { status: 404, body: { error: 'NOT_FOUND', message: '槽位不存在' } };

  await env.DB.prepare('DELETE FROM save_slots WHERE id = ?').bind(row.id).run();
  return { status: 200, body: { ok: true } };
}
