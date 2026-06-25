-- Hardening follow-up (031–033 parity for Supabase CLI + backend migrations).
--
-- 1) Durable alignment enum via CHECK constraint (CAUTIOUS replaces OVER_BLOCK).
-- 2) Re-grant authenticated on all public tables/sequences — tables created after
--    025's one-time GRANT may otherwise lack PostgREST privileges.

ALTER TABLE outcome_alignments DROP CONSTRAINT IF EXISTS outcome_alignments_alignment_check;
ALTER TABLE outcome_alignments ADD CONSTRAINT outcome_alignments_alignment_check
  CHECK (alignment IS NULL OR alignment IN ('CORRECT', 'MISS', 'CAUTIOUS', 'UNKNOWN'));

DO $$
BEGIN
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'verdikt: skipping authenticated grants (insufficient privileges)';
END $$;
