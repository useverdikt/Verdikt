"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Resolve `shared/config.js` for both layouts:
 * - Monorepo: repo root `shared/` (Railway/root or local `npm run start` from repo).
 * - Backend-only image: `backend/shared/` (copied by `scripts/sync-shared.cjs` on postinstall).
 */
const candidates = [
  path.join(__dirname, "..", "..", "..", "shared", "config.js"),
  path.join(__dirname, "..", "..", "shared", "config.js")
];

let loaded;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    loaded = require(p);
    break;
  }
}

if (!loaded) {
  throw new Error(
    `Cannot find shared/config.js. For Railway, either set the service root to the repository root ` +
      `(see railway.toml) or run install so backend/postinstall copies ../shared into backend/shared.\n` +
      `Tried:\n${candidates.map((c) => `  - ${c}`).join("\n")}`
  );
}

module.exports = loaded;
