"use strict";

/**
 * Local mutation check: apply one textual mutation to a source file, run the
 * given test files, and report whether the suite caught it. Always restores
 * the original file.
 *
 *   node scripts/mutation-check.js <mutations.json>
 *
 * mutations.json: [{ "file": "...", "find": "...", "replace": "...", "tests": ["test/x.test.js"] }]
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const specs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const root = path.join(__dirname, "..");
let survived = 0;

for (const spec of specs) {
  const file = path.resolve(root, spec.file);
  const original = fs.readFileSync(file, "utf8");
  if (!original.includes(spec.find)) {
    console.log(`SKIP  ${spec.file}: pattern not found: ${spec.find}`);
    survived += 1;
    continue;
  }
  fs.writeFileSync(file, original.replace(spec.find, spec.replace));
  try {
    const res = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...spec.tests], {
      cwd: root,
      encoding: "utf8",
      env: process.env
    });
    const killed = res.status !== 0;
    if (!killed) survived += 1;
    console.log(`${killed ? "KILLED " : "SURVIVED"} ${spec.file}: ${spec.find} → ${spec.replace}`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

process.exitCode = survived ? 1 : 0;
