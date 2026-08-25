import { API_BASE_URL } from '../config/api';
import { STORAGE_KEYS } from '../config/storageKeys';
import type { ApiConfig } from './types';

export const TRIAL_API_CONFIG: ApiConfig = {
  apiKey: '',
  baseUrl: `${API_BASE_URL}/api/trial`,
  model: 'server-trial',
  provider: 'custom',
  stream: false,
  temperature: 0.8,
  maxTokens: 4096,
};

export function isTrialApiConfig(config: ApiConfig | null | undefined): boolean {
  return Boolean(config && config.apiKey === '' && config.baseUrl.replace(/\/+$/, '').endsWith('/api/trial'));
}

/** 桌面端没有同源 Cookie 时也能保持匿名设备额度。只保存随机 ID。 */
export function getTrialClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEYS.TRIAL_CLIENT_ID)?.trim();
    if (existing) return existing;
  } catch {
    // Storage 不可用时退回同源 HttpOnly Cookie。
  }
  return '';
}

export interface TrialStatus {
  ok: boolean;
  configured: boolean;
  limit: number;
  used: number;
  remaining: number;
  trialToken?: string;
}

export async function fetchTrialStatus(): Promise<TrialStatus> {
  const clientId = getTrialClientId();
  const response = await fetch(`${API_BASE_URL}/api/trial/status`, {
    credentials: 'include',
    headers: clientId ? { 'X-Trial-Client-Id': clientId } : undefined,
  });
  const payload = await response.json().catch(() => null) as Partial<TrialStatus> | null;
  if (response.status === 401 && clientId) {
    try { localStorage.removeItem(STORAGE_KEYS.TRIAL_CLIENT_ID); } catch {}
    return fetchTrialStatus();
  }
  if (!response.ok || !payload) throw new Error(typeof payload?.configured === 'boolean' ? '免费体验暂不可用' : `体验状态请求失败（${response.status}）`);
  if (typeof payload.trialToken === 'string' && payload.trialToken) {
    try { localStorage.setItem(STORAGE_KEYS.TRIAL_CLIENT_ID, payload.trialToken); } catch {}
  }
  return {
    ok: payload.ok === true,
    configured: payload.configured === true,
    limit: Number(payload.limit || 3),
    used: Number(payload.used || 0),
    remaining: Number(payload.remaining || 0),
    trialToken: typeof payload.trialToken === 'string' ? payload.trialToken : undefined,
  };
}
