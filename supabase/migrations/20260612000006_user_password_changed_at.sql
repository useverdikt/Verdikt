-- Paired with backend/migrations/postgres/008_user_password_changed_at.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Invalidate JWT sessions issued before the latest password change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;
