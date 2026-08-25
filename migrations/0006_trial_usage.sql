-- 匿名免费体验额度。identity_key 只保存随机设备/会话标识或已登录用户 ID，
-- 不保存消息、IP、模型内容或 API 密钥。
CREATE TABLE IF NOT EXISTS trial_usage (
  identity_key TEXT PRIMARY KEY,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_usage_updated_at ON trial_usage(updated_at);
