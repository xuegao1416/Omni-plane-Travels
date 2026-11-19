/**
 * 后端 API 配置
 */

/**
 * 后端 API 基础 URL。网页版同源部署用相对路径；桌面版打包时用环境变量 OMNI_API_BASE
 * 指向已部署的站点（build.ts 会把它写进产物，见 docs/workshop-ops.md）。
 */
function readApiBase(): string {
  try {
    return String(process.env.OMNI_API_BASE || '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}
export const API_BASE_URL = readApiBase();

const AUTH_TOKEN_KEY = 'omni.auth.token.v1';

/** 桌面端登录返回的 Bearer 令牌（网页版用 HttpOnly Cookie，不会有值）。 */
export function getAuthToken(): string | null {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch { /* 存储不可用时只能依赖 Cookie */ }
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// API 端点
export const API_ENDPOINTS = {
  // 认证
  auth: {
    sendCode: `${API_BASE_URL}/api/auth/send-code`,
    register: `${API_BASE_URL}/api/auth/register`,
    login: `${API_BASE_URL}/api/auth/login`,
    resetPassword: `${API_BASE_URL}/api/auth/reset-password`,
    logout: `${API_BASE_URL}/api/auth/logout`,
    me: `${API_BASE_URL}/api/me`,
    profile: `${API_BASE_URL}/api/me/profile`,
  },
  // 云存档
  saves: {
    list: `${API_BASE_URL}/api/saves`,
    get: (slotId: number) => `${API_BASE_URL}/api/saves/${slotId}`,
    put: (slotId: number) => `${API_BASE_URL}/api/saves/${slotId}`,
    delete: (slotId: number) => `${API_BASE_URL}/api/saves/${slotId}`,
  },
  // 创意工坊（完整的请求封装见 src/workshop/api.ts）
  workshop: {
    root: `${API_BASE_URL}/api/workshop`,
  },
} as const;

// 请求配置
export const REQUEST_CONFIG = {
  credentials: 'include' as RequestCredentials,
  headers: {
    'Content-Type': 'application/json',
  },
};

// 辅助函数：带认证的请求
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...REQUEST_CONFIG,
    ...options,
    headers: { ...REQUEST_CONFIG.headers, ...authHeaders(), ...(options.headers as Record<string, string> | undefined) },
  });

  if (response.status === 401) {
    throw new Error('未授权');
  }

  return response;
}

// 辅助函数：解析 JSON 响应
export async function parseResponse<T>(response: Promise<Response>): Promise<T> {
  const res = await response;
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'UNKNOWN', message: '请求失败' }));
    throw new Error(error.message || '请求失败');
  }
  return res.json();
}
