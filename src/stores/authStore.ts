/**
 * 用户认证状态管理（邮箱 + 密码 / 验证码注册）
 */
import { create } from 'zustand';
import { API_ENDPOINTS, fetchWithAuth } from '../config/api';

export interface User {
  id: string;
  username: string;
  email: string;
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
}

async function handleAuthResponse(res: Response): Promise<{ ok: boolean; error?: string; user?: User }> {
  const data = await res.json();
  if (res.ok && data.ok) {
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
      const response = await fetch(API_ENDPOINTS.auth.me, { credentials: 'include' });
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
      });
    } catch {
      // 忽略错误，本地状态照样清理
    }
    set({ user: null, isAuthenticated: false });
  },
}));
