#!/usr/bin/env node
/**
 * Re-run canonical demo user seeds against the configured PostgreSQL database.
 * Use when login fails after an upgrade: `npm run seed:demos` from backend/
 */
"use strict";

require("../src/config");
const { initDatabase } = require("../src/database");
const { seedDemoUser, seedScreenshotsGalleryUser } = require("../src/bootstrap/seed");

(async () => {
  await initDatabase();
  await seedDemoUser();
  await seedScreenshotsGalleryUser();
  console.log("Demo users ensured: demo@verdikt.local, screenshots@verdikt.local (password: demo123)");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
