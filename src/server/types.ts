/**
 * types.ts — 跨模块共享类型与 Cloudflare 绑定声明。
 */

import type { D1Database } from '@cloudflare/workers-types';

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
}

export type WorkshopItemType = 'world_package' | 'character_preset' | 'npc_template' | 'history_preset';

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
  title: string;
  description: string | null;
  tags: string | null;
  data_json: string;
  status: 'draft' | 'published' | 'archived';
  download_count: number;
  created_at: number;
  updated_at: number;
}

/** 对外暴露的工坊条目。 */
export interface WorkshopItemPublic {
  id: string;
  ownerId: string;
  type: WorkshopItemType;
  title: string;
  description: string | null;
  tags: string[];
  downloadCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 对外暴露的用户信息。 */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
}
