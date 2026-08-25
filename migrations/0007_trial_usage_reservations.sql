-- 已部署的 0006 版本兼容迁移：将旧的计数视为已成功次数，新增并发预留计数。
ALTER TABLE trial_usage ADD COLUMN successful_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trial_usage ADD COLUMN reserved_count INTEGER NOT NULL DEFAULT 0;
UPDATE trial_usage SET successful_count = used_count WHERE successful_count = 0 AND used_count > 0;
