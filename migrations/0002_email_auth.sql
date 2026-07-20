-- 0002_email_auth.sql — 邮箱验证码登录
-- 重建 users 表（去掉 OAuth 字段，改为纯邮箱登录）

-- 验证码表
CREATE TABLE IF NOT EXISTS email_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);

-- 重建 users 表：去掉 provider/provider_user_id/avatar_url，改为纯邮箱
-- SQLite 不支持 DROP COLUMN（< 3.35），这里用新建表 + 迁移
CREATE TABLE IF NOT EXISTS users_new (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  username   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 迁移已有数据（如果有）
INSERT OR IGNORE INTO users_new (id, email, username, created_at)
SELECT id, COALESCE(email, ''), username, created_at FROM users WHERE email IS NOT NULL AND email != '';

-- 替换旧表
DROP TABLE IF EXISTS users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
