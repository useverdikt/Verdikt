import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { C } from "./intelligence/theme.js";
import { getWorkspaceId } from "../lib/apiClient.js";
import { useIntelligencePageData } from "./intelligence/hooks/useIntelligencePageData.js";
import { LoopReadinessPanel } from "./intelligence/panels/LoopReadinessPanel.jsx";
import { SignalReliabilityPanel } from "./intelligence/panels/SignalReliabilityPanel.jsx";
import { CorrelationPanel } from "./intelligence/panels/CorrelationPanel.jsx";
import { OverrideAnalyticsPanel } from "./intelligence/panels/OverrideAnalyticsPanel.jsx";
import { EnvChainPanel } from "./intelligence/panels/EnvChainPanel.jsx";
import { VcsPanel } from "./intelligence/panels/VcsPanel.jsx";
import { SsePanel } from "./intelligence/panels/SsePanel.jsx";
import { VcsMonitorPanel } from "./intelligence/panels/VcsMonitorPanel.jsx";
import { ProductionHealthPanel } from "./intelligence/panels/ProductionHealthPanel.jsx";
import { ThresholdSimulatorPanel } from "./intelligence/panels/ThresholdSimulatorPanel.jsx";

export default function IntelligencePage() {
  const wsId = getWorkspaceId();
  const { prodObsEnabled, backfilling, backfillResult, runBackfill } = useIntelligencePageData(wsId);

  useEffect(() => {
    document.title = "Verdikt — Intelligence";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "24px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link
              to="/releases"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: C.mono,
                fontSize: 12,
                fontWeight: 600,
                color: C.accentL,
                textDecoration: "none",
                letterSpacing: "0.04em",
                border: `1px solid ${C.borderL}`,
                background: C.raise,
                padding: "8px 14px",
                borderRadius: 8
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
                ←
              </span>
              Back to dashboard
            </Link>

            <button
              type="button"
              onClick={runBackfill}
              disabled={backfilling}
              title="Compute recommendations for all existing certified / uncertified releases"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontFamily: C.mono,
                fontSize: 12,
                fontWeight: 600,
                color: backfilling ? C.dim : C.green,
                border: `1px solid ${backfilling ? C.border : C.green + "50"}`,
                background: backfilling ? C.raise : C.green + "0d",
                padding: "8px 14px",
                borderRadius: 8,
                cursor: backfilling ? "default" : "pointer"
              }}
            >
              <span style={{ fontSize: 13 }}>{backfilling ? "⟳" : "⊕"}</span>
              {backfilling ? "Computing recommendations…" : "Seed recommendations for past releases"}
            </button>

            {backfillResult && !backfillResult.error && (
              <span style={{ fontFamily: C.mono, fontSize: 11, color: C.green }}>
                ✓ {backfillResult.computed} computed, {backfillResult.skipped} skipped
              </span>
            )}
            {backfillResult?.error && (
              <span style={{ fontFamily: C.mono, fontSize: 11, color: C.red }}>{backfillResult.error}</span>
            )}
          </div>
          <div
            style={{
              fontFamily: C.mono,
              fontSize: 10,
              color: C.dim,
              letterSpacing: "0.12em",
              marginBottom: 6,
              textTransform: "uppercase"
            }}
          >
            Release Intelligence
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: C.serif,
              fontSize: 34,
              fontWeight: 600,
              color: C.text,
              letterSpacing: "-0.01em",
              lineHeight: 1.1
            }}
          >
            Intelligence <em style={{ fontStyle: "italic", color: C.accentL }}>Hub</em>
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: C.mid }}>
            Signal correlation, failure patterns, environment chains, live streams, VCS write-back, override analytics,
            production feedback loop, and threshold simulation.
            {!prodObsEnabled && (
              <span style={{ display: "block", marginTop: 8, color: C.amber }}>
                Production feedback loop metrics are off until you enable <strong style={{ color: C.text }}>Production observation</strong> in{" "}
                <Link to="/settings?section=workspace" style={{ color: C.accentL }}>
                  Workspace → General
                </Link>
                .
              </span>
            )}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <LoopReadinessPanel wsId={wsId} prodObservationEnabled={prodObsEnabled} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <CorrelationPanel wsId={wsId} />
          </div>
          <SignalReliabilityPanel wsId={wsId} />
          <OverrideAnalyticsPanel wsId={wsId} />
          <div style={{ gridColumn: "1 / -1" }}>
            <EnvChainPanel wsId={wsId} />
          </div>
          <VcsPanel wsId={wsId} />
          <SsePanel wsId={wsId} />
          <div style={{ gridColumn: "1 / -1" }}>
            <VcsMonitorPanel wsId={wsId} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <ProductionHealthPanel wsId={wsId} prodObservationEnabled={prodObsEnabled} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <ThresholdSimulatorPanel wsId={wsId} />
          </div>
        </div>
      </div>
    </div>
  );
}
