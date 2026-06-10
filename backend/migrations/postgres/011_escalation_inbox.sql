-- Escalation inbox + workspace gate / notification policy.

CREATE TABLE IF NOT EXISTS escalation_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending_human_review',
  reason TEXT NOT NULL,
  blocking_signals_json TEXT NOT NULL DEFAULT '[]',
  attempted_fixes_json TEXT NOT NULL DEFAULT '[]',
  requested_by_type TEXT,
  requested_by_name TEXT,
  release_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  sla_due_at TEXT,
  sla_breached INTEGER NOT NULL DEFAULT 0,
  sla_reminder_sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_escalations_workspace_state
  ON escalation_requests (workspace_id, state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_escalations_release_pending
  ON escalation_requests (release_id, state)
  WHERE state = 'pending_human_review';

ALTER TABLE workspace_policies ADD COLUMN IF NOT EXISTS gate_mode TEXT NOT NULL DEFAULT 'default';
ALTER TABLE workspace_policies ADD COLUMN IF NOT EXISTS escalation_notify_email TEXT;
ALTER TABLE workspace_policies ADD COLUMN IF NOT EXISTS escalation_sla_hours INTEGER NOT NULL DEFAULT 24;
