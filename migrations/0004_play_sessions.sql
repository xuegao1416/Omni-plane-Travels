-- 匿名游玩统计：仅保存随机会话 ID、时间、到达深度和粗粒度设备信息。
-- 不关联账号，不保存 IP、存档、对话或世界内容。

CREATE TABLE IF NOT EXISTS play_sessions (
  id              TEXT    PRIMARY KEY,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL CHECK(duration_ms >= 0 AND duration_ms <= 21600000),
  max_depth       TEXT    NOT NULL CHECK(max_depth IN ('home', 'lobby', 'events', 'wizard', 'game')),
  is_return       INTEGER NOT NULL CHECK(is_return IN (0, 1)),
  browser_family  TEXT    NOT NULL,
  screen_size     TEXT    NOT NULL,
  timezone        TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_started_at ON play_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_play_sessions_max_depth ON play_sessions(max_depth);
