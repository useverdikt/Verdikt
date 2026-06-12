"use strict";

const { queryOne } = require("../database");
const { evaluateReleaseAfterSignalIngest } = require("./domain");

function extractIdempotencyKey(req, fallbackKeys = []) {
  const header = req.headers?.["x-idempotency-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const bodyKey = req.body?.idempotency_key;
  if (typeof bodyKey === "string" && bodyKey.trim()) return bodyKey.trim();
  for (const key of fallbackKeys) {
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  return null;
}

async function countSignalsForIdempotencyKey(releaseId, idempotencyKey) {
  if (!idempotencyKey) return 0;
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM signals WHERE release_id = ? AND idempotency_key = ?",
    [releaseId, idempotencyKey]
  );
  return Number(row?.c ?? 0);
}

async function respondToDuplicateSignalIngest(release, releaseId, source, idempotencyKey) {
  const fresh = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;
  const out = await evaluateReleaseAfterSignalIngest(fresh, releaseId, source, 0);
  return { ...out, duplicate: true, idempotency_key: idempotencyKey };
}

module.exports = {
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  respondToDuplicateSignalIngest
};
