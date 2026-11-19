/**
 * 用户认证状态管理（邮箱 + 密码 / 验证码注册）
 */
import { create } from 'zustand';
import { API_ENDPOINTS, authHeaders, setAuthToken } from '../config/api';

export interface User {
  id: string;
  username: string;
  email: string;
  /** 创意工坊公开昵称；未设置时工坊显示“旅者·id 片段”。 */
  displayName?: string | null;
  /** 当前账号是否是创意工坊管理员（服务端 WORKSHOP_ADMIN_IDS）。 */
  workshopAdmin?: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  checkAuth: () => Promise<void>;
  sendCode: (email: string) => Promise<{ ok: boolean; message: string }>;
  register: (email: string, code: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  resetPassword: (email: string, code: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  setDisplayName: (displayName: string) => Promise<string | null>;
}

async function handleAuthResponse(res: Response): Promise<{ ok: boolean; error?: string; user?: User }> {
  const data = await res.json();
  if (res.ok && data.ok) {
    // 桌面端（Tauri）不走 Cookie，服务端把令牌放在响应体里。
    if (typeof data.token === 'string') setAuthToken(data.token);
    return { ok: true, user: data.user };
  }
  return { ok: false, error: data.message || '操作失败' };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  checkAuth: async () => {
    try {
      const response = await fetch(API_ENDPOINTS.auth.me, { credentials: 'include', headers: authHeaders() });
      if (response.ok) {
        const data = await response.json();
        set({ user: data.user, isAuthenticated: true, isLoading: false });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  sendCode: async (email: string) => {
    const res = await fetch(API_ENDPOINTS.auth.sendCode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '发送验证码失败');
    return data;
  },

  register: async (email, code, password) => {
    const res = await fetch(API_ENDPOINTS.auth.register, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, code, password }),
    });
    const result = await handleAuthResponse(res);
    if (result.ok && result.user) {
      set({ user: result.user, isAuthenticated: true });
    }
    return result;
  },

  login: async (email, password) => {
    const res = await fetch(API_ENDPOINTS.auth.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const result = await handleAuthResponse(res);
    if (result.ok && result.user) {
      set({ user: result.user, isAuthenticated: true });
    }
    return result;
  },

  resetPassword: async (email, code, password) => {
    const res = await fetch(API_ENDPOINTS.auth.resetPassword, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, code, password }),
    });
    const result = await handleAuthResponse(res);
    if (result.ok && result.user) {
      set({ user: result.user, isAuthenticated: true });
    }
    return result;
  },

  logout: async () => {
    try {
      await fetch(API_ENDPOINTS.auth.logout, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
    } catch {
      // 忽略错误，本地状态照样清理
    }
    setAuthToken(null);
    set({ user: null, isAuthenticated: false });
  },

  setDisplayName: async (displayName: string) => {
    const res = await fetch(API_ENDPOINTS.auth.profile, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      credentials: 'include',
      body: JSON.stringify({ displayName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '保存昵称失败');
    const saved = typeof data.displayName === 'string' ? data.displayName : null;
    set(state => ({ user: state.user ? { ...state.user, displayName: saved } : state.user }));
    return saved;
  },
}));
