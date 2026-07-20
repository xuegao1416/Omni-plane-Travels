-- 0003_password_login.sql — 给 users 表加密码哈希字段
ALTER TABLE users ADD COLUMN password_hash TEXT;
