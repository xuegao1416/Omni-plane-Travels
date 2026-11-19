/**
 * workshop.ts — 创意工坊服务端：内容校验、列表/搜索、发布与版本历史、评分、收藏、举报、下载去重、安装计划、管理。
 *
 * 规则：
 *  - 列表只显示 published；unlisted 不进列表但可凭链接和依赖安装；archived/hidden/deleted 不能再安装。
 *  - 发布新内容（data）必须提升版本号，并写入版本历史；只改标题、描述等展示信息不需要。
 *  - 删除是软删除：保留元数据让依赖方得到“已删除”的明确提示，内容与历史版本立即清除。
 *  - 人物预设、人生经历只保存在本地，永远不接受发布。
 */
import type { Bindings, WorkshopItemRow, WorkshopItemType } from './types';
import { validateCustomGameplayModule } from '../custom-modules/validator';
import { isLocalOnlyAssetType, isPublicWorkshopType } from '../workshopCatalog';
import {
  INSTALLABLE_STATUSES,
  OWNER_SETTABLE_STATUSES,
  WORKSHOP_LIMITS,
  WORKSHOP_REPORT_REASONS,
  compareVersions,
  isNewerVersion,
  isVersion,
  isWorkshopSort,
  nextPatchVersion,
  normalizeVersion,
  workshopContentId,
  type OwnerSettableStatus,
  type WorkshopDependency,
  type WorkshopInstallPlan,
  type WorkshopInstallPlanError,
  type WorkshopItemSummary,
  type WorkshopRecommendation,
  type WorkshopReportReason,
  type WorkshopReportRecord,
  type WorkshopSort,
  type WorkshopStatus,
  type WorkshopUpdateInfo,
  type WorkshopVersionInfo,
  type WorkshopViewerState,
} from '../workshop/protocol';

export type { WorkshopInstallPlan, WorkshopInstallPlanError } from '../workshop/protocol';

export interface WorkshopInput {
  title?: string;
  description?: string | null;
  changelog?: string | null;
  type?: WorkshopItemType;
  contentType?: WorkshopItemType;
  tags?: string[];
  data?: Record<string, unknown>;
  version?: string;
  /** 乐观并发：调用方认为的当前版本，不一致时返回 409。 */
  expectedVersion?: string;
  category?: string | null;
  dependencies?: WorkshopDependency[];
  recommendations?: WorkshopDependency[];
  minAppVersion?: string | null;
  compatibility?: Record<string, unknown>;
  screenshots?: string[];
  /** 新建时可选 unlisted；其余状态走状态接口。 */
  status?: string;
}

export interface ListParams {
  type?: string;
  tag?: string;
  q?: string;
  author?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  category?: string;
}

export interface ListResult {
  items: WorkshopItemSummary[];
  page: number;
  total: number;
  pageSize: number;
}

export interface WorkshopResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_PAGE = 500;
const MAX_COMPATIBILITY_BYTES = 4096;
const DAY_MS = 86_400_000;
const LIST_COLUMNS = `w.id, w.owner_id, w.type, w.content_id, w.title, w.description, w.changelog, w.tags, w.data_size, w.version, w.status,
  w.category, w.dependencies_json, w.recommendations_json, w.min_app_version, w.compatibility_json, w.screenshots_json, w.featured,
  w.download_count, w.favorite_count, w.rating_count, w.rating_sum, w.created_at, w.updated_at, w.deleted_at,
  u.display_name AS author_name`;

function fail(status: number, error: string, message: string, extra: Record<string, unknown> = {}): WorkshopResult {
  return { status, body: { error, message, ...extra } };
}

function privateContentTypeError(type: string): WorkshopResult {
  return fail(400, 'PRIVATE_CONTENT_TYPE', type === 'history_preset'
    ? '人生经历仅保存在本地，不能发布到创意工坊'
    : '主角人物预设仅保存在本地；请匿名化后发布为 NPC 模板');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function cleanText(value: unknown, max: number): string {
  // 去掉控制字符（保留换行与制表），再按长度截断。
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '';
}

function normalizeTags(tags?: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = cleanText(String(raw ?? ''), WORKSHOP_LIMITS.tagLength);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= WORKSHOP_LIMITS.tags) break;
  }
  return out;
}

export function normalizeDependencies(dependencies?: unknown): WorkshopDependency[] {
  if (!Array.isArray(dependencies)) return [];
  const seen = new Set<string>();
  return dependencies.slice(0, WORKSHOP_LIMITS.dependencies).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof (item as WorkshopDependency).id !== 'string') return [];
    const source = item as WorkshopDependency;
    const id = source.id.trim().toLowerCase().slice(0, 80);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const type = typeof source.type === 'string' && isPublicWorkshopType(source.type) ? source.type : undefined;
    const version = isVersion(source.version) ? normalizeVersion(source.version) : undefined;
    const reason = cleanText(source.reason, 160);
    return [{ id, ...(type ? { type } : {}), ...(version ? { version } : {}), ...(source.optional ? { optional: true } : {}), ...(reason ? { reason } : {}) }];
  });
}

function normalizeScreenshots(screenshots?: unknown): string[] {
  if (!Array.isArray(screenshots)) return [];
  return [...new Set(screenshots.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const url = value.trim().slice(0, 1000);
    return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? [url] : [];
  }))].slice(0, WORKSHOP_LIMITS.screenshots);
}

/** 世界作者可以在包里直接写推荐内容。 */
function extractRecommendations(data?: Record<string, unknown>): WorkshopDependency[] {
  if (!data) return [];
  const values = Array.isArray(data.recommendations) ? data.recommendations : data.recommendedItems;
  return normalizeDependencies(values);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function searchTextOf(title: string, description: string | null, tags: string[], contentId: string | null): string {
  return [title, description ?? '', tags.join(' '), contentId ?? ''].join(' ').toLowerCase().slice(0, 6000);
}

// —— 内容校验 ——

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

const ADVENTURE_COLLECTIONS = ['scenes', 'chapters', 'steps'] as const;

function validateAdventureShape(data: Record<string, unknown>): WorkshopContentValidationResult {
  const common = validateCommonNamedAsset(data, '冒险包');
  if (!common.ok) return common;
  const key = ADVENTURE_COLLECTIONS.find(name => data[name] !== undefined);
  if (!key) return contentError('INVALID_ADVENTURE_PACK', '冒险包必须包含 scenes、chapters 或 steps 数组');
  const scenes = data[key];
  if (!Array.isArray(scenes)) return contentError('INVALID_ADVENTURE_PACK', `${key} 必须是数组`, key);
  if (scenes.length === 0 || scenes.length > 64) return contentError('INVALID_ADVENTURE_PACK', '冒险包需要 1 到 64 个场景', key);
  const ids = new Set<string>();
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const path = `${key}[${index}]`;
    if (!recordValue(scene)) return contentError('INVALID_ADVENTURE_SCENE', '场景必须是 JSON 对象', path);
    if (typeof scene.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(scene.id)) {
      return contentError('INVALID_ADVENTURE_SCENE', '场景 id 只能用字母、数字、下划线和短横线（最长 64）', `${path}.id`);
    }
    // 场景会编译成事件卡，事件 id 只能是小写，所以按小写判断重复。
    if (ids.has(scene.id.toLowerCase())) return contentError('INVALID_ADVENTURE_SCENE', `场景 id「${scene.id}」重复`, `${path}.id`);
    ids.add(scene.id.toLowerCase());
    if (typeof scene.text !== 'string' || !scene.text.trim()) return contentError('INVALID_ADVENTURE_SCENE', '场景缺少 text', `${path}.text`);
    if (scene.options !== undefined && !Array.isArray(scene.options)) return contentError('INVALID_ADVENTURE_SCENE', 'options 必须是数组', `${path}.options`);
    for (const [optionIndex, option] of (Array.isArray(scene.options) ? scene.options : []).entries()) {
      if (!recordValue(option) || typeof option.label !== 'string' || !option.label.trim()) {
        return contentError('INVALID_ADVENTURE_OPTION', '选项必须有 label', `${path}.options[${optionIndex}]`);
      }
    }
  }
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index] as Record<string, unknown>;
    for (const [optionIndex, option] of (Array.isArray(scene.options) ? scene.options as Record<string, unknown>[] : []).entries()) {
      const targets = [option.next, recordValue(option.success) ? option.success.next : undefined, recordValue(option.failure) ? option.failure.next : undefined];
      for (const target of targets) {
        if (target !== undefined && (typeof target !== 'string' || !ids.has(target.toLowerCase()))) {
          return contentError('INVALID_ADVENTURE_LINK', `选项指向的场景「${String(target)}」不存在`, `${key}[${index}].options[${optionIndex}]`);
        }
      }
    }
  }
  return { ok: true };
}

const THEME_TOKEN_PATTERN = /^--d-[a-z0-9-]{1,40}$/;
const THEME_VALUE_PATTERN = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})$/i;

function validateThemeTokens(tokens: unknown, path: string): WorkshopContentValidationResult {
  if (!recordValue(tokens)) return contentError('INVALID_VISUAL_THEME', '主题色板必须是对象', path);
  const entries = Object.entries(tokens);
  if (entries.length > 80) return contentError('INVALID_VISUAL_THEME', '主题色板最多 80 项', path);
  for (const [token, value] of entries) {
    if (!THEME_TOKEN_PATTERN.test(token)) return contentError('INVALID_VISUAL_THEME', `不支持的主题变量「${token}」（只接受 --d- 开头的颜色变量）`, `${path}.${token}`);
    if (typeof value !== 'string' || !THEME_VALUE_PATTERN.test(value.trim())) {
      return contentError('INVALID_VISUAL_THEME', `主题变量「${token}」必须是 #rrggbb 或 “r, g, b”`, `${path}.${token}`);
    }
  }
  return { ok: true };
}

function validateVisualTheme(data: Record<string, unknown>): WorkshopContentValidationResult {
  const common = validateCommonNamedAsset(data, '视觉主题');
  if (!common.ok) return common;
  const palettes: Array<[string, unknown]> = [];
  for (const key of ['tokens', 'variables'] as const) if (data[key] !== undefined) palettes.push([key, data[key]]);
  if (recordValue(data.theme)) palettes.push(['theme', data.theme]);
  if (recordValue(data.themes)) {
    for (const [name, palette] of Object.entries(data.themes)) {
      if (name !== 'night' && name !== 'dawn') return contentError('INVALID_VISUAL_THEME', 'themes 只能包含 night 和 dawn', `themes.${name}`);
      palettes.push([`themes.${name}`, palette]);
    }
  }
  if (palettes.length === 0 && !Array.isArray(data.assets)) {
    return contentError('INVALID_VISUAL_THEME', '视觉主题必须包含 tokens、themes、theme、variables 或 assets');
  }
  for (const [path, palette] of palettes) {
    const result = validateThemeTokens(palette, path);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** 每种公开类型的服务端结构校验（客户端安装前会再校验一次）。 */
export function validateWorkshopContent(type: WorkshopItemType, data: unknown): WorkshopContentValidationResult {
  if (isLocalOnlyAssetType(type)) return contentError('PRIVATE_CONTENT_TYPE', String(privateContentTypeError(type).body.message));
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
    case 'adventure_pack': return validateAdventureShape(data);
    case 'visual_theme': return validateVisualTheme(data);
    default: return contentError('INVALID_TYPE', 'type 不受支持');
  }
}

// —— 行映射 ——

export function authorNameOf(row: Pick<WorkshopItemRow, 'owner_id' | 'author_name'>): string {
  const name = typeof row.author_name === 'string' ? row.author_name.trim() : '';
  return name || `旅者·${row.owner_id.replace(/-/g, '').slice(0, 6)}`;
}

/** 数据库行 → 对外结构（不含 data）。兼容 0010 之前带 content_type 的旧行。 */
export function toPublic(row: WorkshopItemRow): WorkshopItemSummary {
  const type = (row.content_type || row.type) as WorkshopItemType;
  const ratingCount = Number(row.rating_count ?? 0);
  const ratingSum = Number(row.rating_sum ?? 0);
  return {
    id: row.id,
    ownerId: row.owner_id,
    author: { id: row.owner_id, name: authorNameOf(row) },
    type,
    contentType: type,
    contentId: row.content_id ?? null,
    version: normalizeVersion(row.version),
    title: row.title,
    description: row.description,
    changelog: row.changelog ?? null,
    tags: parseJson<string[]>(row.tags, []),
    category: row.category || null,
    status: (row.status as WorkshopStatus) || 'published',
    downloadCount: Number(row.download_count ?? 0),
    favoriteCount: Number(row.favorite_count ?? 0),
    ratingCount,
    ratingAverage: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dependencies: parseJson<WorkshopDependency[]>(row.dependencies_json, []),
    recommendations: parseJson<WorkshopDependency[]>(row.recommendations_json, []),
    minAppVersion: row.min_app_version || null,
    compatibility: parseJson<Record<string, unknown>>(row.compatibility_json, {}),
    featured: Number(row.featured ?? 0) === 1,
    screenshots: parseJson<string[]>(row.screenshots_json, []),
    dataSize: Number(row.data_size ?? (row.data_json ? byteLength(row.data_json) : 0)),
  };
}

// —— 读取 ——

function sortSql(sort: WorkshopSort): string {
  switch (sort) {
    case 'updated': return 'w.updated_at DESC';
    case 'downloads': return 'w.download_count DESC, w.created_at DESC';
    // 带先验的平均分（先验 3 分、权重 2 票），避免一票五星排到最前。
    case 'rating': return '(w.rating_sum + 6) * 1.0 / (w.rating_count + 2) DESC, w.rating_count DESC, w.created_at DESC';
    case 'favorites': return 'w.favorite_count DESC, w.created_at DESC';
    case 'featured': return 'w.featured DESC, w.download_count DESC, w.created_at DESC';
    default: return 'w.created_at DESC';
  }
}

function normalizeSort(value: unknown): WorkshopSort {
  if (value === 'popular') return 'downloads';
  return isWorkshopSort(value) ? value : 'latest';
}

/** 列表（公开，只含 published）。 */
export async function listItems(env: Bindings, params: ListParams): Promise<ListResult> {
  const pageSize = Math.min(Math.max(Math.trunc(Number(params.pageSize)) || 20, 1), WORKSHOP_LIMITS.pageSize);
  const page = Math.min(Math.max(Math.trunc(Number(params.page)) || 1, 1), MAX_PAGE);
  const offset = (page - 1) * pageSize;
  const where: string[] = ["w.status = 'published'"];
  const binds: unknown[] = [];
  if (params.type) {
    if (!isPublicWorkshopType(params.type)) where.push('1 = 0');
    else {
      where.push('w.type = ?');
      binds.push(params.type);
    }
  } else {
    where.push("w.type NOT IN ('character_preset', 'history_preset')");
  }
  if (params.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(w.tags) WHERE json_each.value = ?)');
    binds.push(cleanText(params.tag, WORKSHOP_LIMITS.tagLength));
  }
  if (params.category) {
    where.push('w.category = ?');
    binds.push(cleanText(params.category, 64));
  }
  if (params.author) {
    where.push('w.owner_id = ?');
    binds.push(cleanText(params.author, 80));
  }
  const terms = cleanText(params.q, 200).toLowerCase().split(/\s+/).filter(Boolean).slice(0, WORKSHOP_LIMITS.searchTerms);
  for (const term of terms) {
    where.push("w.search_text LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(term.slice(0, 32))}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM workshop_items w ${whereSql}`).bind(...binds).first<{ c: number }>();
  const rows = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM workshop_items w LEFT JOIN users u ON u.id = w.owner_id
     ${whereSql} ORDER BY ${sortSql(normalizeSort(params.sort))} LIMIT ? OFFSET ?`,
  ).bind(...binds, pageSize, offset).all<WorkshopItemRow>();
  return { items: (rows.results || []).map(toPublic), page, total: totalRow?.c ?? 0, pageSize };
}

/** 作者自己的条目（含不公开、已归档、被下架；不含已删除）。 */
export async function listOwnerItems(env: Bindings, ownerId: string): Promise<WorkshopItemSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM workshop_items w LEFT JOIN users u ON u.id = w.owner_id
     WHERE w.owner_id = ? AND w.status != 'deleted' ORDER BY w.updated_at DESC LIMIT 200`,
  ).bind(ownerId).all<WorkshopItemRow>();
  return (rows.results || []).map(toPublic);
}

/** 收藏列表（只显示仍然公开或不公开列出的条目）。 */
export async function listFavoriteItems(env: Bindings, userId: string): Promise<WorkshopItemSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM workshop_favorites f
     JOIN workshop_items w ON w.id = f.item_id
     LEFT JOIN users u ON u.id = w.owner_id
     WHERE f.user_id = ? AND w.status IN ('published', 'unlisted') ORDER BY f.created_at DESC LIMIT 200`,
  ).bind(userId).all<WorkshopItemRow>();
  return (rows.results || []).map(toPublic);
}

/** 任意状态读取一行（含作者昵称）。 */
export async function getRow(env: Bindings, itemId: string): Promise<WorkshopItemRow | null> {
  const row = await env.DB.prepare(
    `SELECT w.*, u.display_name AS author_name FROM workshop_items w LEFT JOIN users u ON u.id = w.owner_id WHERE w.id = ?`,
  ).bind(itemId).first<WorkshopItemRow>();
  return row ?? null;
}

function isInstallable(row: WorkshopItemRow): boolean {
  return INSTALLABLE_STATUSES.includes(row.status as WorkshopStatus) && !isLocalOnlyAssetType(row.content_type || row.type);
}

/** 公开可读：published / unlisted；作者本人还能看到自己的 archived / hidden。 */
function visibleTo(row: WorkshopItemRow, viewerId?: string): boolean {
  if (isLocalOnlyAssetType(row.content_type || row.type)) return false;
  if (isInstallable(row)) return true;
  return Boolean(viewerId && row.owner_id === viewerId && row.status !== 'deleted');
}

async function viewerState(env: Bindings, row: WorkshopItemRow, viewerId: string): Promise<WorkshopViewerState> {
  const [rating, favorite, report] = await Promise.all([
    env.DB.prepare('SELECT score FROM workshop_ratings WHERE item_id = ? AND user_id = ?').bind(row.id, viewerId).first<{ score: number }>(),
    env.DB.prepare('SELECT 1 AS ok FROM workshop_favorites WHERE item_id = ? AND user_id = ?').bind(row.id, viewerId).first<{ ok: number }>(),
    env.DB.prepare("SELECT 1 AS ok FROM workshop_reports WHERE item_id = ? AND reporter_id = ? AND status = 'open'").bind(row.id, viewerId).first<{ ok: number }>(),
  ]);
  return { isOwner: row.owner_id === viewerId, rating: rating?.score ?? null, favorited: Boolean(favorite), reported: Boolean(report) };
}

/** 详情（含 data；登录时附带当前用户的评分、收藏、举报状态）。 */
export async function getItemDetail(env: Bindings, itemId: string, viewerId?: string): Promise<WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || !visibleTo(row, viewerId)) return fail(404, 'NOT_FOUND', '条目不存在');
  const data = parseJson<unknown>(row.data_json, null);
  const viewer = viewerId ? await viewerState(env, row, viewerId) : undefined;
  return { status: 200, body: { item: { ...toPublic(row), data, ...(viewer ? { viewer } : {}) } } };
}

export async function listVersions(env: Bindings, itemId: string, viewerId?: string): Promise<WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || !visibleTo(row, viewerId)) return fail(404, 'NOT_FOUND', '条目不存在');
  const rows = await env.DB.prepare(
    'SELECT version, changelog, created_at, data_size FROM workshop_versions WHERE item_id = ? ORDER BY created_at DESC LIMIT ?',
  ).bind(itemId, WORKSHOP_LIMITS.versionsKept).all<{ version: string; changelog: string | null; created_at: number; data_size: number }>();
  const versions: WorkshopVersionInfo[] = (rows.results || [])
    .map(entry => ({ version: entry.version, changelog: entry.changelog, createdAt: entry.created_at, dataSize: entry.data_size }))
    .sort((left, right) => compareVersions(right.version, left.version));
  return { status: 200, body: { versions } };
}

/** 批量查已安装条目的最新版本与状态（找不到的 id 不返回）。 */
export async function checkUpdates(env: Bindings, ids: readonly string[]): Promise<WorkshopUpdateInfo[]> {
  const unique = [...new Set(ids.map(id => id.trim().toLowerCase()).filter(id => /^[a-z0-9-]{1,80}$/.test(id)))].slice(0, 100);
  if (unique.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT id, title, version, status, updated_at FROM workshop_items WHERE id IN (${unique.map(() => '?').join(', ')})`,
  ).bind(...unique).all<{ id: string; title: string; version: string; status: WorkshopStatus; updated_at: number }>();
  return (rows.results || []).map(row => ({ id: row.id, title: row.title, version: normalizeVersion(row.version), status: row.status, updatedAt: row.updated_at }));
}

// —— 下载 ——

/** 同一客户端对同一条目每天只计一次下载。 */
export async function recordDownload(env: Bindings, itemId: string, clientKey: string, now = Date.now()): Promise<boolean> {
  const day = Math.floor(now / DAY_MS);
  const mark = await env.DB.prepare('INSERT OR IGNORE INTO workshop_download_marks (item_id, client_key, day) VALUES (?, ?, ?)')
    .bind(itemId, clientKey, day).run();
  const counted = Number(mark.meta?.changes ?? 0) > 0;
  if (counted) {
    await env.DB.prepare('UPDATE workshop_items SET download_count = download_count + 1 WHERE id = ?').bind(itemId).run();
    // 顺手清理两天前的去重标记，表不会无限增长。
    if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM workshop_download_marks WHERE day < ?').bind(day - 1).run();
  }
  return counted;
}

export async function getDownload(env: Bindings, itemId: string, clientKey: string, version?: string): Promise<WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || isLocalOnlyAssetType(row.content_type || row.type) || row.status === 'deleted') return fail(404, 'NOT_FOUND', '条目不存在');
  if (!isInstallable(row)) return fail(410, 'UNAVAILABLE', row.status === 'archived' ? '作者已归档该条目，不再提供安装' : '该条目已被下架', { status: row.status });
  let dataJson = row.data_json;
  let meta = {
    version: normalizeVersion(row.version), changelog: row.changelog ?? null, dependencies_json: row.dependencies_json,
    recommendations_json: row.recommendations_json, min_app_version: row.min_app_version, compatibility_json: row.compatibility_json,
  };
  if (version && normalizeVersion(version, '') !== meta.version) {
    const historic = await env.DB.prepare('SELECT * FROM workshop_versions WHERE item_id = ? AND version = ?')
      .bind(itemId, normalizeVersion(version, '')).first<{ version: string; changelog: string | null; data_json: string; dependencies_json: string; recommendations_json: string; min_app_version: string | null; compatibility_json: string }>();
    if (!historic) return fail(404, 'VERSION_NOT_FOUND', `找不到版本 ${version}`);
    dataJson = historic.data_json;
    meta = { ...historic, version: normalizeVersion(historic.version) };
  }
  const counted = await recordDownload(env, itemId, clientKey);
  const data = parseJson<unknown>(dataJson, null);
  return {
    status: 200,
    body: {
      id: row.id,
      type: row.content_type || row.type,
      version: meta.version,
      title: row.title,
      description: row.description,
      tags: parseJson<string[]>(row.tags, []),
      data,
      download_count: row.download_count + (counted ? 1 : 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
      dependencies: parseJson<WorkshopDependency[]>(meta.dependencies_json, []),
      recommendations: parseJson<WorkshopDependency[]>(meta.recommendations_json, []),
      min_app_version: meta.min_app_version || null,
      compatibility: parseJson<Record<string, unknown>>(meta.compatibility_json, {}),
      screenshots: parseJson<string[]>(row.screenshots_json, []),
      changelog: meta.changelog,
      content_id: row.content_id ?? workshopContentId((row.content_type || row.type) as WorkshopItemType, data),
    },
  };
}

// —— 发布与修改 ——

interface PreparedContent {
  dataJson: string;
  dataSize: number;
  contentId: string | null;
}

function prepareContent(type: WorkshopItemType, data: unknown): PreparedContent | WorkshopResult {
  const validation = validateWorkshopContent(type, data);
  if (!validation.ok) return fail(400, validation.code, validation.message, validation.path ? { path: validation.path } : {});
  const dataJson = JSON.stringify(data);
  const dataSize = byteLength(dataJson);
  if (dataSize > WORKSHOP_LIMITS.dataBytes) return fail(413, 'DATA_TOO_LARGE', '数据大小超过 1MB 限制（图片请改用截图链接）');
  return { dataJson, dataSize, contentId: workshopContentId(type, data) };
}

function isResult(value: unknown): value is WorkshopResult {
  return Boolean(value && typeof value === 'object' && 'status' in value && 'body' in value);
}

function prepareCompatibility(value: unknown): string | WorkshopResult {
  if (value === undefined || value === null) return '{}';
  if (!recordValue(value)) return fail(400, 'INVALID_COMPATIBILITY', 'compatibility 必须是对象');
  const json = JSON.stringify(value);
  if (byteLength(json) > MAX_COMPATIBILITY_BYTES) return fail(400, 'INVALID_COMPATIBILITY', 'compatibility 过大');
  return json;
}

function prepareMinAppVersion(value: unknown): string | null | WorkshopResult {
  if (value === undefined || value === null || value === '') return null;
  return isVersion(value) ? normalizeVersion(value) : fail(400, 'INVALID_VERSION', '最低应用版本必须是 x.y.z 格式');
}

/** 依赖必须指向仍可安装的条目；可选依赖允许暂时缺失。 */
async function checkDependencyTargets(env: Bindings, itemId: string | null, dependencies: readonly WorkshopDependency[]): Promise<WorkshopResult | null> {
  for (const dependency of dependencies) {
    if (itemId && dependency.id === itemId) return fail(400, 'DEPENDENCY_SELF', '条目不能依赖自己');
    if (dependency.optional) continue;
    const target = await getRow(env, dependency.id);
    if (!target || !isInstallable(target)) {
      return fail(400, 'DEPENDENCY_UNAVAILABLE', `依赖的工坊条目「${dependency.id}」不存在或已不可安装`, { dependency: dependency.id });
    }
    if (dependency.version && compareVersions(target.version, dependency.version) < 0) {
      return fail(400, 'DEPENDENCY_VERSION', `依赖「${target.title}」当前只有 ${normalizeVersion(target.version)}，低于声明的 ${dependency.version}`, { dependency: dependency.id });
    }
  }
  return null;
}

/** 上传新条目（需登录）。 */
export async function createItem(env: Bindings, userId: string, input: WorkshopInput): Promise<WorkshopResult> {
  const requestedType = input.contentType || input.type;
  if (requestedType && isLocalOnlyAssetType(requestedType)) return privateContentTypeError(requestedType);
  if (!requestedType || !isPublicWorkshopType(requestedType)) return fail(400, 'INVALID_TYPE', 'type 不受支持');
  const title = cleanText(input.title, WORKSHOP_LIMITS.title);
  if (!title) return fail(400, 'MISSING_TITLE', '标题不能为空');
  if (!input.data || typeof input.data !== 'object') return fail(400, 'MISSING_DATA', 'data 不能为空');
  if (input.version !== undefined && !isVersion(input.version)) return fail(400, 'INVALID_VERSION', '版本号必须是 x.y.z 格式');

  const content = prepareContent(requestedType, input.data);
  if (isResult(content)) return content;
  const compatibility = prepareCompatibility(input.compatibility);
  if (isResult(compatibility)) return compatibility;
  const minAppVersion = prepareMinAppVersion(input.minAppVersion);
  if (isResult(minAppVersion)) return minAppVersion;
  const dependencies = normalizeDependencies(input.dependencies);
  const dependencyIssue = await checkDependencyTargets(env, null, dependencies);
  if (dependencyIssue) return dependencyIssue;

  const id = crypto.randomUUID();
  const tags = normalizeTags(input.tags);
  const description = cleanText(input.description, WORKSHOP_LIMITS.description) || null;
  const changelog = cleanText(input.changelog, WORKSHOP_LIMITS.changelog) || null;
  const recommendations = normalizeDependencies(input.recommendations ?? extractRecommendations(input.data)).filter(entry => entry.id !== id);
  const version = normalizeVersion(input.version);
  const status = input.status === 'unlisted' ? 'unlisted' : 'published';
  const now = Date.now();
  const dependenciesJson = JSON.stringify(dependencies);
  const recommendationsJson = JSON.stringify(recommendations);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workshop_items
        (id, owner_id, type, content_id, title, description, changelog, tags, data_json, data_size, version, status, category,
         dependencies_json, recommendations_json, min_app_version, compatibility_json, screenshots_json, featured,
         download_count, favorite_count, rating_count, rating_sum, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
    ).bind(
      id, userId, requestedType, content.contentId, title, description, changelog, JSON.stringify(tags), content.dataJson, content.dataSize,
      version, status, cleanText(input.category, 64) || null, dependenciesJson, recommendationsJson, minAppVersion, compatibility,
      JSON.stringify(normalizeScreenshots(input.screenshots)), searchTextOf(title, description, tags, content.contentId), now, now,
    ),
    env.DB.prepare(
      `INSERT INTO workshop_versions (item_id, version, changelog, data_json, data_size, dependencies_json, recommendations_json, min_app_version, compatibility_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, version, changelog, content.dataJson, content.dataSize, dependenciesJson, recommendationsJson, minAppVersion, compatibility, now),
  ]);
  return { status: 201, body: { id, version, status } };
}

function sameJson(left: unknown, right: string | null | undefined, fallback: string): boolean {
  return JSON.stringify(left) === (right || fallback);
}

/**
 * 修改条目（仅作者）。带 data 时视为发布新版本：版本号必须提升，并写入历史；
 * 依赖、最低版本、兼容性属于版本内容，只能随新版本一起改。
 */
export async function updateItem(env: Bindings, userId: string, itemId: string, input: WorkshopInput): Promise<WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || row.status === 'deleted') return fail(404, 'NOT_FOUND', '条目不存在');
  if (row.owner_id !== userId) return fail(403, 'FORBIDDEN', '仅作者可修改');
  const storedType = (row.content_type || row.type) as WorkshopItemType;
  const requestedType = input.contentType || input.type;
  if (isLocalOnlyAssetType(storedType) || (requestedType && isLocalOnlyAssetType(requestedType))) return privateContentTypeError(requestedType || storedType);
  if (requestedType && requestedType !== storedType) return fail(400, 'TYPE_IMMUTABLE', '已发布条目的类型不能修改，请新建条目');

  const currentVersion = normalizeVersion(row.version);
  if (input.expectedVersion !== undefined && normalizeVersion(input.expectedVersion, '') !== currentVersion) {
    return fail(409, 'VERSION_CONFLICT', `条目已更新到 ${currentVersion}，请刷新后再改`, { currentVersion });
  }

  const title = input.title !== undefined ? cleanText(input.title, WORKSHOP_LIMITS.title) : row.title;
  if (!title) return fail(400, 'MISSING_TITLE', '标题不能为空');
  const description = input.description !== undefined ? cleanText(input.description, WORKSHOP_LIMITS.description) || null : row.description;
  const tags = input.tags !== undefined ? normalizeTags(input.tags) : parseJson<string[]>(row.tags, []);
  const recommendations = input.recommendations !== undefined
    ? normalizeDependencies(input.recommendations).filter(entry => entry.id !== itemId)
    : parseJson<WorkshopDependency[]>(row.recommendations_json, []);
  const screenshots = input.screenshots !== undefined ? normalizeScreenshots(input.screenshots) : parseJson<string[]>(row.screenshots_json, []);
  const category = input.category !== undefined ? cleanText(input.category, 64) || null : row.category || null;

  const dependencies = input.dependencies !== undefined ? normalizeDependencies(input.dependencies) : parseJson<WorkshopDependency[]>(row.dependencies_json, []);
  const compatibility = input.compatibility !== undefined ? prepareCompatibility(input.compatibility) : row.compatibility_json || '{}';
  if (isResult(compatibility)) return compatibility;
  const minAppVersion = input.minAppVersion !== undefined ? prepareMinAppVersion(input.minAppVersion) : row.min_app_version || null;
  if (isResult(minAppVersion)) return minAppVersion;

  const now = Date.now();
  const statements = [];
  let version = currentVersion;
  let changelog = row.changelog ?? null;
  let content: PreparedContent = { dataJson: row.data_json, dataSize: Number(row.data_size ?? byteLength(row.data_json)), contentId: row.content_id ?? null };

  if (input.data !== undefined) {
    if (!input.version || !isVersion(input.version)) {
      return fail(400, 'VERSION_REQUIRED', '发布新内容需要填写新的版本号', { currentVersion, suggestedVersion: nextPatchVersion(currentVersion) });
    }
    if (!isNewerVersion(input.version, currentVersion)) {
      return fail(409, 'VERSION_NOT_INCREASED', `新版本号必须高于当前的 ${currentVersion}`, { currentVersion, suggestedVersion: nextPatchVersion(currentVersion) });
    }
    const prepared = prepareContent(storedType, input.data);
    if (isResult(prepared)) return prepared;
    content = prepared;
    version = normalizeVersion(input.version);
    changelog = cleanText(input.changelog, WORKSHOP_LIMITS.changelog) || null;
    const dependencyIssue = await checkDependencyTargets(env, itemId, dependencies);
    if (dependencyIssue) return dependencyIssue;
    // 新依赖不能绕回自己。
    const candidate: WorkshopItemRow = { ...row, dependencies_json: JSON.stringify(dependencies), version };
    const plan = await resolveInstallPlan(itemId, async id => (id === itemId ? candidate : getRow(env, id)));
    const cycle = plan.errors.find(error => error.code === 'CYCLE');
    if (cycle) return fail(400, 'DEPENDENCY_CYCLE', `依赖形成循环：${cycle.path.join(' → ')}`);
    statements.push(env.DB.prepare(
      `INSERT INTO workshop_versions (item_id, version, changelog, data_json, data_size, dependencies_json, recommendations_json, min_app_version, compatibility_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(itemId, version, changelog, content.dataJson, content.dataSize, JSON.stringify(dependencies), JSON.stringify(recommendations), minAppVersion, compatibility, now));
  } else if (
    !sameJson(dependencies, row.dependencies_json, '[]')
    || compatibility !== (row.compatibility_json || '{}')
    || minAppVersion !== (row.min_app_version || null)
  ) {
    return fail(409, 'VERSION_REQUIRED', '依赖、最低版本和兼容性要随新版本一起发布', { currentVersion, suggestedVersion: nextPatchVersion(currentVersion) });
  }

  statements.push(env.DB.prepare(
    `UPDATE workshop_items
     SET title = ?, description = ?, changelog = ?, tags = ?, data_json = ?, data_size = ?, content_id = ?, version = ?, category = ?,
         dependencies_json = ?, recommendations_json = ?, min_app_version = ?, compatibility_json = ?, screenshots_json = ?,
         search_text = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    title, description, changelog, JSON.stringify(tags), content.dataJson, content.dataSize, content.contentId, version, category,
    JSON.stringify(dependencies), JSON.stringify(recommendations), minAppVersion, compatibility, JSON.stringify(screenshots),
    searchTextOf(title, description, tags, content.contentId), now, itemId,
  ));
  if (input.data !== undefined) {
    // 只保留最近的若干个版本。
    statements.push(env.DB.prepare(
      `DELETE FROM workshop_versions WHERE item_id = ? AND version NOT IN (
         SELECT version FROM workshop_versions WHERE item_id = ? ORDER BY created_at DESC LIMIT ?)`,
    ).bind(itemId, itemId, WORKSHOP_LIMITS.versionsKept));
  }
  await env.DB.batch(statements);
  return { status: 200, body: { ok: true, version, newVersion: input.data !== undefined } };
}

/** 作者切换公开 / 不公开列出 / 归档。被下架的条目只能由管理员恢复。 */
export async function setItemStatus(env: Bindings, userId: string, itemId: string, status: unknown): Promise<WorkshopResult> {
  if (typeof status !== 'string' || !(OWNER_SETTABLE_STATUSES as readonly string[]).includes(status)) {
    return fail(400, 'INVALID_STATUS', '状态只能是 published、unlisted 或 archived');
  }
  const row = await getRow(env, itemId);
  if (!row || row.status === 'deleted') return fail(404, 'NOT_FOUND', '条目不存在');
  if (row.owner_id !== userId) return fail(403, 'FORBIDDEN', '仅作者可修改');
  if (row.status === 'hidden') return fail(403, 'HIDDEN_BY_MODERATION', '条目已被下架，需等待管理员复核');
  await env.DB.prepare('UPDATE workshop_items SET status = ?, updated_at = ? WHERE id = ?').bind(status as OwnerSettableStatus, Date.now(), itemId).run();
  return { status: 200, body: { ok: true, status } };
}

/** 删除条目（仅作者，软删除：保留元数据，清除内容与历史版本）。 */
export async function deleteItem(env: Bindings, userId: string, itemId: string): Promise<WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || row.status === 'deleted') return fail(404, 'NOT_FOUND', '条目不存在');
  if (row.owner_id !== userId) return fail(403, 'FORBIDDEN', '仅作者可删除');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE workshop_items SET status = 'deleted', deleted_at = ?, updated_at = ?, data_json = '{}', data_size = 0, search_text = '' WHERE id = ?").bind(now, now, itemId),
    env.DB.prepare('DELETE FROM workshop_versions WHERE item_id = ?').bind(itemId),
    env.DB.prepare('DELETE FROM workshop_favorites WHERE item_id = ?').bind(itemId),
  ]);
  return { status: 200, body: { ok: true } };
}

// —— 评分、收藏、举报 ——

async function interactiveRow(env: Bindings, itemId: string): Promise<WorkshopItemRow | WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || !isInstallable(row)) return fail(404, 'NOT_FOUND', '条目不存在');
  return row;
}

function recountRatings(env: Bindings, itemId: string) {
  return env.DB.prepare(
    `UPDATE workshop_items SET
       rating_count = (SELECT COUNT(*) FROM workshop_ratings WHERE item_id = ?),
       rating_sum = (SELECT COALESCE(SUM(score), 0) FROM workshop_ratings WHERE item_id = ?)
     WHERE id = ?`,
  ).bind(itemId, itemId, itemId);
}

export async function rateItem(env: Bindings, userId: string, itemId: string, score: unknown): Promise<WorkshopResult> {
  const value = Number(score);
  if (!Number.isInteger(value) || value < 1 || value > 5) return fail(400, 'INVALID_SCORE', '评分必须是 1 到 5 的整数');
  const row = await interactiveRow(env, itemId);
  if (isResult(row)) return row;
  if (row.owner_id === userId) return fail(403, 'SELF_RATING', '不能给自己的作品评分');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workshop_ratings (item_id, user_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id, user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
    ).bind(itemId, userId, value, now, now),
    recountRatings(env, itemId),
  ]);
  const updated = await getRow(env, itemId);
  return { status: 200, body: { ok: true, rating: value, ratingCount: updated?.rating_count ?? 0, ratingAverage: updated ? toPublic(updated).ratingAverage : null } };
}

export async function clearRating(env: Bindings, userId: string, itemId: string): Promise<WorkshopResult> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM workshop_ratings WHERE item_id = ? AND user_id = ?').bind(itemId, userId),
    recountRatings(env, itemId),
  ]);
  return { status: 200, body: { ok: true } };
}

export async function setFavorite(env: Bindings, userId: string, itemId: string, favorite: boolean): Promise<WorkshopResult> {
  if (favorite) {
    const row = await interactiveRow(env, itemId);
    if (isResult(row)) return row;
  }
  await env.DB.batch([
    favorite
      ? env.DB.prepare('INSERT OR IGNORE INTO workshop_favorites (item_id, user_id, created_at) VALUES (?, ?, ?)').bind(itemId, userId, Date.now())
      : env.DB.prepare('DELETE FROM workshop_favorites WHERE item_id = ? AND user_id = ?').bind(itemId, userId),
    env.DB.prepare('UPDATE workshop_items SET favorite_count = (SELECT COUNT(*) FROM workshop_favorites WHERE item_id = ?) WHERE id = ?').bind(itemId, itemId),
  ]);
  return { status: 200, body: { ok: true, favorited: favorite } };
}

export async function reportItem(env: Bindings, userId: string, itemId: string, reason: unknown, detail: unknown): Promise<WorkshopResult> {
  if (typeof reason !== 'string' || !(WORKSHOP_REPORT_REASONS as readonly string[]).includes(reason)) return fail(400, 'INVALID_REASON', '请选择举报理由');
  const row = await interactiveRow(env, itemId);
  if (isResult(row)) return row;
  if (row.owner_id === userId) return fail(403, 'SELF_REPORT', '不能举报自己的作品');
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO workshop_reports (id, item_id, reporter_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(crypto.randomUUID(), itemId, userId, reason as WorkshopReportReason, cleanText(detail, WORKSHOP_LIMITS.reportDetail) || null, Date.now()).run();
  if (Number(inserted.meta?.changes ?? 0) === 0) return fail(409, 'ALREADY_REPORTED', '你已举报过该条目，管理员处理前不能重复举报');
  const open = await env.DB.prepare("SELECT COUNT(DISTINCT reporter_id) AS c FROM workshop_reports WHERE item_id = ? AND status = 'open'").bind(itemId).first<{ c: number }>();
  const hidden = (open?.c ?? 0) >= WORKSHOP_LIMITS.autoHideReports;
  if (hidden) await env.DB.prepare("UPDATE workshop_items SET status = 'hidden' WHERE id = ? AND status IN ('published', 'unlisted')").bind(itemId).run();
  return { status: 201, body: { ok: true, hidden } };
}

// —— 管理 ——

export function isWorkshopAdmin(env: Bindings, userId: string | undefined): boolean {
  if (!userId) return false;
  return (env.WORKSHOP_ADMIN_IDS || '').split(',').map(value => value.trim()).filter(Boolean).includes(userId);
}

export async function listReports(env: Bindings, status: unknown): Promise<WorkshopReportRecord[]> {
  const wanted = status === 'resolved' || status === 'dismissed' ? status : 'open';
  const rows = await env.DB.prepare(
    `SELECT r.*, w.title AS item_title FROM workshop_reports r LEFT JOIN workshop_items w ON w.id = r.item_id
     WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`,
  ).bind(wanted).all<{ id: string; item_id: string; item_title: string | null; reporter_id: string; reason: WorkshopReportReason; detail: string | null; status: WorkshopReportRecord['status']; created_at: number; resolved_at: number | null; resolution_note: string | null }>();
  return (rows.results || []).map(row => ({
    id: row.id, itemId: row.item_id, itemTitle: row.item_title || '（已不存在）', reporterId: row.reporter_id, reason: row.reason,
    detail: row.detail, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at, resolutionNote: row.resolution_note,
  }));
}

/** 处理举报：dismiss 驳回；resolve 认定属实，可同时下架条目。 */
export async function resolveReport(env: Bindings, adminId: string, reportId: string, action: unknown, note: unknown, hideItem: unknown): Promise<WorkshopResult> {
  if (action !== 'dismiss' && action !== 'resolve') return fail(400, 'INVALID_ACTION', 'action 只能是 dismiss 或 resolve');
  const report = await env.DB.prepare('SELECT * FROM workshop_reports WHERE id = ?').bind(reportId).first<{ id: string; item_id: string; status: string }>();
  if (!report) return fail(404, 'NOT_FOUND', '举报不存在');
  const now = Date.now();
  const statements = [env.DB.prepare('UPDATE workshop_reports SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?')
    .bind(action === 'dismiss' ? 'dismissed' : 'resolved', now, adminId, cleanText(note, 500) || null, reportId)];
  if (action === 'resolve' && hideItem === true) {
    statements.push(env.DB.prepare("UPDATE workshop_items SET status = 'hidden', updated_at = ? WHERE id = ? AND status != 'deleted'").bind(now, report.item_id));
  }
  await env.DB.batch(statements);
  return { status: 200, body: { ok: true } };
}

export async function adminUpdateItem(env: Bindings, itemId: string, input: { featured?: unknown; status?: unknown }): Promise<WorkshopResult> {
  const row = await getRow(env, itemId);
  if (!row || row.status === 'deleted') return fail(404, 'NOT_FOUND', '条目不存在');
  if (input.status !== undefined && input.status !== 'published' && input.status !== 'hidden') return fail(400, 'INVALID_STATUS', '管理员只能把条目设为 published 或 hidden');
  const featured = input.featured === undefined ? Number(row.featured ?? 0) : input.featured === true ? 1 : 0;
  const status = (input.status as WorkshopStatus | undefined) ?? row.status;
  await env.DB.prepare('UPDATE workshop_items SET featured = ?, status = ? WHERE id = ?').bind(featured, status, itemId).run();
  return { status: 200, body: { ok: true, featured: featured === 1, status } };
}

// —— 安装计划 ——

/**
 * 在客户端动手前解析完整的依赖图。依赖按叶子在前的顺序返回，客户端按序安装即可。
 * 推荐内容只列出（附带是否可用），不会被当成依赖安装。
 */
export async function resolveInstallPlan(
  rootId: string,
  loadRow: (id: string) => Promise<WorkshopItemRow | null>,
): Promise<WorkshopInstallPlan> {
  const items: WorkshopItemSummary[] = [];
  const errors: WorkshopInstallPlanError[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();

  const visit = async (id: string, requiredBy?: string, requiredVersion?: string, optional = false): Promise<void> => {
    if (visiting.includes(id)) {
      errors.push({ code: 'CYCLE', id, requiredBy, requiredVersion, path: [...visiting, id] });
      return;
    }
    const row = await loadRow(id);
    if (!row) {
      if (!optional) errors.push({ code: 'MISSING', id, requiredBy, requiredVersion, path: [...visiting, id] });
      return;
    }
    if (!isInstallable(row)) {
      if (!optional) errors.push({ code: 'UNAVAILABLE', id, requiredBy, requiredVersion, status: row.status as WorkshopStatus, path: [...visiting, id] });
      return;
    }
    const actualVersion = normalizeVersion(row.version);
    if (requiredVersion && compareVersions(actualVersion, requiredVersion) < 0) {
      if (!optional) errors.push({ code: 'INCOMPATIBLE', id, requiredBy, requiredVersion, actualVersion, path: [...visiting, id] });
    }
    // 每条入边都要检查版本，即使节点已经经由另一条约束更弱的分支解析过。
    if (visited.has(id)) return;
    visiting.push(id);
    for (const dependency of parseJson<WorkshopDependency[]>(row.dependencies_json, [])) {
      await visit(dependency.id, id, dependency.version, dependency.optional === true);
    }
    visiting.pop();
    visited.add(id);
    items.push(toPublic(row));
  };

  const root = await loadRow(rootId);
  if (!root) return { ok: false, rootId, items: [], recommendations: [], errors: [{ code: 'MISSING', id: rootId, path: [rootId] }] };
  await visit(rootId);
  const recommendations: WorkshopRecommendation[] = [];
  for (const recommendation of parseJson<WorkshopDependency[]>(root.recommendations_json, [])) {
    const target = recommendation.id === rootId ? null : await loadRow(recommendation.id);
    const available = Boolean(target && isInstallable(target));
    recommendations.push({
      ...recommendation,
      available,
      ...(target && available ? {
        title: target.title,
        type: recommendation.type ?? (target.content_type || target.type) as WorkshopItemType,
        currentVersion: normalizeVersion(target.version),
      } : {}),
    });
  }
  return { ok: errors.length === 0, rootId, items, recommendations, errors };
}
