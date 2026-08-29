/**
 * workshop.ts — 创意工坊：列表 / 详情 / 上传 / 下载 / 修改 / 删除。
 *
 * 规则（spec.md §2 / §4 / §5）：
 *  - 列表公开、可按 type/tag 过滤、分页。
 *  - 上传需登录；仅创建者可改/删自己的条目（403）。
 *  - 所有数据存 JSON（砍掉图片），不需要 R2。
 *  - 公开类型与本地资产目录共用同一份定义；人物预设、人生经历只保存在本地。
 */
import type { Bindings, WorkshopDependency, WorkshopItemRow, WorkshopItemType, WorkshopItemPublic } from './types';
import { validateCustomGameplayModule } from '../custom-modules/validator';
import { isLocalOnlyAssetType, isPublicWorkshopType } from '../workshopCatalog';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_TITLE = 200;
const MAX_TAG_LEN = 32;
const MAX_TAGS = 16;
const MAX_DATA_SIZE = 1_048_576; // 1MB
const LEGACY_DB_TYPES = new Set<WorkshopItemType>(['world_package', 'character_preset', 'npc_template', 'history_preset']);

export interface WorkshopInput {
  title?: string;
  description?: string | null;
  type?: WorkshopItemType;
  tags?: string[];
  data?: Record<string, unknown>;  // 完整数据 JSON
  contentType?: WorkshopItemType;
  version?: string;
  category?: string | null;
  dependencies?: WorkshopDependency[];
  minAppVersion?: string | null;
  compatibility?: Record<string, unknown>;
  featured?: boolean;
  screenshots?: string[];
  recommendations?: WorkshopDependency[];
}

export interface ListParams {
  type?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
  sort?: 'latest' | 'popular' | 'featured';
  category?: string;
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

function privateContentTypeError(type: string) {
  return {
    error: 'PRIVATE_CONTENT_TYPE',
    message: type === 'history_preset'
      ? '人生经历仅保存在本地，不能发布到创意工坊'
      : '主角人物预设仅保存在本地；请匿名化后发布为 NPC 模板',
  } as const;
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

function normalizeDependencies(dependencies?: WorkshopDependency[]): WorkshopDependency[] {
  if (!Array.isArray(dependencies)) return [];
  const seen = new Set<string>();
  return dependencies.slice(0, 32).flatMap((item) => {
    if (!item || typeof item.id !== 'string') return [];
    const id = item.id.trim().toLowerCase().slice(0, 80);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, ...(item.type ? { type: item.type } : {}), ...(item.version ? { version: String(item.version).trim().slice(0, 32) } : {}), ...(item.optional ? { optional: true } : {}), ...(item.reason ? { reason: String(item.reason).trim().slice(0, 160) } : {}) }];
  });
}

function normalizeVersion(version?: string | null): string {
  const value = String(version || '1.0.0').trim();
  return /^\d+\.\d+\.\d+$/.test(value) ? value : '1.0.0';
}

/** World authors may embed explicit optional content links in the package JSON. */
function extractRecommendations(data?: Record<string, unknown>): WorkshopDependency[] {
  if (!data || !Array.isArray(data.recommendations) && !Array.isArray(data.recommendedItems)) return [];
  const values = Array.isArray(data.recommendations) ? data.recommendations : data.recommendedItems;
  return normalizeDependencies(values as WorkshopDependency[]);
}

export type WorkshopContentValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string; path?: string };

function contentError(code: string, message: string, path?: string): WorkshopContentValidationResult {
  return { ok: false, code, message: path ? `${message}（位置：${path}）` : message, path };
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireString(source: Record<string, unknown>, key: string, label: string): WorkshopContentValidationResult | null {
  if (typeof source[key] !== 'string' || !String(source[key]).trim()) {
    return contentError('MISSING_FIELD', `${label}缺少有效的 ${key}`, key);
  }
  return null;
}

function validateCommonNamedAsset(data: unknown, label: string): WorkshopContentValidationResult {
  if (!recordValue(data)) return contentError('INVALID_CONTENT', `${label}必须是 JSON 对象`);
  return requireString(data, 'id', label) ?? requireString(data, 'name', label) ?? { ok: true };
}

function validateWorkflowShape(data: unknown): WorkshopContentValidationResult {
  if (!recordValue(data)) return contentError('INVALID_WORKFLOW', '工作流必须是 JSON 对象');
  for (const key of ['id', 'name']) {
    const issue = requireString(data, key, '工作流');
    if (issue) return issue;
  }
  if (typeof data.version !== 'number' || !Number.isFinite(data.version)) return contentError('INVALID_WORKFLOW', '工作流 version 必须是数字', 'version');
  if (!Array.isArray(data.nodes) || !Array.isArray(data.connections)) {
    return contentError('INVALID_WORKFLOW', '工作流必须包含 nodes 和 connections 数组');
  }
  for (let index = 0; index < data.nodes.length; index += 1) {
    const node = data.nodes[index];
    if (!recordValue(node) || typeof node.id !== 'string' || typeof node.typeId !== 'string'
      || !recordValue(node.position) || !Number.isFinite(Number(node.position.x)) || !Number.isFinite(Number(node.position.y))) {
      return contentError('INVALID_WORKFLOW_NODE', '工作流节点必须包含 id、typeId 和数值 position', `nodes[${index}]`);
    }
  }
  for (let index = 0; index < data.connections.length; index += 1) {
    const connection = data.connections[index];
    if (!recordValue(connection) || !['id', 'sourceNodeId', 'sourceSocketKey', 'targetNodeId', 'targetSocketKey'].every(key => typeof connection[key] === 'string')) {
      return contentError('INVALID_WORKFLOW_CONNECTION', '工作流连接字段不完整', `connections[${index}]`);
    }
  }
  return { ok: true };
}

function validateEventPackShape(data: unknown, label: string): WorkshopContentValidationResult {
  if (!recordValue(data)) return contentError('INVALID_EVENT_PACK', `${label}必须是 JSON 对象`);
  const manifest = recordValue(data.manifest) ? data.manifest : data;
  for (const key of ['id', 'name', 'version']) {
    const issue = requireString(manifest, key, `${label} manifest`);
    if (issue) return issue;
  }
  if (manifest.type !== undefined && !['rule', 'card', 'worldbook', 'bundle'].includes(String(manifest.type))) {
    return contentError('INVALID_EVENT_PACK', `${label} manifest.type 不受支持`, 'manifest.type');
  }
  if (data.files !== undefined) {
    if (!recordValue(data.files) || !Object.values(data.files).every(value => typeof value === 'string')) {
      return contentError('INVALID_EVENT_FILES', `${label} files 必须是“路径 -> 文本”的对象`, 'files');
    }
    if (!(data.files as Record<string, unknown>)['manifest.json']) {
      return contentError('INVALID_EVENT_FILES', `${label} files 必须包含 manifest.json`, 'files.manifest.json');
    }
  }
  const hasRuntimeShape = data.files !== undefined || Array.isArray(data.rules) || Array.isArray(data.periodicRules)
    || Array.isArray(data.events) || recordValue(data.workflow);
  if (!hasRuntimeShape) return contentError('INVALID_EVENT_PACK', `${label}缺少 files、rules、events 或 workflow 内容`);
  return { ok: true };
}

/** Server-authoritative structural validation for every public workshop type. */
export function validateWorkshopContent(type: WorkshopItemType, data: unknown): WorkshopContentValidationResult {
  if (isLocalOnlyAssetType(type)) return contentError('PRIVATE_CONTENT_TYPE', privateContentTypeError(type).message);
  if (!recordValue(data)) return contentError('INVALID_CONTENT', '发布内容必须是 JSON 对象');

  switch (type) {
    case 'world_package': {
      for (const key of ['id', 'name', 'description']) {
        const issue = requireString(data, key, '世界包');
        if (issue) return issue;
      }
      for (const key of ['modules', 'worldBookEntries', 'eventPacks']) {
        if (data[key] !== undefined && !Array.isArray(data[key])) return contentError('INVALID_WORLD_PACKAGE', `${key} 必须是数组`, key);
      }
      return { ok: true };
    }
    case 'npc_template': {
      const source = recordValue(data.npc) ? data.npc : data;
      const issue = requireString(data, 'id', 'NPC 模板') ?? requireString(data, 'name', 'NPC 模板');
      if (issue) return issue;
      if (!recordValue(source)) return contentError('INVALID_NPC_TEMPLATE', 'NPC 模板的 npc 必须是 JSON 对象', 'npc');
      const npcIssue = requireString(source, 'name', 'NPC 模板 npc');
      if (npcIssue) return npcIssue;
      return { ok: true };
    }
    case 'gameplay_module': {
      const result = validateCustomGameplayModule(data);
      const first = result.errors[0];
      return result.valid ? { ok: true } : contentError('INVALID_GAMEPLAY_MODULE', first?.message || '玩法模块结构无效', first?.path?.join('.'));
    }
    case 'event_pack': return validateEventPackShape(data, '事件包');
    case 'workflow_pack': {
      const workflow = recordValue(data.workflow) ? data.workflow : data;
      return validateWorkflowShape(workflow);
    }
    case 'adventure_pack': {
      const common = validateCommonNamedAsset(data, '冒险包');
      if (!common.ok) return common;
      const collection = ['scenes', 'chapters', 'steps'].find(key => data[key] !== undefined);
      if (collection && !Array.isArray(data[collection])) return contentError('INVALID_ADVENTURE_PACK', `${collection} 必须是数组`, collection);
      if (!collection) return contentError('INVALID_ADVENTURE_PACK', '冒险包必须包含 scenes、chapters 或 steps 数组');
      return { ok: true };
    }
    case 'visual_theme': {
      const common = validateCommonNamedAsset(data, '视觉主题');
      if (!common.ok) return common;
      const hasTokens = recordValue(data.tokens) || recordValue(data.variables) || recordValue(data.theme);
      const hasAssets = Array.isArray(data.assets);
      if (!hasTokens && !hasAssets) return contentError('INVALID_VISUAL_THEME', '视觉主题必须包含 tokens、theme、variables 或 assets');
      return { ok: true };
    }
    default: return contentError('INVALID_TYPE', 'type 不受支持');
  }
}

function normalizeScreenshots(screenshots?: string[]): string[] {
  if (!Array.isArray(screenshots)) return [];
  return [...new Set(screenshots.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const url = value.trim().slice(0, 1000);
    return /^https?:\/\//i.test(url) ? [url] : [];
  }))].slice(0, 6);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** 给一行补充 tags，转为对外结构。 */
export function toPublic(row: WorkshopItemRow): WorkshopItemPublic {
  let tags: string[] = [];
  try {
    if (row.tags) tags = JSON.parse(row.tags);
  } catch { /* ignore */ }
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: (row.content_type || row.type) as WorkshopItemType,
    contentType: row.content_type || row.type,
    version: normalizeVersion(row.version),
    title: row.title,
    description: row.description,
    tags,
    downloadCount: row.download_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: row.category || null,
    dependencies: parseJson<WorkshopDependency[]>(row.dependencies_json, []),
    recommendations: parseJson<WorkshopDependency[]>(row.recommendations_json, []),
    minAppVersion: row.min_app_version || null,
    compatibility: parseJson<Record<string, unknown>>(row.compatibility_json, {}),
    featured: row.featured === 1,
    screenshots: parseJson<string[]>(row.screenshots_json, []),
  };
}

/** 列表（公开）。 */
export async function listItems(env: Bindings, params: ListParams): Promise<ListResult> {
  const pageSize = Math.min(Math.max(params.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(params.page || 1, 1);
  const offset = (page - 1) * pageSize;

  // Private presets stay hidden even for legacy rows created before the guard.
  const where: string[] = ["status = ?", "COALESCE(content_type, type) NOT IN ('character_preset', 'history_preset')"];
  const binds: unknown[] = ['published'];
  if (params.type) {
    const type = params.type as WorkshopItemType;
    if (!isPublicWorkshopType(type)) {
      where.push('1 = 0');
    } else if (LEGACY_DB_TYPES.has(type)) {
      where.push('(content_type = ? OR (content_type IS NULL AND type = ?))');
      binds.push(type, type);
    } else {
      where.push('content_type = ?');
      binds.push(type);
    }
  }
  if (params.tag) {
    where.push("tags LIKE ?");
    binds.push(`%"${params.tag}"%`);
  }
  if (params.category) {
    where.push('category = ?');
    binds.push(params.category);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const sortSql = params.sort === 'popular'
    ? 'download_count DESC, created_at DESC'
    : params.sort === 'featured'
      ? 'featured DESC, download_count DESC, created_at DESC'
      : 'created_at DESC';

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM workshop_items ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();
  const total = totalRow?.c ?? 0;

  const rows = await env.DB.prepare(
    `SELECT id, owner_id, type, content_type, version, title, description, tags, download_count, created_at, updated_at,
            category, dependencies_json, recommendations_json, min_app_version, compatibility_json, featured, screenshots_json
     FROM workshop_items ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`,
  )
    .bind(...binds, pageSize, offset)
    .all<WorkshopItemRow>();

  const items = (rows.results || []).map(toPublic);
  return { items, page, total, pageSize };
}

/** 详情（公开）。不存在返回 null。 */
export async function getItem(env: Bindings, itemId: string): Promise<WorkshopItemRow | null> {
  const row = await env.DB.prepare("SELECT * FROM workshop_items WHERE id = ? AND status = 'published' AND COALESCE(content_type, type) NOT IN ('character_preset', 'history_preset')")
    .bind(itemId)
    .first<WorkshopItemRow>();
  return row || null;
}

/** Owner-only lookup for mutation endpoints; never use this for public reads. */
async function getItemForOwner(env: Bindings, itemId: string): Promise<WorkshopItemRow | null> {
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
  const requestedType = input.contentType || input.type;
  if (requestedType && isLocalOnlyAssetType(requestedType)) {
    return { status: 400, body: privateContentTypeError(requestedType) };
  }
  if (!requestedType || !isPublicWorkshopType(requestedType)) {
    return { status: 400, body: { error: 'INVALID_TYPE', message: 'type 不受支持' } };
  }
  const title = (input.title || '').trim();
  if (!title) {
    return { status: 400, body: { error: 'MISSING_TITLE', message: '标题不能为空' } };
  }

  if (!input.data || typeof input.data !== 'object') {
    return { status: 400, body: { error: 'MISSING_DATA', message: 'data 不能为空' } };
  }

  const contentValidation = validateWorkshopContent(requestedType, input.data);
  if (!contentValidation.ok) {
    return { status: 400, body: { error: contentValidation.code, message: contentValidation.message, ...(contentValidation.path ? { path: contentValidation.path } : {}) } };
  }

  const dataJson = JSON.stringify(input.data);
  if (dataJson.length > MAX_DATA_SIZE) {
    return { status: 413, body: { error: 'DATA_TOO_LARGE', message: '数据大小超过 1MB 限制' } };
  }

  const id = crypto.randomUUID();
  const tags = normalizeTags(input.tags);
  const dependencies = normalizeDependencies(input.dependencies);
  const recommendations = normalizeDependencies(input.recommendations ?? extractRecommendations(input.data));
  const screenshots = normalizeScreenshots(input.screenshots);
  const version = normalizeVersion(input.version);
  // Keep the legacy CHECK constraint valid while exposing the richer content type.
  const dbType = LEGACY_DB_TYPES.has(requestedType) ? requestedType : 'world_package';
  const contentType = requestedType;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO workshop_items
      (id, owner_id, type, content_type, version, title, description, tags, data_json, status, download_count, created_at, updated_at, category, dependencies_json, recommendations_json, min_app_version, compatibility_json, featured, screenshots_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      dbType,
      contentType,
      version,
      title.slice(0, MAX_TITLE),
      input.description ?? null,
      JSON.stringify(tags),
      dataJson,
      'published',
      0,
      now,
      now,
      input.category?.trim().slice(0, 64) || null,
      JSON.stringify(dependencies),
      JSON.stringify(recommendations),
      input.minAppVersion?.trim().slice(0, 32) || null,
      JSON.stringify(input.compatibility || {}),
      // Featured is curated server-side; client input is deliberately ignored.
      0,
      JSON.stringify(screenshots),
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
  const row = await getItemForOwner(env, itemId);
  if (!row) return { status: 404, body: { error: 'NOT_FOUND', message: '条目不存在' } };
  if (row.owner_id !== userId) {
    return { status: 403, body: { error: 'FORBIDDEN', message: '仅创建者可修改' } };
  }

  const requestedType = input.contentType || input.type;
  const storedType = (row.content_type || row.type) as WorkshopItemType;
  if ((requestedType && isLocalOnlyAssetType(requestedType)) || (!requestedType && isLocalOnlyAssetType(storedType))) {
    return { status: 400, body: privateContentTypeError(requestedType || storedType) };
  }
  if (requestedType && !isPublicWorkshopType(requestedType)) {
    return { status: 400, body: { error: 'INVALID_TYPE', message: 'type 不合法' } };
  }

  const title = input.title !== undefined ? input.title.trim().slice(0, MAX_TITLE) : row.title;
  if (!title) {
    return { status: 400, body: { error: 'MISSING_TITLE', message: '标题不能为空' } };
  }
  const description = input.description !== undefined ? input.description : row.description;
  const tags = input.tags !== undefined ? normalizeTags(input.tags) : undefined;
  const dependencies = input.dependencies !== undefined ? normalizeDependencies(input.dependencies) : undefined;
  const recommendations = input.recommendations !== undefined ? normalizeDependencies(input.recommendations) : undefined;
  const screenshots = input.screenshots !== undefined ? normalizeScreenshots(input.screenshots) : undefined;

  let dataJson = row.data_json;
  const effectiveType = (requestedType || row.content_type || row.type) as WorkshopItemType;
  if (requestedType || input.data) {
    const candidateData = input.data ?? parseJson<unknown>(row.data_json, null);
    const candidateValidation = validateWorkshopContent(effectiveType, candidateData);
    if (!candidateValidation.ok) {
      return { status: 400, body: { error: candidateValidation.code, message: candidateValidation.message, ...(candidateValidation.path ? { path: candidateValidation.path } : {}) } };
    }
    if (input.data) dataJson = JSON.stringify(input.data);
    if (dataJson.length > MAX_DATA_SIZE) {
      return { status: 413, body: { error: 'DATA_TOO_LARGE', message: '数据大小超过 1MB 限制' } };
    }
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE workshop_items
     SET type = ?, content_type = ?, version = ?, title = ?, description = ?, tags = ?, data_json = ?, updated_at = ?, category = ?, dependencies_json = ?, recommendations_json = ?, min_app_version = ?, compatibility_json = ?, featured = ?, screenshots_json = ?
     WHERE id = ?`,
  )
    .bind(
      requestedType ? (LEGACY_DB_TYPES.has(requestedType) ? requestedType : 'world_package') : row.type,
      requestedType || row.content_type || row.type,
      input.version !== undefined ? normalizeVersion(input.version) : normalizeVersion(row.version),
      title, description, tags !== undefined ? JSON.stringify(tags) : row.tags, dataJson, now,
      input.category !== undefined ? input.category?.trim().slice(0, 64) || null : row.category || null,
      dependencies !== undefined ? JSON.stringify(dependencies) : row.dependencies_json || '[]',
      recommendations !== undefined ? JSON.stringify(recommendations) : row.recommendations_json || '[]',
      input.minAppVersion !== undefined ? input.minAppVersion?.trim().slice(0, 32) || null : row.min_app_version || null,
      input.compatibility !== undefined ? JSON.stringify(input.compatibility || {}) : row.compatibility_json || '{}',
      // Featured is curated server-side; preserve the existing trusted value.
      row.featured || 0,
      screenshots !== undefined ? JSON.stringify(screenshots) : row.screenshots_json || '[]',
      itemId,
    )
    .run();

  return { status: 200, body: { ok: true } };
}

/** 删除条目（仅创建者）。 */
export async function deleteItem(
  env: Bindings,
  userId: string,
  itemId: string,
): Promise<WorkshopResult> {
  const row = await getItemForOwner(env, itemId);
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

function versionTuple(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : undefined;
}

function versionLessThan(actual: number[], required: number[]): boolean {
  const length = Math.max(actual.length, required.length);
  for (let index = 0; index < length; index += 1) {
    const left = actual[index] || 0;
    const right = required[index] || 0;
    if (left !== right) return left < right;
  }
  return false;
}

/** Check a package's declared module dependencies before installing it. */
export function checkDependencies(
  row: WorkshopItemRow,
  installed: Record<string, string> = {},
): { ok: boolean; missing: WorkshopDependency[]; incompatible: WorkshopDependency[] } {
  const dependencies = parseJson<WorkshopDependency[]>(row.dependencies_json, []);
  const missing: WorkshopDependency[] = [];
  const incompatible: WorkshopDependency[] = [];
  for (const dependency of dependencies) {
    const current = installed[dependency.id];
    if (!current) {
      if (!dependency.optional) missing.push(dependency);
      continue;
    }
    const required = versionTuple(dependency.version);
    const actual = versionTuple(current);
    if (required && actual && versionLessThan(actual, required)) incompatible.push(dependency);
  }
  return { ok: missing.length === 0 && incompatible.length === 0, missing, incompatible };
}

export type WorkshopInstallPlanError = {
  code: 'MISSING' | 'INCOMPATIBLE' | 'CYCLE';
  id: string;
  requiredBy?: string;
  requiredVersion?: string;
  actualVersion?: string;
  path: string[];
};

export interface WorkshopInstallPlan {
  ok: boolean;
  rootId: string;
  items: WorkshopItemPublic[];
  recommendations: WorkshopDependency[];
  errors: WorkshopInstallPlanError[];
}

/**
 * Resolve a complete package graph before any client-side mutation. Dependencies
 * are returned leaf-first so the caller can install atomically in that order.
 */
export async function resolveInstallPlan(
  rootId: string,
  getRow: (id: string) => Promise<WorkshopItemRow | null>,
): Promise<WorkshopInstallPlan> {
  const items: WorkshopItemPublic[] = [];
  const errors: WorkshopInstallPlanError[] = [];
  const recommendations: WorkshopDependency[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();

  const visit = async (id: string, requiredBy?: string, requiredVersion?: string, optional = false): Promise<void> => {
    if (visiting.includes(id)) {
      errors.push({ code: 'CYCLE', id, requiredBy, requiredVersion, path: [...visiting, id] });
      return;
    }
    const row = await getRow(id);
    if (!row) {
      if (!optional) errors.push({ code: 'MISSING', id, requiredBy, requiredVersion, path: [...visiting, id] });
      return;
    }
    const actualVersion = normalizeVersion(row.version);
    const required = versionTuple(requiredVersion);
    const actual = versionTuple(actualVersion);
    const incompatible = Boolean(required && actual && versionLessThan(actual, required));
    if (incompatible) {
      if (!optional) errors.push({ code: 'INCOMPATIBLE', id, requiredBy, requiredVersion, actualVersion, path: [...visiting, id] });
    }
    // Every incoming edge must be checked, even when the node was already
    // resolved through another branch with a weaker version constraint.
    if (visited.has(id)) return;
    visiting.push(id);
    const dependencies = parseJson<WorkshopDependency[]>(row.dependencies_json, []);
    for (const dependency of dependencies) {
      await visit(dependency.id, id, dependency.version, dependency.optional === true);
    }
    visiting.pop();
    visited.add(id);
    items.push(toPublic(row));
  };

  const root = await getRow(rootId);
  if (!root) {
    return { ok: false, rootId, items: [], recommendations: [], errors: [{ code: 'MISSING', id: rootId, path: [rootId] }] };
  }
  for (const recommendation of parseJson<WorkshopDependency[]>(root.recommendations_json, [])) {
    recommendations.push(recommendation);
    const recommended = await getRow(recommendation.id);
    if (!recommended && !recommendation.optional) {
      errors.push({ code: 'MISSING', id: recommendation.id, requiredBy: root.id, requiredVersion: recommendation.version, path: [root.id, recommendation.id] });
    } else if (recommended && !recommendation.optional) {
      await visit(recommendation.id, root.id, recommendation.version);
    }
  }
  await visit(rootId);
  return { ok: errors.length === 0, rootId, items, recommendations, errors };
}
