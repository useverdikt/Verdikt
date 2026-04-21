-- Per-workspace HMAC secret for inbound webhooks (eval + release-promoted).
-- Value is AES-256-GCM ciphertext (see backend/src/lib/encryption.js).

CREATE TABLE IF NOT EXISTS workspace_inbound_webhook_secrets (
  workspace_id TEXT PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
