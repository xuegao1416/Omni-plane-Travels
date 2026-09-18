-- 每次免费体验请求使用独立租约，Worker 中断后可按 expires_at 回收。
--
-- 注：匿名免费体验功能已废弃（未接入免费上游），相关代码已移除；
-- 本表保留为空表、不再读写，无需删除。
CREATE TABLE IF NOT EXISTS trial_reservations (
  reservation_id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_reservations_identity_expiry
  ON trial_reservations(identity_key, expires_at);

-- 0007 中可能遗留没有租约明细的聚合预留；新表启用后将其视为已过期，避免永久占额。
UPDATE trial_usage SET reserved_count = 0;
