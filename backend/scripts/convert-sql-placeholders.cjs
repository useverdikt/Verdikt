"use strict";

/**
 * One-time codemod: SQLite-style ? → Postgres $1..$n in SQL string literals.
 * Run from repo root: node backend/scripts/convert-sql-placeholders.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOTS = [
  path.join(__dirname, "../src"),
  path.join(__dirname, "../test"),
  path.join(__dirname, "../scripts")
];

function isLikelySql(s) {
  return /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|VALUES|SET|RETURNING|JOIN|INTO|ON CONFLICT)\b/i.test(s);
}

function convertQuestionMarks(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function convertChunk(content) {
  let out = content.replace(/`((?:[^`\\]|\\.)*)`/gs, (match, inner) => {
    if (!/\?/.test(inner) || !isLikelySql(inner)) return match;
    return `\`${convertQuestionMarks(inner)}\``;
  });

  out = out.replace(/"((?:[^"\\]|\\.)*)"/g, (match, inner) => {
    if (!/\?/.test(inner) || !isLikelySql(inner)) return match;
    return `"${convertQuestionMarks(inner)}"`;
  });

  return out;
}

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (name.endsWith(".js")) files.push(p);
  }
  return files;
}

let changed = 0;
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (file.endsWith("convert-sql-placeholders.cjs")) continue;
    const before = fs.readFileSync(file, "utf8");
    const after = convertChunk(before);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed += 1;
      console.log("updated:", path.relative(process.cwd(), file));
    }
  }
}

console.log(`Done. ${changed} file(s) updated.`);
