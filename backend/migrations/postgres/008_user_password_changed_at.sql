-- Invalidate JWT sessions issued before the latest password change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;
