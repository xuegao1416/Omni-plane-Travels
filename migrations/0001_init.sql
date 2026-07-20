-- 0001_init.sql — D1 初始表结构（依据 spec.md §5）
-- 执行：wrangler d1 migrations apply <DATABASE_NAME> --local   （本地）
--       wrangler d1 migrations apply <DATABASE_NAME> --remote  （生产）

-- 用户表：OAuth 身份（provider + provider_user_id 唯一）
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'discord')),
  provider_user_id  TEXT NOT NULL,
  username          TEXT NOT NULL,
  avatar_url        TEXT,
  email             TEXT,
  created_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_user_id);

-- 云存档槽位：每用户最多 2 槽（slot_index ∈ {1,2}），version 用于乐观并发
-- 存档 JSON 直接存 D1（≤1MB），不需要 R2
CREATE TABLE IF NOT EXISTS save_slots (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  slot_index      INTEGER NOT NULL CHECK (slot_index IN (1, 2)),
  version         INTEGER NOT NULL DEFAULT 1,
  generation      TEXT NOT NULL,              -- 客户端编辑会话标识(UUID)
  payload_json    TEXT NOT NULL,              -- 存档 JSON（≤1MB）
  payload_size    INTEGER NOT NULL DEFAULT 0, -- 字节数
  checksum        TEXT NOT NULL,              -- sha256(payload)
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_save_slots_user_slot ON save_slots(user_id, slot_index);
CREATE INDEX IF NOT EXISTS idx_save_slots_user ON save_slots(user_id);

-- 创意工坊条目：支持世界包、人物预设、NPC 模板、人生经历预设
-- 所有数据存 JSON（砍掉图片），不需要 R2
CREATE TABLE IF NOT EXISTS workshop_items (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('world_package', 'character_preset', 'npc_template', 'history_preset')),
  title             TEXT NOT NULL,
  description       TEXT,
  tags              TEXT,                    -- JSON 数组：["奇幻","魔法"]
  data_json         TEXT NOT NULL,           -- 完整数据 JSON（世界包/预设等）
  status            TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  download_count    INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workshop_type ON workshop_items(type);
CREATE INDEX IF NOT EXISTS idx_workshop_created ON workshop_items(created_at);
CREATE INDEX IF NOT EXISTS idx_workshop_owner ON workshop_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_workshop_status ON workshop_items(status, created_at);

-- 会话表：替代 KV 存会话（KV 免费额度 1000 写/日且最终一致，不适合会话）
-- 理由见 architecture.md：会话存 KV 会导致注销后旧会话跨区仍可能可用。
-- D1 无自动 TTL：MVP 靠 getSession 惰性删除过期行 + logout 删除；不引入定时清理。
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK (client_type IN ('web', 'desktop')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
