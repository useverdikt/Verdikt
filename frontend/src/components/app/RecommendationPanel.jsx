import React, { useEffect, useState } from "react";
import { C } from "../../theme/tokens.js";
import { apiFetchInit, resolveApiOrigin } from "../../lib/apiClient.js";
import { BoldMarkdownText } from "../../lib/safeRichText.jsx";

// ─── Verdict config ───────────────────────────────────────────────────────────

const VERDICT_META = {
  CERTIFIED: {
    label: "CERTIFIED",
    color: C.green,
    icon: "⊕",
    bg: "rgba(16,185,129,0.07)",
    border: "rgba(16,185,129,0.2)"
  },
  CERTIFIED_WITH_RISK: {
    label: "CERTIFIED · WITH RISK",
    color: "#f59e0b",
    icon: "⚠",
    bg: "rgba(245,158,11,0.07)",
    border: "rgba(245,158,11,0.2)"
  },
  UNCERTIFIED: {
    label: "UNCERTIFIED",
    color: "#ef4444",
    icon: "⊗",
    bg: "rgba(239,68,68,0.07)",
    border: "rgba(239,68,68,0.2)"
  },
  UNCERTIFIED_NOISY: {
    label: "UNCERTIFIED · LOW CONFIDENCE",
    color: "#fb923c",
    icon: "⧖",
    bg: "rgba(251,146,60,0.07)",
    border: "rgba(251,146,60,0.2)"
  },
  COLLECTING: {
    label: "COLLECTING",
    color: "#6e87a2",
    icon: "◎",
    bg: "rgba(110,135,162,0.07)",
    border: "rgba(110,135,162,0.2)"
  }
};

const CONFIDENCE_COLOR = { HIGH: C.green, MEDIUM: "#f59e0b", LOW: "#ef4444" };

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceMeter({ score, level }) {
  const color = CONFIDENCE_COLOR[level] || C.dim;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: 120, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
        <div style={{
          position: "absolute", left: 0, top: 0, height: "100%",
          width: `${score}%`, background: color, borderRadius: 3,
          transition: "width 0.5s ease"
        }} />
      </div>
      <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color }}>{score}%</span>
      <span style={{
        fontFamily: C.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        color, background: color + "18", border: `1px solid ${color}30`,
        padding: "1px 7px", borderRadius: 3
      }}>{level}</span>
    </div>
  );
}

function ReasoningList({ reasoning }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? reasoning : reasoning.slice(0, 3);
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((line, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ color: C.dim, fontSize: 13, marginTop: 1, flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 13.5, color: C.mid, lineHeight: 1.65 }}>
              <BoldMarkdownText text={line} style={{ color: C.mid }} strongStyle={{ color: C.text }} />
            </span>
          </div>
        ))}
      </div>
      {reasoning.length > 3 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 10, background: "none", border: "none", color: C.accentL, fontSize: 13, fontFamily: C.mono, cursor: "pointer", padding: 0 }}
        >
          {expanded ? "Show less ↑" : `+${reasoning.length - 3} more factors ↓`}
        </button>
      )}
    </div>
  );
}

function SuggestedActions({ actions }) {
  if (!actions?.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, letterSpacing: "0.09em", marginBottom: 10, fontWeight: 600 }}>SUGGESTED ACTIONS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ color: C.accentL, fontSize: 13, marginTop: 1, flexShrink: 0 }}>→</span>
            <span style={{ fontSize: 13.5, color: C.mid, lineHeight: 1.65 }}>
              <BoldMarkdownText text={a} style={{ color: C.mid }} strongStyle={{ color: C.text }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * RecommendationPanel
 *
 * Renders the full structured recommendation for a release.
 * Can be used inline in release view or inside CertificationRecordModal.
 *
 * Props:
 *   releaseId   – string
 *   compact     – bool (smaller inline version for release view cards)
 *   preloaded   – pass recommendation object directly if already fetched
 */
export default function RecommendationPanel({ releaseId, compact = false, preloaded = null }) {
  const [rec, setRec] = useState(preloaded);
  const [loading, setLoading] = useState(!preloaded);
  const [recomputing, setRecomputing] = useState(false);
  const [showReasoning, setShowReasoning] = useState(!compact);

  useEffect(() => {
    if (preloaded) { setRec(preloaded); setLoading(false); return; }
    if (!releaseId) { setLoading(false); return; }
    const base = resolveApiOrigin();
    // Try to get cached recommendation; if none exists (404) auto-compute it
    fetch(`${base}/api/releases/${releaseId}/recommendation`, apiFetchInit())
      .then(async (r) => {
        if (r.ok) return r.json();
        if (r.status === 404) {
          // No recommendation stored yet — compute on the fly
          const cr = await fetch(`${base}/api/releases/${releaseId}/recommendation/compute`, apiFetchInit({ method: "POST" }));
          return cr.ok ? cr.json() : null;
        }
        return null;
      })
      .then((d) => {
        // Ignore COLLECTING state — the verdict hasn't been issued yet
        if (d?.recommended_verdict === "COLLECTING") { setRec(null); return; }
        setRec(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [releaseId, preloaded]);

  const recompute = async () => {
    if (!releaseId) return;
    setRecomputing(true);
    try {
      const base = resolveApiOrigin();
      const res = await fetch(`${base}/api/releases/${releaseId}/recommendation/compute`, apiFetchInit({ method: "POST" }));
      if (res.ok) setRec(await res.json());
    } catch (_) {}
    finally { setRecomputing(false); }
  };

  if (loading) {
    return (
      <div style={{ padding: compact ? "8px 12px" : "14px 18px", background: C.raise, borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.dim, fontFamily: C.mono }}>Loading recommendation…</div>
      </div>
    );
  }

  if (!rec) {
    return (
      <div style={{ padding: compact ? "8px 12px" : "14px 18px", background: C.raise, borderRadius: 10, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.dim }}>No recommendation yet.</div>
        {releaseId && (
          <button onClick={recompute} disabled={recomputing} style={{ marginTop: 8, background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: C.mono, cursor: "pointer" }}>
            {recomputing ? "Computing…" : "Compute now"}
          </button>
        )}
      </div>
    );
  }

  const meta = VERDICT_META[rec.recommended_verdict] || VERDICT_META.COLLECTING;

  if (compact) {
    // Compact inline view for release cards
    return (
      <div style={{ background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 11, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ fontSize: 17, color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
            <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.07em", color: meta.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.label}</span>
          </div>
          {rec.confidence_score != null && (
            <ConfidenceMeter score={rec.confidence_score} level={rec.confidence_level} />
          )}
        </div>
        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, marginBottom: showReasoning && rec.reasoning?.length ? 12 : 0, fontWeight: 450 }}>
          <BoldMarkdownText text={rec.recommendation || ""} style={{ color: C.text, fontWeight: 450 }} strongStyle={{ fontWeight: 700 }} />
        </div>
        {rec.reasoning?.length > 0 && (
          <button onClick={() => setShowReasoning((v) => !v)} style={{ background: "none", border: "none", color: meta.color, fontSize: 12, fontFamily: C.mono, cursor: "pointer", padding: 0, marginTop: 6, opacity: 0.8 }}>
            {showReasoning ? "Hide reasoning ↑" : "See reasoning ↓"}
          </button>
        )}
        {showReasoning && rec.reasoning?.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${meta.border}` }}>
            <ReasoningList reasoning={rec.reasoning} />
          </div>
        )}
      </div>
    );
  }

  // Full view for certification record modal
  return (
    <div style={{ background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 12, padding: "16px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: meta.color + "15", border: `1px solid ${meta.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: meta.color, flexShrink: 0 }}>
            {meta.icon}
          </div>
          <div>
            <div style={{ fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: meta.color, letterSpacing: "0.1em", marginBottom: 2 }}>VERDIKT RECOMMENDATION</div>
            <div style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.label}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {rec.confidence_score != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, marginBottom: 4 }}>CONFIDENCE</div>
              <ConfidenceMeter score={rec.confidence_score} level={rec.confidence_level} />
            </div>
          )}
          {releaseId && (
            <button onClick={recompute} disabled={recomputing} title="Recompute recommendation" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: C.mono, cursor: "pointer" }}>
              {recomputing ? "…" : "↺"}
            </button>
          )}
        </div>
      </div>

      {/* Recommendation text */}
      <div style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${meta.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, letterSpacing: "0.09em", marginBottom: 8, fontWeight: 600 }}>RECOMMENDATION</div>
        <div style={{ fontSize: 15, color: C.text, lineHeight: 1.7, fontWeight: 500 }}>
          <BoldMarkdownText
            text={rec.recommendation || ""}
            style={{ color: C.text, fontWeight: 500 }}
            strongStyle={{ fontWeight: 700, color: meta.color }}
          />
        </div>
      </div>

      {/* Reasoning */}
      {rec.reasoning?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontFamily: C.mono, color: C.dim, letterSpacing: "0.08em", marginBottom: 8 }}>REASONING</div>
          <ReasoningList reasoning={rec.reasoning} />
        </div>
      )}

      {/* Suggested actions */}
      <SuggestedActions actions={rec.suggested_actions} />

      {/* At-risk / low-reliability signal tags */}
      {(rec.at_risk_signals?.length > 0 || rec.low_reliability_signals?.length > 0) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${meta.border}`, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rec.at_risk_signals?.map((s) => (
            <span key={s} style={{ fontFamily: C.mono, fontSize: 10, color: "#f59e0b", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", padding: "2px 8px", borderRadius: 4 }}>
              ⚠ {s}
            </span>
          ))}
          {rec.low_reliability_signals?.map((s) => (
            <span key={s} style={{ fontFamily: C.mono, fontSize: 10, color: C.dim, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, padding: "2px 8px", borderRadius: 4 }}>
              ↓ reliability · {s}
            </span>
          ))}
        </div>
      )}

      {rec.computed_at && (
        <div style={{ marginTop: 10, fontSize: 10, color: C.dim, fontFamily: C.mono }}>
          Computed {rec.computed_at?.slice(0, 16).replace("T", " ")} UTC
        </div>
      )}
    </div>
  );
}
