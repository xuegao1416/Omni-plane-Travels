-- 0005_workshop_v2.sql - richer workshop metadata, backwards compatible with legacy rows.
ALTER TABLE workshop_items ADD COLUMN content_type TEXT;
ALTER TABLE workshop_items ADD COLUMN category TEXT;
ALTER TABLE workshop_items ADD COLUMN dependencies_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE workshop_items ADD COLUMN min_app_version TEXT;
ALTER TABLE workshop_items ADD COLUMN compatibility_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workshop_items ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workshop_items ADD COLUMN screenshots_json TEXT NOT NULL DEFAULT '[]';

UPDATE workshop_items SET content_type = type WHERE content_type IS NULL;
CREATE INDEX IF NOT EXISTS idx_workshop_content_type ON workshop_items(content_type);
CREATE INDEX IF NOT EXISTS idx_workshop_category ON workshop_items(category);
CREATE INDEX IF NOT EXISTS idx_workshop_featured ON workshop_items(featured, download_count DESC);
