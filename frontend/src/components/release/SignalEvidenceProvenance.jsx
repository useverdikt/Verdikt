import React from "react";
import { C } from "../../theme/tokens.js";
import {
  classifySignalSource,
  evidenceQualityMeta,
  formatSourceLabel,
  getEvidenceSummaryLine,
  latestSignalRowMap,
  provenanceTierMeta
} from "../../lib/signalProvenance.js";

function ProvenanceBadge({ source, compact = false }) {
  const tier = classifySignalSource(source);
  const meta = provenanceTierMeta(tier);
  return (
    <span
      title={`${meta.label} — ${formatSourceLabel(source)}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: C.mono,
        fontSize: compact ? 9 : 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: meta.color,
        background: `${meta.color}18`,
        border: `1px solid ${meta.color}40`,
        borderRadius: 4,
        padding: compact ? "1px 5px" : "2px 7px",
        whiteSpace: "nowrap"
      }}
    >
      {meta.shortLabel}
    </span>
  );
}

export function EvidenceQualityFlag({ flag, compact = false }) {
  const meta = evidenceQualityMeta(flag);
  if (!meta) return null;
  return (
    <span
      title={meta.description}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: C.mono,
        fontSize: compact ? 9 : 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: meta.color,
        background: `${meta.color}14`,
        border: `1px solid ${meta.color}35`,
        borderRadius: 4,
        padding: compact ? "1px 6px" : "2px 8px"
      }}
    >
      {meta.label}
    </span>
  );
}

export function EvidenceSummaryLine({ release, style = {} }) {
  const line = getEvidenceSummaryLine(release);
  if (!line) return null;
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        color: "rgba(241,243,249,0.88)",
        fontFamily: C.sans,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        marginBottom: 12,
        ...style
      }}
    >
      {line}
    </div>
  );
}

/**
 * Per-signal provenance badge for cert / release detail rows.
 */
export function SignalSourceBadge({ source, compact = false }) {
  if (source == null) return null;
  return <ProvenanceBadge source={source} compact={compact} />;
}

/**
 * Evidence block: summary line + optional quality flag (certified releases).
 */
export function SignalEvidenceBlock({ release, showFlag = true, compact = false }) {
  const line = getEvidenceSummaryLine(release);
  const flag = release?.evidenceQuality;
  if (!line && !flag) return null;

  return (
    <div style={{ marginBottom: compact ? 10 : 14 }}>
      {showFlag && flag ? (
        <div style={{ marginBottom: line ? 8 : 0 }}>
          <EvidenceQualityFlag flag={flag} compact={compact} />
        </div>
      ) : null}
      {line ? <EvidenceSummaryLine release={release} style={{ marginBottom: 0 }} /> : null}
    </div>
  );
}

/**
 * Resolve provenance source string for a signal on a release.
 * @param {object} release
 * @param {string} signalId
 */
export function provenanceSourceForSignal(release, signalId) {
  const map = latestSignalRowMap(release?.signalRows || []);
  return map[signalId]?.source ?? null;
}

export { ProvenanceBadge, classifySignalSource, provenanceTierMeta };
