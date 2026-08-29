/**
 * types.ts — 跨模块共享类型与 Cloudflare 绑定声明。
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { WorkshopAssetType } from '../workshopCatalog';

export interface Bindings {
  /** D1 数据库（users / save_slots / workshop_items / sessions / email_codes）。 */
  DB: D1Database;
  /** 用于签名会话令牌的 HMAC 密钥（openssl rand -hex 32）。 */
  SESSION_SECRET: string;
  /** Brevo API Key（发验证码邮件）。 */
  BREVO_API_KEY: string;
  /** 发件人邮箱（必须是 Brevo 已验证的发件人）。 */
  EMAIL_FROM: string;
  /** 允许跨域（桌面端 Bearer）的 Origin 列表，逗号分隔。 */
  ALLOWED_ORIGINS?: string;
  /** 免费体验上游（仅服务端使用，绝不返回客户端）。 */
  TRIAL_LLM_BASE_URL?: string;
  TRIAL_LLM_API_KEY?: string;
  TRIAL_LLM_MODEL?: string;
  TRIAL_MAX_REQUESTS?: string;
  /** 匿名体验 token 签名密钥；未设置时回退 SESSION_SECRET。 */
  TRIAL_ID_SECRET?: string;
}

export type WorkshopItemType = WorkshopAssetType;

export interface WorkshopDependency {
  id: string;
  type?: WorkshopItemType;
  version?: string;
  optional?: boolean;
  reason?: string;
}

export interface SessionData {
  userId: string;
  clientType: 'web' | 'desktop';
  createdAt: number;
  expiresAt: number;
}

/** users 表行。 */
export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string | null;
  created_at: number;
}

/** save_slots 表行（存档 JSON 直接存 D1，不需要 R2）。 */
export interface SaveSlotRow {
  id: string;
  user_id: string;
  slot_index: number;
  version: number;
  generation: string;
  payload_json: string;
  payload_size: number;
  checksum: string;
  updated_at: number;
}

/** workshop_items 表行（所有数据存 JSON，不需要 R2）。 */
export interface WorkshopItemRow {
  id: string;
  owner_id: string;
  type: WorkshopItemType;
  content_type?: string | null;
  version?: string | null;
  title: string;
  description: string | null;
  tags: string | null;
  data_json: string;
  status: 'draft' | 'published' | 'archived';
  download_count: number;
  created_at: number;
  updated_at: number;
  category?: string | null;
  dependencies_json?: string | null;
  min_app_version?: string | null;
  compatibility_json?: string | null;
  featured?: number;
  screenshots_json?: string | null;
  recommendations_json?: string | null;
}

/** 对外暴露的工坊条目。 */
export interface WorkshopItemPublic {
  id: string;
  ownerId: string;
  type: WorkshopItemType;
  contentType?: string;
  version: string;
  title: string;
  description: string | null;
  tags: string[];
  downloadCount: number;
  createdAt: number;
  updatedAt: number;
  category?: string | null;
  dependencies: WorkshopDependency[];
  recommendations: WorkshopDependency[];
  minAppVersion?: string | null;
  compatibility: Record<string, unknown>;
  featured: boolean;
  screenshots: string[];
}

/** 对外暴露的用户信息。 */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
}
