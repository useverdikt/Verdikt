-- Hot-path timestamp columns used in remediation debt, VCS monitor, and release ordering.
-- Converts TEXT ISO-8601 values to native TIMESTAMPTZ for index-friendly comparisons.

ALTER TABLE releases
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(created_at), '')::timestamptz,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(updated_at), '')::timestamptz,
  ALTER COLUMN collection_deadline TYPE TIMESTAMPTZ USING NULLIF(TRIM(collection_deadline), '')::timestamptz,
  ALTER COLUMN verdict_issued_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(verdict_issued_at), '')::timestamptz,
  ALTER COLUMN shipped_without_certification_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(shipped_without_certification_at), '')::timestamptz;

ALTER TABLE vcs_monitoring_windows
  ALTER COLUMN monitoring_start TYPE TIMESTAMPTZ USING NULLIF(TRIM(monitoring_start), '')::timestamptz,
  ALTER COLUMN monitoring_end TYPE TIMESTAMPTZ USING NULLIF(TRIM(monitoring_end), '')::timestamptz,
  ALTER COLUMN last_scanned_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(last_scanned_at), '')::timestamptz,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(created_at), '')::timestamptz;

ALTER TABLE outcome_alignments
  ALTER COLUMN computed_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(computed_at), '')::timestamptz,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING NULLIF(TRIM(updated_at), '')::timestamptz;
