/**
 * workshop.ts — 创意工坊：列表 / 详情 / 上传 / 下载 / 修改 / 删除。
 *
 * 规则（spec.md §2 / §4 / §5）：
 *  - 列表公开、可按 type/tag 过滤、分页。
 *  - 上传需登录；仅创建者可改/删自己的条目（403）。
 *  - 所有数据存 JSON（砍掉图片），不需要 R2。
 *  - type 支持：world_package / character_preset / npc_template / history_preset
 */
import type { Bindings, WorkshopItemRow, WorkshopItemType, WorkshopItemPublic } from './types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_TITLE = 200;
const MAX_TAG_LEN = 32;
const MAX_TAGS = 16;
const MAX_DATA_SIZE = 1_048_576; // 1MB
const ACCEPTED_TYPES: WorkshopItemType[] = ['world_package', 'character_preset', 'npc_template', 'history_preset'];

export interface WorkshopInput {
  title?: string;
  description?: string | null;
  type?: WorkshopItemType;
  tags?: string[];
  data?: Record<string, unknown>;  // 完整数据 JSON
}

export interface ListParams {
  type?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  items: WorkshopItemPublic[];
  page: number;
  total: number;
  pageSize: number;
}

export interface WorkshopResult {
  status: number;
  body: Record<string, unknown>;
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = String(t).trim().slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** 给一行补充 tags，转为对外结构。 */
function toPublic(row: WorkshopItemRow): WorkshopItemPublic {
  let tags: string[] = [];
  try {
    if (row.tags) tags = JSON.parse(row.tags);
  } catch { /* ignore */ }
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: row.type,
    title: row.title,
    description: row.description,
    tags,
    downloadCount: row.download_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列表（公开）。 */
export async function listItems(env: Bindings, params: ListParams): Promise<ListResult> {
  const pageSize = Math.min(Math.max(params.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(params.page || 1, 1);
  const offset = (page - 1) * pageSize;

  const where: string[] = ['status = ?'];
  const binds: unknown[] = ['published'];
  if (params.type) {
    where.push('type = ?');
    binds.push(params.type);
  }
  if (params.tag) {
    where.push("tags LIKE ?");
    binds.push(`%"${params.tag}"%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM workshop_items ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();
  const total = totalRow?.c ?? 0;

  const rows = await env.DB.prepare(
    `SELECT id, owner_id, type, title, description, tags, download_count, created_at, updated_at
     FROM workshop_items ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, pageSize, offset)
    .all<WorkshopItemRow>();

  const items = (rows.results || []).map(toPublic);
  return { items, page, total, pageSize };
}

/** 详情（公开）。不存在返回 null。 */
export async function getItem(env: Bindings, itemId: string): Promise<WorkshopItemRow | null> {
  const row = await env.DB.prepare('SELECT * FROM workshop_items WHERE id = ?')
    .bind(itemId)
    .first<WorkshopItemRow>();
  return row || null;
}

/** 上传新条目（需登录）。 */
export async function createItem(
  env: Bindings,
  userId: string,
  input: WorkshopInput,
): Promise<WorkshopResult> {
  if (!input.type || !ACCEPTED_TYPES.includes(input.type)) {
    return { status: 400, body: { error: 'INVALID_TYPE', message: 'type 必须是 world_package / character_preset / npc_template / history_preset' } };
  }
  const title = (input.title || '').trim();
  if (!title) {
    return { status: 400, body: { error: 'MISSING_TITLE', message: '标题不能为空' } };
  }

  if (!input.data || typeof input.data !== 'object') {
    return { status: 400, body: { error: 'MISSING_DATA', message: 'data 不能为空' } };
  }

  const dataJson = JSON.stringify(input.data);
  if (dataJson.length > MAX_DATA_SIZE) {
    return { status: 413, body: { error: 'DATA_TOO_LARGE', message: '数据大小超过 1MB 限制' } };
  }

  const id = crypto.randomUUID();
  const tags = normalizeTags(input.tags);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO workshop_items
      (id, owner_id, type, title, description, tags, data_json, status, download_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      input.type,
      title.slice(0, MAX_TITLE),
      input.description ?? null,
      JSON.stringify(tags),
      dataJson,
      'published',
      0,
      now,
      now,
    )
    .run();

  return { status: 201, body: { id } };
}

/** 修改条目（仅创建者）。 */
export async function updateItem(
  env: Bindings,
  userId: string,
  itemId: string,
  input: WorkshopInput,
): Promise<WorkshopResult> {
  const row = await env.DB.prepare('SELECT * FROM workshop_items WHERE id = ?')
    .bind(itemId)
    .first<WorkshopItemRow>();
  if (!row) return { status: 404, body: { error: 'NOT_FOUND', message: '条目不存在' } };
  if (row.owner_id !== userId) {
    return { status: 403, body: { error: 'FORBIDDEN', message: '仅创建者可修改' } };
  }

  if (input.type && !ACCEPTED_TYPES.includes(input.type)) {
    return { status: 400, body: { error: 'INVALID_TYPE', message: 'type 不合法' } };
  }

  const title = input.title !== undefined ? input.title.trim().slice(0, MAX_TITLE) : row.title;
  const description = input.description !== undefined ? input.description : row.description;
  const tags = input.tags !== undefined ? normalizeTags(input.tags) : undefined;

  let dataJson = row.data_json;
  if (input.data) {
    dataJson = JSON.stringify(input.data);
    if (dataJson.length > MAX_DATA_SIZE) {
      return { status: 413, body: { error: 'DATA_TOO_LARGE', message: '数据大小超过 1MB 限制' } };
    }
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE workshop_items
     SET title = ?, description = ?, tags = ?, data_json = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(title, description, tags !== undefined ? JSON.stringify(tags) : row.tags, dataJson, now, itemId)
    .run();

  return { status: 200, body: { ok: true } };
}

/** 删除条目（仅创建者）。 */
export async function deleteItem(
  env: Bindings,
  userId: string,
  itemId: string,
): Promise<WorkshopResult> {
  const row = await env.DB.prepare('SELECT * FROM workshop_items WHERE id = ?')
    .bind(itemId)
    .first<WorkshopItemRow>();
  if (!row) return { status: 404, body: { error: 'NOT_FOUND', message: '条目不存在' } };
  if (row.owner_id !== userId) {
    return { status: 403, body: { error: 'FORBIDDEN', message: '仅创建者可删除' } };
  }

  await env.DB.prepare('DELETE FROM workshop_items WHERE id = ?').bind(itemId).run();
  return { status: 200, body: { ok: true } };
}

/** 增加下载计数。 */
export async function incrementDownloadCount(env: Bindings, itemId: string): Promise<void> {
  await env.DB.prepare('UPDATE workshop_items SET download_count = download_count + 1 WHERE id = ?')
    .bind(itemId)
    .run();
}
