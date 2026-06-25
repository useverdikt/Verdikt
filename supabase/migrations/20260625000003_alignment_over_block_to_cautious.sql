-- Rename the production alignment label OVER_BLOCK -> CAUTIOUS.
--
-- The alignment column is plain text (no enum constraint), so the rename is a
-- data update of existing rows plus code that now writes/reads "CAUTIOUS".
--
-- Internal storage column names (over_block_suggestions_json,
-- over_block_rate_pct) are intentionally left as-is to avoid a wide schema
-- rename; only the user-facing alignment value changes.
--
-- Idempotent: safe to re-run; the WHERE clause matches nothing on a second run.

UPDATE outcome_alignments
SET alignment = 'CAUTIOUS',
    updated_at = COALESCE(updated_at, NOW()::text)
WHERE alignment = 'OVER_BLOCK';
