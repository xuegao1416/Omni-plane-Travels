-- 0010_workshop_v3.sql — 创意工坊第三版：去掉旧 type CHECK、版本历史、评分、收藏、举报、下载去重、作者昵称。
-- 执行：wrangler d1 migrations apply <DATABASE_NAME> --local / --remote（见 docs/workshop-ops.md）
--
-- 旧表的 type 列带 CHECK（只允许 4 种），新类型只能伪装成 world_package 存进去、真实类型放在 content_type。
-- SQLite 不能删除 CHECK，所以这里新建表、拷贝数据、替换旧表。workshop_items 没有外键引用，替换是安全的。

CREATE TABLE workshop_items_v3 (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  type                 TEXT NOT NULL,
  content_id           TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  changelog            TEXT,
  tags                 TEXT NOT NULL DEFAULT '[]',
  data_json            TEXT NOT NULL,
  data_size            INTEGER NOT NULL DEFAULT 0,
  version              TEXT NOT NULL DEFAULT '1.0.0',
  status               TEXT NOT NULL DEFAULT 'published'
                         CHECK (status IN ('published', 'unlisted', 'archived', 'hidden', 'deleted')),
  category             TEXT,
  dependencies_json    TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  min_app_version      TEXT,
  compatibility_json   TEXT NOT NULL DEFAULT '{}',
  screenshots_json     TEXT NOT NULL DEFAULT '[]',
  featured             INTEGER NOT NULL DEFAULT 0,
  download_count       INTEGER NOT NULL DEFAULT 0,
  favorite_count       INTEGER NOT NULL DEFAULT 0,
  rating_count         INTEGER NOT NULL DEFAULT 0,
  rating_sum           INTEGER NOT NULL DEFAULT 0,
  search_text          TEXT NOT NULL DEFAULT '',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER
);

-- 旧数据：真实类型取 content_type；draft 视为不公开列出；人物预设/人生经历这两种私有类型一律下架。
INSERT INTO workshop_items_v3 (
  id, owner_id, type, content_id, title, description, changelog, tags, data_json, data_size, version, status,
  category, dependencies_json, recommendations_json, min_app_version, compatibility_json, screenshots_json,
  featured, download_count, favorite_count, rating_count, rating_sum, search_text, created_at, updated_at, deleted_at
)
SELECT
  id,
  owner_id,
  COALESCE(content_type, type),
  CASE WHEN json_valid(data_json) THEN COALESCE(
    json_extract(data_json, '$.manifest.id'),
    json_extract(data_json, '$.workflow.id'),
    json_extract(data_json, '$.id')
  ) END,
  title,
  description,
  NULL,
  COALESCE(tags, '[]'),
  data_json,
  length(CAST(data_json AS BLOB)),
  COALESCE(version, '1.0.0'),
  CASE
    WHEN COALESCE(content_type, type) IN ('character_preset', 'history_preset') THEN 'hidden'
    WHEN status = 'draft' THEN 'unlisted'
    ELSE status
  END,
  category,
  COALESCE(dependencies_json, '[]'),
  COALESCE(recommendations_json, '[]'),
  min_app_version,
  COALESCE(compatibility_json, '{}'),
  COALESCE(screenshots_json, '[]'),
  COALESCE(featured, 0),
  download_count,
  0, 0, 0,
  lower(title || ' ' || COALESCE(description, '') || ' ' || COALESCE(tags, '')),
  created_at,
  updated_at,
  NULL
FROM workshop_items;

DROP TABLE workshop_items;
ALTER TABLE workshop_items_v3 RENAME TO workshop_items;

CREATE INDEX IF NOT EXISTS idx_workshop_list ON workshop_items(status, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_updated ON workshop_items(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_downloads ON workshop_items(status, download_count DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_featured ON workshop_items(status, featured DESC, download_count DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_owner ON workshop_items(owner_id, updated_at DESC);

-- 版本历史：每次发布新版本写一行（主表的 data_json 始终等于最新版本）。服务端只保留最近若干个版本。
CREATE TABLE IF NOT EXISTS workshop_versions (
  item_id              TEXT NOT NULL,
  version              TEXT NOT NULL,
  changelog            TEXT,
  data_json            TEXT NOT NULL,
  data_size            INTEGER NOT NULL DEFAULT 0,
  dependencies_json    TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  min_app_version      TEXT,
  compatibility_json   TEXT NOT NULL DEFAULT '{}',
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (item_id, version)
);
INSERT OR IGNORE INTO workshop_versions (
  item_id, version, changelog, data_json, data_size, dependencies_json, recommendations_json,
  min_app_version, compatibility_json, created_at
)
SELECT id, version, NULL, data_json, data_size, dependencies_json, recommendations_json,
       min_app_version, compatibility_json, updated_at
FROM workshop_items;

CREATE TABLE IF NOT EXISTS workshop_ratings (
  item_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS workshop_favorites (
  item_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workshop_favorites_user ON workshop_favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workshop_reports (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL,
  reporter_id     TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('spam', 'offensive', 'copyright', 'malicious', 'broken', 'other')),
  detail          TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER,
  resolved_by     TEXT,
  resolution_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_reports_open ON workshop_reports(item_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_workshop_reports_status ON workshop_reports(status, created_at DESC);

-- 下载去重：同一用户/设备对同一条目每天只计一次。只存不可逆的摘要，不存 IP 原文。
CREATE TABLE IF NOT EXISTS workshop_download_marks (
  item_id    TEXT NOT NULL,
  client_key TEXT NOT NULL,
  day        INTEGER NOT NULL,
  PRIMARY KEY (item_id, client_key, day)
);
CREATE INDEX IF NOT EXISTS idx_workshop_download_marks_day ON workshop_download_marks(day);

-- 作者昵称：公开展示用。没有设置时显示“旅者”加 id 片段，不会暴露邮箱前缀。
ALTER TABLE users ADD COLUMN display_name TEXT;
