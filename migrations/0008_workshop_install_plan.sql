-- 0008_workshop_install_plan.sql - package versions and explicit world recommendations.
ALTER TABLE workshop_items ADD COLUMN version TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE workshop_items ADD COLUMN recommendations_json TEXT NOT NULL DEFAULT '[]';
