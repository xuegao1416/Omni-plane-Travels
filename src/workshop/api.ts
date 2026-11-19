/**
 * api.ts — 创意工坊 HTTP 客户端。所有错误都抛 WorkshopApiError，带服务端的错误码和中文说明，界面直接展示。
 */
import { API_BASE_URL, authHeaders } from '../config/api';
import type { PublicWorkshopType } from '../workshopCatalog';
import type {
  OwnerSettableStatus,
  WorkshopDependency,
  WorkshopDownload,
  WorkshopInstallPlan,
  WorkshopItemDetail,
  WorkshopItemSummary,
  WorkshopListResponse,
  WorkshopReportReason,
  WorkshopReportRecord,
  WorkshopSort,
  WorkshopUpdateInfo,
  WorkshopVersionInfo,
} from './protocol';

export class WorkshopApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WorkshopApiError';
  }
}

const CLIENT_ID_KEY = 'omni.workshop.client.v1';

/** 匿名下载去重用的随机设备 id（不含任何个人信息）。 */
function clientId(): string | null {
  try {
    let value = localStorage.getItem(CLIENT_ID_KEY);
    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, value);
    }
    return value;
  } catch {
    return null;
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: '请先登录',
  403: '没有权限执行该操作',
  404: '条目不存在或已下架',
  409: '内容已变化，请刷新后重试',
  410: '该条目已不再提供安装',
  413: '内容超过 1MB 限制',
};

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const id = clientId();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/workshop${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(id ? { 'x-workshop-client': id } : {}),
        ...authHeaders(),
        ...(headers as Record<string, string> | undefined),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new WorkshopApiError(0, 'NETWORK', '无法连接创意工坊服务器，请检查网络');
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  // 安装计划在 409 时也带着完整结构，交给调用方判断 ok。
  if (!response.ok && !(response.status === 409 && body && 'rootId' in body)) {
    const code = typeof body?.error === 'string' ? body.error : `HTTP_${response.status}`;
    const message = typeof body?.message === 'string' ? body.message : FALLBACK_MESSAGES[response.status] ?? `请求失败（${response.status}）`;
    throw new WorkshopApiError(response.status, code, message, body ?? {});
  }
  return body as T;
}

export interface WorkshopListQuery {
  type?: PublicWorkshopType;
  q?: string;
  tag?: string;
  author?: string;
  sort?: WorkshopSort;
  page?: number;
  pageSize?: number;
}

export interface WorkshopPublishInput {
  type: PublicWorkshopType;
  title: string;
  description?: string | null;
  changelog?: string | null;
  tags?: string[];
  version?: string;
  category?: string | null;
  data: unknown;
  dependencies?: WorkshopDependency[];
  recommendations?: WorkshopDependency[];
  minAppVersion?: string | null;
  compatibility?: Record<string, unknown>;
  screenshots?: string[];
  status?: 'published' | 'unlisted';
}

export type WorkshopUpdateInput = Partial<Omit<WorkshopPublishInput, 'type' | 'status'>> & { expectedVersion?: string };

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const item = (id: string) => `/${encodeURIComponent(id)}`;

export const workshopApi = {
  list: (params: WorkshopListQuery = {}) => request<WorkshopListResponse>(query({ ...params })),
  get: (id: string) => request<{ item: WorkshopItemDetail }>(item(id)).then(body => body.item),
  plan: (id: string) => request<WorkshopInstallPlan>(`${item(id)}/install-plan`),
  versions: (id: string) => request<{ versions: WorkshopVersionInfo[] }>(`${item(id)}/versions`).then(body => body.versions),
  download: (id: string, version?: string) => request<WorkshopDownload>(`${item(id)}/download${query({ version })}`),
  updates: (ids: readonly string[]) => (ids.length
    ? request<{ items: WorkshopUpdateInfo[] }>(`/updates${query({ ids: ids.join(',') })}`).then(body => body.items)
    : Promise.resolve([] as WorkshopUpdateInfo[])),
  mine: () => request<{ items: WorkshopItemSummary[] }>('/mine').then(body => body.items),
  favorites: () => request<{ items: WorkshopItemSummary[] }>('/favorites').then(body => body.items),
  create: (input: WorkshopPublishInput) => request<{ id: string; version: string; status: string }>('', { method: 'POST', json: input }),
  update: (id: string, input: WorkshopUpdateInput) => request<{ ok: true; version: string; newVersion: boolean }>(item(id), { method: 'PUT', json: input }),
  setStatus: (id: string, status: OwnerSettableStatus) => request<{ ok: true; status: OwnerSettableStatus }>(`${item(id)}/status`, { method: 'PATCH', json: { status } }),
  remove: (id: string) => request<{ ok: true }>(item(id), { method: 'DELETE' }),
  rate: (id: string, score: number) => request<{ ok: true; rating: number; ratingCount: number; ratingAverage: number | null }>(`${item(id)}/rating`, { method: 'PUT', json: { score } }),
  clearRating: (id: string) => request<{ ok: true }>(`${item(id)}/rating`, { method: 'DELETE' }),
  favorite: (id: string, on: boolean) => request<{ ok: true; favorited: boolean }>(`${item(id)}/favorite`, { method: on ? 'PUT' : 'DELETE' }),
  report: (id: string, reason: WorkshopReportReason, detail?: string) => request<{ ok: true; hidden: boolean }>(`${item(id)}/report`, { method: 'POST', json: { reason, detail } }),
  admin: {
    reports: (status: 'open' | 'resolved' | 'dismissed' = 'open') => request<{ reports: WorkshopReportRecord[] }>(`/admin/reports${query({ status })}`).then(body => body.reports),
    resolveReport: (reportId: string, action: 'dismiss' | 'resolve', options: { note?: string; hideItem?: boolean } = {}) =>
      request<{ ok: true }>(`/admin/reports/${encodeURIComponent(reportId)}`, { method: 'POST', json: { action, ...options } }),
    updateItem: (id: string, patch: { featured?: boolean; status?: 'published' | 'hidden' }) =>
      request<{ ok: true; featured: boolean; status: string }>(`/admin/items/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch }),
  },
};

export type WorkshopApi = typeof workshopApi;

export function describeWorkshopError(error: unknown): string {
  if (error instanceof WorkshopApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '操作失败，请稍后重试';
}
