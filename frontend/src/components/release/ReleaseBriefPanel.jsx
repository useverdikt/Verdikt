import React, { useEffect, useState } from "react";
import { C } from "../../theme/tokens.js";
import { briefBlockerLines, fetchReleaseBrief, gateActionTone } from "../../lib/releaseBriefApi.js";

const TONE = {
  ok: { fg: C.green, bg: C.greenDim, border: `${C.green}40` },
  warn: { fg: C.amber, bg: C.amberDim, border: `${C.amber}40` },
  bad: { fg: C.red, bg: C.redDim, border: `${C.red}40` },
  info: { fg: C.cyan, bg: C.cyanDim, border: `${C.cyan}40` },
  neutral: { fg: C.muted, bg: "rgba(110,135,162,0.12)", border: C.border }
};

function Chip({ label, value, tone = "neutral" }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: C.mono,
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        padding: "3px 8px"
      }}
    >
      <span style={{ color: C.dim, fontWeight: 500 }}>{label}</span>
      <strong style={{ fontWeight: 700 }}>{value}</strong>
    </span>
  );
}

/**
 * Compact governance brief for humans — same shape as MCP `release_brief`.
 * Lazy-loads when `releaseId` is set (typically expanded release detail).
 */
export default function ReleaseBriefPanel({ releaseId, compact = true, mode }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(Boolean(releaseId));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!releaseId) {
      setBrief(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReleaseBrief(releaseId, { mode })
      .then((data) => {
        if (!cancelled) setBrief(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setBrief(null);
          setError(e?.message || "Could not load release brief");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [releaseId, mode]);

  if (!releaseId) return null;

  if (loading) {
    return (
      <div
        style={{
          marginBottom: compact ? 14 : 16,
          padding: compact ? "10px 12px" : "12px 14px",
          background: C.raise,
          border: `1px solid ${C.border}`,
          borderRadius: compact ? 8 : 10,
          fontFamily: C.mono,
          fontSize: 11,
          color: C.dim
        }}
      >
        Loading release brief…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="status"
        style={{
          marginBottom: compact ? 14 : 16,
          padding: compact ? "10px 12px" : "12px 14px",
          background: C.redDim,
          border: `1px solid ${C.red}40`,
          borderRadius: compact ? 8 : 10,
          fontSize: 12,
          color: C.muted
        }}
      >
        <strong style={{ color: C.red }}>Release brief unavailable — </strong>
        {error}
      </div>
    );
  }

  if (!brief) return null;

  const blockers = briefBlockerLines(brief.top_blockers, 3);
  const regression = brief.regression_story?.summary || null;
  const debtActive = Boolean(brief.remediation_debt?.active);
  const actionTone = gateActionTone(brief.gate_action);
  const verbTone = gateActionTone(
    brief.suggested_verb === "merge" ? "merge" : brief.suggested_verb === "escalate" ? "escalate" : "collecting"
  );

  return (
    <section
      aria-label="Release brief"
      style={{
        marginBottom: compact ? 14 : 16,
        padding: compact ? "12px 12px 10px" : "14px 14px 12px",
        background: C.raise,
        border: `1px solid ${C.border}`,
        borderRadius: compact ? 8 : 10
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10
        }}
      >
        <div
          style={{
            fontFamily: C.mono,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.11em",
            textTransform: "uppercase",
            color: C.dim
          }}
        >
          Release brief
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {brief.gate_action ? (
            <Chip label="gate" value={brief.gate_action} tone={actionTone} />
          ) : null}
          {brief.suggested_verb ? (
            <Chip label="next" value={brief.suggested_verb} tone={verbTone} />
          ) : null}
          {debtActive ? <Chip label="debt" value="active" tone="bad" /> : null}
        </div>
      </div>

      {brief.next_step || brief.agent_note ? (
        <p
          style={{
            margin: "0 0 10px",
            fontSize: compact ? 12.5 : 13,
            lineHeight: 1.55,
            color: C.text
          }}
        >
          {brief.next_step || brief.agent_note}
        </p>
      ) : null}

      {blockers.length > 0 ? (
        <div style={{ marginBottom: regression ? 10 : 0 }}>
          <div
            style={{
              fontFamily: C.mono,
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: C.dim,
              marginBottom: 6
            }}
          >
            Top blockers{typeof brief.blocker_count === "number" ? ` (${brief.blocker_count})` : ""}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {blockers.map((b, i) => (
              <li key={i} style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
                <span style={{ color: C.dim, marginRight: 8 }}>›</span>
                {b.line}
                {b.nextStep ? (
                  <span style={{ display: "block", marginLeft: 16, marginTop: 2, color: C.dim, fontSize: 11.5 }}>
                    → {b.nextStep}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {regression ? (
        <div style={{ marginTop: blockers.length ? 4 : 0 }}>
          <div
            style={{
              fontFamily: C.mono,
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: C.dim,
              marginBottom: 4
            }}
          >
            Regression story
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{regression}</p>
        </div>
      ) : null}
    </section>
  );
}
