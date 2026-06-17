-- Frozen deployment-governance divergence: live in prod without cert-like status at merge time.

ALTER TABLE releases ADD COLUMN IF NOT EXISTS shipped_without_certification INTEGER NOT NULL DEFAULT 0;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS shipped_without_certification_at TEXT;

CREATE INDEX IF NOT EXISTS idx_releases_bypass_shipped
  ON releases (workspace_id, shipped_without_certification_at DESC)
  WHERE shipped_without_certification = 1;
