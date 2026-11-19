/**
 * types.ts — 跨模块共享类型与 Cloudflare 绑定声明。
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { WorkshopAssetType } from '../workshopCatalog';
import type { WorkshopDependency, WorkshopItemSummary, WorkshopStatus } from '../workshop/protocol';

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
  /** 创意工坊管理员的用户 id，逗号分隔（处理举报、设精选）。 */
  WORKSHOP_ADMIN_IDS?: string;
}

export type WorkshopItemType = WorkshopAssetType;

export type { WorkshopDependency };

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
  display_name?: string | null;
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

/** workshop_items 表行（0010 起 type 即真实类型；content_type 只出现在迁移前的旧行里）。 */
export interface WorkshopItemRow {
  id: string;
  owner_id: string;
  type: WorkshopItemType;
  content_type?: string | null;
  content_id?: string | null;
  version?: string | null;
  title: string;
  description: string | null;
  changelog?: string | null;
  tags: string | null;
  data_json: string;
  data_size?: number | null;
  status: WorkshopStatus | "draft";
  download_count: number;
  favorite_count?: number | null;
  rating_count?: number | null;
  rating_sum?: number | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  category?: string | null;
  dependencies_json?: string | null;
  min_app_version?: string | null;
  compatibility_json?: string | null;
  featured?: number | null;
  screenshots_json?: string | null;
  recommendations_json?: string | null;
  search_text?: string | null;
  /** LEFT JOIN users.display_name。 */
  author_name?: string | null;
}

/** 对外暴露的工坊条目。 */
export type WorkshopItemPublic = WorkshopItemSummary;

/** 对外暴露的用户信息。 */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  displayName?: string | null;
  workshopAdmin?: boolean;
}
