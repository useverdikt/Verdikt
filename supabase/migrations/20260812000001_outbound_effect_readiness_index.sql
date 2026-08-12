CREATE INDEX IF NOT EXISTS idx_outbound_effect_outbox_readiness
  ON outbound_effect_outbox (workspace_id, created_at DESC, effect_type, state);
