-- Frozen cert bundles + engine version for Ed25519 (and HMAC) records.
-- Existing hmac-sha256 rows stay valid; new columns are nullable.

ALTER TABLE cert_signatures
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS bundle_json TEXT,
  ADD COLUMN IF NOT EXISTS public_key_pem TEXT;
