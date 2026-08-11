-- Lease recovery index for multi-replica shadow outbox workers.

CREATE INDEX IF NOT EXISTS idx_outbound_effect_outbox_expired_claim
  ON outbound_effect_outbox (claimed_until, id)
  WHERE state = 'processing';
