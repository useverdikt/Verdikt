"use strict";

/**
 * Static Express route-table extractor for auth audits.
 * Scans route source for app.(get|post|put|patch|delete)(path, ...middleware, handler).
 */

const fs = require("fs");
const path = require("path");

const METHOD_RE = /\bapp\.(get|post|put|patch|delete)\s*\(/gi;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let i = start + 1;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      out += source[i + 1] || "";
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { value: out, end: i + 1 };
    }
    out += ch;
    i += 1;
  }
  return null;
}

/**
 * @param {string} source
 * @param {string} fileRel
 * @returns {Array<{ method: string, path: string, file: string, hasAuth: boolean, hasHumanSession: boolean, middlewareText: string }>}
 */
function extractRoutesFromSource(source, fileRel) {
  const cleaned = stripComments(source);
  const routes = [];
  METHOD_RE.lastIndex = 0;
  let match;
  while ((match = METHOD_RE.exec(cleaned))) {
    const method = match[1].toUpperCase();
    let i = match.index + match[0].length;
    while (i < cleaned.length && /\s/.test(cleaned[i])) i += 1;

    const lit = readStringLiteral(cleaned, i);
    if (!lit) continue;

    const routePath = lit.value;
    const afterPath = cleaned.slice(lit.end, lit.end + 1200);
    const handlerMatch = afterPath.match(/,\s*(?:async\s*)?\(\s*req\b/);
    if (!handlerMatch) continue;

    const middlewareText = afterPath.slice(0, handlerMatch.index);
    routes.push({
      method,
      path: routePath,
      file: fileRel,
      hasAuth: /\bauthMiddleware\b/.test(middlewareText),
      hasHumanSession: /\brequireHumanSession\b/.test(middlewareText),
      middlewareText: middlewareText.replace(/\s+/g, " ").trim()
    });
  }
  return routes;
}

function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js") && entry.name !== "deps.js") {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} routesRoot absolute path to backend/src/routes
 */
function loadRouteTable(routesRoot) {
  const files = walkJsFiles(routesRoot);
  const routes = [];
  for (const abs of files) {
    const rel = path.relative(routesRoot, abs).split(path.sep).join("/");
    const source = fs.readFileSync(abs, "utf8");
    routes.push(...extractRoutesFromSource(source, rel));
  }
  return routes;
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

module.exports = {
  extractRoutesFromSource,
  loadRouteTable,
  routeKey,
  stripComments
};
