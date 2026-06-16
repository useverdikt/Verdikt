/**
 * releaseDisplayUtils.js
 *
 * Pure display/formatting helpers for release presentation.
 * No React, no side-effects, no circular module dependencies.
 * Extracted from appMainLogic.js.
 */

import { C } from "../theme/tokens.js";

// ── Version display ────────────────────────────────────────────────────────────

export const formatReleaseDisplayName = (version) => {
  const v = String(version || "").trim();
  if (!v) return "—";
  const e2e = v.match(/^([\d.]+)-e2e-(\d+)$/);
  if (e2e) return `${e2e[1]} · ${e2e[2].slice(-6)}`;
  if (v.includes("·") || v.includes("•")) {
    const parts = v.split(/[·•]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      const sem = last.match(/(\d+\.\d+\.\d+)/);
      if (sem) return sem[1];
      if (last.length <= 16) return last;
      return last.length > 12 ? `${last.slice(0, 5)}…${last.slice(-5)}` : last;
    }
  }
  const semvers = v.match(/\d+\.\d+\.\d+/g);
  if (semvers && semvers.length) return semvers[semvers.length - 1];
  const longTail = v.match(/(\d{5,})$/);
  if (longTail) return `…${longTail[1].slice(-6)}`;
  if (v.length <= 18) return v;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
};

export function releaseVersionPrimarySecondary(version) {
  const raw = String(version || "").trim();
  if (!raw) return { primary: "—", secondary: null, fullTitle: "" };
  const m = raw.match(/^(v?\d+\.\d+\.\d+)/i);
  if (m) {
    const tail = raw.slice(m[0].length).replace(/^[\s·•\-–]+/, "").trim();
    return { primary: m[0], secondary: tail || null, fullTitle: raw };
  }
  return { primary: formatReleaseDisplayName(version), secondary: null, fullTitle: raw };
}

// ── Value / threshold formatting ───────────────────────────────────────────────

export const formatAiPct = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n))}%`;
};

export const formatDeltaBaselineVersionPill = (v) => {
  if (v == null || v === "") return null;
  const t = String(v).trim();
  if (!t) return null;
  return t.startsWith("v") ? t : `v${t}`;
};

// ── Intelligence source label ──────────────────────────────────────────────────

export const verdictIntelligenceSourceLine = (verdictIntel) => {
  const src = String(verdictIntel?.source || "");
  const model = String(verdictIntel?.model || "");
  const looksGemini =
    /gemini/i.test(src) ||
    /gemini/i.test(model) ||
    (/^assistive_/i.test(src) && !/deterministic/i.test(src));
  if (looksGemini) {
    return {
      label: "Source: Gemini-enriched",
      hint: "Verdict from rules; summary wording refined by the model.",
      shortLine: "Verdict from rules; summary wording may be model-polished."
    };
  }
  return {
    label: "Source: Deterministic",
    hint: "Verdict and brief from rules only (no LLM rewrite).",
    shortLine: "Rules-only verdict and brief (no LLM rewrite)."
  };
};

// ── Override justification scoring ────────────────────────────────────────────

export const scoreJustification = (text) => {
  const t = text.toLowerCase().trim();
  const len = t.length;
  const hasImpact =
    /user.?impact|no.?impact|low.?risk|isolated|contained|affect|users|customer|session|critical|urgent/.test(t);
  const hasMitigation =
    /monitor|watch|revert|rollback|hotfix|fix|patch|committed|will|plan|next.?release|follow.?up|feature.?flag/.test(t);
  const hasSpecific =
    /v\d|\d+\s*%|signal|sentry|datadog|test|e2e|regression|ticket|issue|pr\s*#|\d{3,}|toggle|flag/.test(t);
  const score = (hasImpact ? 1 : 0) + (hasMitigation ? 1 : 0) + (hasSpecific ? 1 : 0);
  if (len < 40 || score === 0)
    return { grade: "WEAK", color: C.red, note: "Too vague — add specific context about user impact, the risk, and any mitigation steps." };
  if (score <= 1 || len < 100)
    return { grade: "ACCEPTABLE", color: C.amber, note: "Adequate — a stronger record includes risk acknowledgement and a concrete mitigation commitment." };
  return { grade: "STRONG", color: C.green, note: "Well documented — this justification will hold up under audit review." };
};
