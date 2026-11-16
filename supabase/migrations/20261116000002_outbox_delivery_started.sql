-- Primary outbox delivery records when the network send starts, so a row whose
-- worker died mid-send is dead-lettered instead of being sent a second time.
ALTER TABLE outbound_effect_outbox
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;
