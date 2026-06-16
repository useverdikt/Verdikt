-- Opt-in calibration auto-apply for design partners (default: suggest_only).
ALTER TABLE workspace_policies
  ADD COLUMN IF NOT EXISTS calibration_mode TEXT NOT NULL DEFAULT 'suggest_only';
