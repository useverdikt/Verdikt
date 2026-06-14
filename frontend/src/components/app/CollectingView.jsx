import React from "react";
import { Link } from "react-router-dom";
import { C } from "../../theme/tokens.js";
import { hasBackend } from "../../lib/hasBackend.js";
import IntegrationPullBanner from "../IntegrationPullBanner.jsx";

const RISK_COLOR = { stable: C.muted, at_risk: C.amber, likely_breach: "#ef4444", unstable_sample: C.amber };
const RISK_ICON = { stable: "◉", at_risk: "⚠", likely_breach: "✕", unstable_sample: "⧗" };
const RISK_LABEL = { stable: "On track", at_risk: "At risk", likely_breach: "Breach likely", unstable_sample: "Unstable sample" };

function EarlyWarningBanner({ earlyWarning }) {
  if (!earlyWarning || earlyWarning.overall_risk === "stable") return null;
  const color = RISK_COLOR[earlyWarning.overall_risk] || C.amber;
  const icon = RISK_ICON[earlyWarning.overall_risk] || "⚠";
  const label = RISK_LABEL[earlyWarning.overall_risk] || earlyWarning.overall_risk;
  return (
    <div style={{
      background: earlyWarning.overall_risk === "likely_breach" ? "rgba(239,68,68,0.07)" : "rgba(245,158,11,0.07)",
      border: `1px solid ${earlyWarning.overall_risk === "likely_breach" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`,
      borderRadius: 10, padding: "12px 16px", marginBottom: 4
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: earlyWarning.warnings?.length > 0 ? 8 : 0 }}>
        <span style={{ fontSize: 14, color }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: C.mono, letterSpacing: "0.06em" }}>
          EARLY WARNING · {label.toUpperCase()}
        </span>
        {earlyWarning.window_elapsed_pct != null && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim, fontFamily: C.mono }}>
            {Math.round(earlyWarning.window_elapsed_pct)}% of window elapsed
          </span>
        )}
      </div>
      {earlyWarning.warnings?.slice(0, 4).map((w, i) => (
        <div key={i} style={{ fontSize: 12, color: C.muted, marginTop: 4, paddingLeft: 22, lineHeight: 1.5 }}>
          {w.message}
        </div>
      ))}
      {earlyWarning.warnings?.length > 4 && (
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4, paddingLeft: 22 }}>
          +{earlyWarning.warnings.length - 4} more warnings
        </div>
      )}
    </div>
  );
}

export default function CollectingView({ release, onSimulate, onRunVerdict, signalSources, releaseTypes, earlyWarning }) {
  const sources = release.sources?.length
    ? release.sources
    : signalSources.map((s) => ({ ...s, status: "waiting", statusLabel: "Not configured", statusTone: "muted", configured: false }));
  const arrived = sources.filter((s) => s.status === "arrived");
  const nextSource = sources.find((s) => s.status === "waiting" && s.configured !== false);
  const allRequiredArrived = sources.filter((s) => s.configured !== false).every((s) => s.status === "arrived");
  const showSimulate = !hasBackend() && nextSource;
  const backendReleaseId = release.backendReleaseId || (String(release.id || "").startsWith("rel_") ? release.id : null);
  const rt = releaseTypes.find((r) => r.id === release.releaseType);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>{release.version}</h2>
          <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: C.amber, background: C.amberDim, padding: "2px 8px", borderRadius: 4 }}>COLLECTING</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Collection window open · {release.buildRef || "No build reference"} · {rt ? rt.label : "Feature"}
        </div>
      </div>

      <EarlyWarningBanner earlyWarning={earlyWarning} />
      <IntegrationPullBanner integrationPull={release.integration_pull} releaseId={backendReleaseId} />

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em" }}>SIGNAL COLLECTION PROGRESS</span>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: allRequiredArrived ? C.green : C.amber }}>
            {arrived.length} / {sources.length} source{sources.length !== 1 ? "s" : ""} reported
          </span>
        </div>

        <div style={{ padding: "8px 18px 12px", borderBottom: `1px solid ${C.border}`, background: C.raise }}>
          <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.55 }}>
            Sources below show <span style={{ color: C.muted, fontWeight: 700 }}>connection status</span> — not native SDK embeds.
            Configure API keys in Settings → Signal sources; Verdikt pulls by commit SHA or accepts webhook/API ingest.
          </div>
        </div>

        {sources.map((src) => (
          <div key={src.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: `1px solid ${C.border}`, opacity: src.status === "arrived" ? 1 : 0.72, transition: "opacity 0.3s" }}>
            <span style={{ fontSize: 16, color: src.color, width: 22, textAlign: "center", flexShrink: 0 }}>{src.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{src.name}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {src.signals?.length ? `${src.signals.length} signal type${src.signals.length > 1 ? "s" : ""}` : "Supplemental data"}
                {src.statusLabel ? ` · ${src.statusLabel}` : ""}
              </div>
            </div>
            {src.status === "arrived" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {src.arrivedAt && <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted }}>{src.arrivedAt}</span>}
                <span style={{ fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: C.green }}>✓ RECEIVED</span>
              </div>
            ) : src.connectionStatus === "pull_failed" ? (
              <span style={{ fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: "#f87171", flexShrink: 0 }}>✕ PULL FAILED</span>
            ) : src.configured ? (
              <span style={{ fontFamily: C.mono, fontSize: 10, color: C.amber, flexShrink: 0 }}>⧗ AWAITING SHA MATCH</span>
            ) : (
              <span style={{ fontFamily: C.mono, fontSize: 10, color: C.dim, flexShrink: 0 }}>NOT CONFIGURED</span>
            )}
          </div>
        ))}

        <div style={{ padding: "14px 18px", display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          {hasBackend() && (
            <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>
              Production ingest: label trigger auto-pull,{" "}
              <Link to="/settings?section=api" style={{ color: C.green }}>
                Settings → Signal sources
              </Link>
              , or POST /signals.
            </span>
          )}
          {showSimulate && nextSource && (
            <button onClick={() => onSimulate(nextSource.id)} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.accentDim, color: C.accentBright, fontSize: 11, fontFamily: C.mono, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              Simulate {nextSource.name} →
            </button>
          )}
          {allRequiredArrived && (
            <button onClick={onRunVerdict} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: C.green, color: "#000", fontSize: 12, fontFamily: C.mono, fontWeight: 700, cursor: "pointer" }}>
              All signals received - run verdict →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
