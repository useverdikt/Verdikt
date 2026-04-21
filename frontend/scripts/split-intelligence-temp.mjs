/**
 * One-off extractor: reads pages/IntelligencePage.jsx and writes intelligence/panels/*.jsx
 * Run from frontend/: node scripts/split-intelligence-temp.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const srcPath = path.join(root, "src/pages/IntelligencePage.jsx");
const outDir = path.join(root, "src/pages/intelligence/panels");
const lines = fs.readFileSync(srcPath, "utf8").split("\n");

function slice(a, b) {
  return lines.slice(a - 1, b).join("\n");
}

const commonImport = `import React, { useCallback, useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { authHeaders, resolveApiOrigin } from "../../lib/apiClient.js";
import { api, json } from "../api.js";
import { C, GRADE_COLOR, BAND_META } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Badge, Card, Spinner, EmptyState } from "../ui.jsx";
`;

const batches = [
  { file: "LoopReadinessPanel.jsx", start: 89, end: 245, header: commonImport },
  { file: "SignalReliabilityPanel.jsx", start: 249, end: 317, header: commonImport },
  { file: "CorrelationPanel.jsx", start: 321, end: 395, header: commonImport },
  { file: "OverrideAnalyticsPanel.jsx", start: 399, end: 498, header: commonImport },
  { file: "EnvChainPanel.jsx", start: 502, end: 612, header: commonImport },
  { file: "VcsPanel.jsx", start: 616, end: 692, header: commonImport },
  { file: "SsePanel.jsx", start: 696, end: 765, header: commonImport }
];

fs.mkdirSync(outDir, { recursive: true });

for (const { file, start, end, header } of batches) {
  let body = slice(start, end);
  body = body.replace(/^function /m, "export function ");
  fs.writeFileSync(path.join(outDir, file), header + "\n" + body + "\n");
}

// Production health: OutcomeCriteria + meta + panel
const prodBody =
  slice(1231, 1258) +
  "\n\n" +
  slice(769, 780) +
  "\n\n" +
  slice(782, 1081);
let prodOut = commonImport + "\n" + prodBody;
prodOut = prodOut.replace(/^function ProductionHealthPanel/m, "export function ProductionHealthPanel");
fs.writeFileSync(path.join(outDir, "ProductionHealthPanel.jsx"), prodOut);

// VCS monitor
let vcsMon = commonImport + "\n" + slice(1085, 1228).replace(/^function /m, "export function ");
fs.writeFileSync(path.join(outDir, "VcsMonitorPanel.jsx"), vcsMon);

// Threshold simulator
let thresh = commonImport + "\n" + slice(1262, 1401).replace(/^function /m, "export function ");
fs.writeFileSync(path.join(outDir, "ThresholdSimulatorPanel.jsx"), thresh);

console.log("Wrote panels to", outDir);
