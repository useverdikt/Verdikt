#!/usr/bin/env node
"use strict";

/**
 * Offline Verdikt verification. Reads JSON from disk — no database, no API.
 *
 *   node scripts/verdikt-verify.js <cert-bundle.json>
 *   node scripts/verdikt-verify.js chain <audit-export.json> [anchor.json]
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  verifyIndependentBundle,
  verifyAuditExportChain,
  verifyAnchorAgainstChain
} = require("../shared/independentVerify.cjs");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function fail(message, extra) {
  const out = extra ? { ok: false, error: message, ...extra } : { ok: false, error: message };
  process.stderr.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(1);
}

function ok(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Verify a Verdikt certificate or audit chain without contacting Verdikt.

Usage:
  verdikt-verify <cert-bundle.json>
  verdikt-verify chain <audit-export.json> [anchor.json]

The cert command checks:
  1. Ed25519 signature (HMAC records cannot be checked without Verdikt's secret)
  2. Frozen evidence hash (thresholds + signals)
  3. Engine replay: those inputs + this engine version = the recorded verdict

The chain command recomputes the hash chain. If an anchor file is supplied,
it also checks the signed tip and any external witness receipt.
`);
}

function main(argv) {
  const args = argv.slice(2).filter((a) => a !== "--json");
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(args.length ? 0 : 1);
  }

  if (args[0] === "chain") {
    const exportPath = args[1];
    const anchorPath = args[2];
    if (!exportPath) fail("usage: verdikt-verify chain <audit-export.json> [anchor.json]");
    const exported = readJson(path.resolve(exportPath));
    const events = Array.isArray(exported.events) ? exported.events : Array.isArray(exported) ? exported : [];
    const chain = verifyAuditExportChain(events, {
      expectedWorkspaceId: exported.workspace_id || null
    });
    let anchor = null;
    if (anchorPath) {
      const anchorDoc = readJson(path.resolve(anchorPath));
      const anchorBody = anchorDoc.anchor || anchorDoc;
      anchor = verifyAnchorAgainstChain(anchorBody, chain);
    } else if (exported.chain_anchor) {
      anchor = verifyAnchorAgainstChain(exported.chain_anchor, chain);
    }
    const payload = { ok: chain.valid && (!anchor || anchor.ok), chain, anchor };
    if (!payload.ok) fail("chain_verification_failed", payload);
    ok(payload);
    return;
  }

  const bundlePath = args[0];
  const bundle = readJson(path.resolve(bundlePath));
  const result = verifyIndependentBundle(bundle);
  if (!result.ok) fail("cert_verification_failed", result);
  ok(result);
}

main(process.argv);
