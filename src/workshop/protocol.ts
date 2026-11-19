/**
 * protocol.ts — 创意工坊客户端与服务端共用的协议：条目结构、排序、状态、举报理由、版本号规则。
 *
 * 服务端（Cloudflare Worker，无 DOM）也会导入本文件，因此这里只能放纯类型与纯函数。
 */
import type { WorkshopAssetType } from '../workshopCatalog';

export const WORKSHOP_SORTS = ['latest', 'updated', 'downloads', 'rating', 'favorites', 'featured'] as const;
export type WorkshopSort = typeof WORKSHOP_SORTS[number];
export const WORKSHOP_SORT_LABELS: Record<WorkshopSort, string> = {
  latest: '最新发布',
  updated: '最近更新',
  downloads: '下载最多',
  rating: '评分最高',
  favorites: '收藏最多',
  featured: '编辑精选',
};

export function isWorkshopSort(value: unknown): value is WorkshopSort {
  return typeof value === 'string' && (WORKSHOP_SORTS as readonly string[]).includes(value);
}

/**
 * published 公开可见；unlisted 不进列表但凭链接/依赖可装；archived 停止新安装（已装的人仍可查到更新状态）；
 * hidden 由举报或管理员下架；deleted 为作者删除（软删除，依赖它的条目会得到明确的“已删除”提示）。
 */
export const WORKSHOP_STATUSES = ['published', 'unlisted', 'archived', 'hidden', 'deleted'] as const;
export type WorkshopStatus = typeof WORKSHOP_STATUSES[number];
/** 作者自己可以切换的状态。 */
export const OWNER_SETTABLE_STATUSES = ['published', 'unlisted', 'archived'] as const;
export type OwnerSettableStatus = typeof OWNER_SETTABLE_STATUSES[number];
export const WORKSHOP_STATUS_LABELS: Record<WorkshopStatus, string> = {
  published: '公开',
  unlisted: '不公开列出',
  archived: '已归档',
  hidden: '已被下架',
  deleted: '已删除',
};
/** 这些状态的条目可以下载安装（列表只显示 published）。 */
export const INSTALLABLE_STATUSES: readonly WorkshopStatus[] = ['published', 'unlisted'];

export const WORKSHOP_REPORT_REASONS = ['spam', 'offensive', 'copyright', 'malicious', 'broken', 'other'] as const;
export type WorkshopReportReason = typeof WORKSHOP_REPORT_REASONS[number];
export const WORKSHOP_REPORT_REASON_LABELS: Record<WorkshopReportReason, string> = {
  spam: '垃圾或广告',
  offensive: '冒犯或不适内容',
  copyright: '侵犯版权',
  malicious: '恶意内容（诱导、钓鱼等）',
  broken: '无法使用或数据损坏',
  other: '其他',
};

export const WORKSHOP_LIMITS = {
  title: 120,
  description: 4000,
  changelog: 2000,
  tags: 16,
  tagLength: 32,
  screenshots: 6,
  dependencies: 32,
  dataBytes: 1_048_576,
  /** 每个条目保留的历史版本数（含当前版本）。 */
  versionsKept: 10,
  pageSize: 50,
  reportDetail: 500,
  displayName: 32,
  searchTerms: 5,
  /** 不同举报者的待处理举报达到该数量时自动下架，等待管理员复核。 */
  autoHideReports: 5,
} as const;

export interface WorkshopDependency {
  /** 工坊条目 id（不是包内的世界/模块 id）。 */
  id: string;
  type?: WorkshopAssetType;
  version?: string;
  optional?: boolean;
  reason?: string;
}

export interface WorkshopAuthor {
  id: string;
  name: string;
}

export interface WorkshopItemSummary {
  id: string;
  ownerId: string;
  author: WorkshopAuthor;
  type: WorkshopAssetType;
  /** 旧客户端读取的字段，与 type 相同。 */
  contentType: WorkshopAssetType;
  /** 包内资产自己的 id（世界 id、模块 id、事件包 manifest.id 等），用于安装前查冲突。 */
  contentId: string | null;
  version: string;
  title: string;
  description: string | null;
  changelog: string | null;
  tags: string[];
  category: string | null;
  status: WorkshopStatus;
  downloadCount: number;
  favoriteCount: number;
  ratingCount: number;
  /** 1–5，保留一位小数；没人评分时为 null。 */
  ratingAverage: number | null;
  createdAt: number;
  updatedAt: number;
  dependencies: WorkshopDependency[];
  recommendations: WorkshopDependency[];
  minAppVersion: string | null;
  compatibility: Record<string, unknown>;
  featured: boolean;
  screenshots: string[];
  dataSize: number;
}

export interface WorkshopViewerState {
  isOwner: boolean;
  rating: number | null;
  favorited: boolean;
  reported: boolean;
}

export interface WorkshopItemDetail extends WorkshopItemSummary {
  data: unknown;
  viewer?: WorkshopViewerState;
}

export interface WorkshopListResponse {
  items: WorkshopItemSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkshopVersionInfo {
  version: string;
  changelog: string | null;
  createdAt: number;
  dataSize: number;
}

export interface WorkshopUpdateInfo {
  id: string;
  title: string;
  version: string;
  status: WorkshopStatus;
  updatedAt: number;
}

export type WorkshopInstallPlanErrorCode = 'MISSING' | 'INCOMPATIBLE' | 'CYCLE' | 'UNAVAILABLE';

export interface WorkshopInstallPlanError {
  code: WorkshopInstallPlanErrorCode;
  id: string;
  requiredBy?: string;
  requiredVersion?: string;
  actualVersion?: string;
  /** UNAVAILABLE 时说明原因：已删除 / 已归档 / 已下架。 */
  status?: WorkshopStatus;
  path: string[];
}

export interface WorkshopRecommendation extends WorkshopDependency {
  /** 推荐的条目当前是否可以安装。 */
  available?: boolean;
  title?: string;
  currentVersion?: string;
}

export interface WorkshopInstallPlan {
  ok: boolean;
  rootId: string;
  /** 依赖在前、根条目在最后，按此顺序安装即可保证依赖先就位。 */
  items: WorkshopItemSummary[];
  /** 推荐内容只列出，不会被当成依赖安装。 */
  recommendations: WorkshopRecommendation[];
  errors: WorkshopInstallPlanError[];
}

/** 下载接口的响应（沿用旧版 snake_case 字段，旧客户端可继续读取）。 */
export interface WorkshopDownload {
  id: string;
  type: WorkshopAssetType;
  version: string;
  title: string;
  description: string | null;
  tags: string[];
  data: unknown;
  download_count: number;
  created_at: number;
  updated_at: number;
  dependencies: WorkshopDependency[];
  recommendations: WorkshopDependency[];
  min_app_version: string | null;
  compatibility: Record<string, unknown>;
  screenshots: string[];
  changelog: string | null;
  content_id: string | null;
}

export interface WorkshopReportRecord {
  id: string;
  itemId: string;
  itemTitle: string;
  reporterId: string;
  reason: WorkshopReportReason;
  detail: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
}

// —— 版本号 ——

const VERSION_PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(VERSION_PATTERN);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isVersion(value: unknown): value is string {
  return parseVersion(value) !== null;
}

/** 规范化为 x.y.z；无效时返回 fallback。 */
export function normalizeVersion(value: unknown, fallback = '1.0.0'): string {
  const parsed = parseVersion(value);
  return parsed ? parsed.join('.') : fallback;
}

/** 按数字逐段比较（2.10.0 > 2.9.0）。无效版本按 0.0.0 处理。 */
export function compareVersions(left: unknown, right: unknown): number {
  const a = parseVersion(left) ?? [0, 0, 0];
  const b = parseVersion(right) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate: unknown, current: unknown): boolean {
  return isVersion(candidate) && compareVersions(candidate, current) > 0;
}

export function nextPatchVersion(value: unknown): string {
  const [major, minor, patch] = parseVersion(value) ?? [1, 0, -1];
  return `${major}.${minor}.${patch + 1}`;
}

/** 发布新版本时使用的版本号：请求的版本更高就用它，否则在当前版本上加一个补丁号。 */
export function resolvePublishVersion(requested: unknown, current: unknown): string {
  return isNewerVersion(requested, current) ? normalizeVersion(requested) : nextPatchVersion(current);
}

/** 已安装版本是否满足依赖声明（未声明版本时只要求已安装）。 */
export function satisfiesVersion(installed: unknown, required: unknown): boolean {
  if (!isVersion(required)) return true;
  return compareVersions(installed, required) >= 0;
}

/** 按本地已安装版本检查依赖（id → 版本）。可选依赖缺失不算问题。 */
export function checkInstalledDependencies(
  dependencies: readonly WorkshopDependency[],
  installed: Readonly<Record<string, string>>,
): { ok: boolean; missing: WorkshopDependency[]; incompatible: WorkshopDependency[] } {
  const missing: WorkshopDependency[] = [];
  const incompatible: WorkshopDependency[] = [];
  for (const dependency of dependencies) {
    const current = installed[dependency.id];
    if (!current) {
      if (!dependency.optional) missing.push(dependency);
      continue;
    }
    if (!satisfiesVersion(current, dependency.version)) incompatible.push(dependency);
  }
  return { ok: missing.length === 0 && incompatible.length === 0, missing, incompatible };
}

/** 包内资产自己的 id：世界/NPC/模块/冒险/主题取 data.id，事件包取 manifest.id，工作流取 workflow.id。 */
export function workshopContentId(type: WorkshopAssetType, data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const source = data as Record<string, unknown>;
  const pick = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null);
  if (type === 'event_pack') {
    const manifest = source.manifest && typeof source.manifest === 'object' ? source.manifest as Record<string, unknown> : source;
    return pick(manifest.id);
  }
  if (type === 'workflow_pack') {
    const manifest = source.manifest && typeof source.manifest === 'object' ? source.manifest as Record<string, unknown> : {};
    const workflow = source.workflow && typeof source.workflow === 'object' ? source.workflow as Record<string, unknown> : source;
    return pick(manifest.id) ?? pick(workflow.id);
  }
  return pick(source.id);
}
