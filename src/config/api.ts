/**
 * 后端 API 配置
 */

// 后端 API 基础 URL（同源部署时用相对路径）
export const API_BASE_URL = '';

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
  },
  // 云存档
  saves: {
    list: `${API_BASE_URL}/api/saves`,
    get: (slotId: number) => `${API_BASE_URL}/api/saves/${slotId}`,
    put: (slotId: number) => `${API_BASE_URL}/api/saves/${slotId}`,
    delete: (slotId: number) => `${API_BASE_URL}/api/saves/${slotId}`,
  },
  // 创意工坊
  workshop: {
    list: `${API_BASE_URL}/api/workshop`,
    get: (itemId: string) => `${API_BASE_URL}/api/workshop/${itemId}`,
    download: (itemId: string) => `${API_BASE_URL}/api/workshop/${itemId}/download`,
    create: `${API_BASE_URL}/api/workshop`,
    update: (itemId: string) => `${API_BASE_URL}/api/workshop/${itemId}`,
    delete: (itemId: string) => `${API_BASE_URL}/api/workshop/${itemId}`,
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
