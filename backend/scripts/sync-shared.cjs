"use strict";

/**
 * When the repo is cloned and npm install runs from `backend/`, copy monorepo `shared/`
 * next to `backend/` into `backend/shared/` so production resolves sharedPkg without /shared at fs root.
 */

const fs = require("fs");
const path = require("path");

const backendRoot = path.join(__dirname, "..");
const repoShared = path.join(backendRoot, "..", "shared");
const localShared = path.join(backendRoot, "shared");

if (!fs.existsSync(path.join(repoShared, "config.js"))) {
  process.exit(0);
}

fs.mkdirSync(localShared, { recursive: true });
fs.cpSync(repoShared, localShared, { recursive: true });
