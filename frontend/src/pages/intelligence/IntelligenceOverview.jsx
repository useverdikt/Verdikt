import React from "react";
import { Link, useOutletContext } from "react-router-dom";
import { C, BAND_META } from "./theme.js";
import { Card, Spinner, EmptyState } from "./ui.jsx";
import { useLoopReadiness } from "../../hooks/useLoopReadiness.js";
import { OVERVIEW_QUICK_LINKS } from "./intelligenceNav.js";

export default function IntelligenceOverview() {
  const { wsId, prodObsEnabled } = useOutletContext();
  const { data, loading } = useLoopReadiness(wsId, { enabled: prodObsEnabled });

  const band = data?.band ?? "Exploratory";
  const bm = BAND_META[band] || BAND_META.Exploratory;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            margin: "0 0 8px",
            fontFamily: C.serif,
            fontSize: 26,
            fontWeight: 600,
            color: C.text,
            letterSpacing: "-0.01em"
          }}
        >
          Overview
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: C.mid, lineHeight: 1.65, maxWidth: 640 }}>
          Loop maturity, production truth, signal quality, and threshold calibration — pick a workflow from the sidebar or jump in below.
        </p>
      </div>

      <Card
        title="Feedback Loop Readiness"
        eyebrow="AT A GLANCE"
        action={
          <Link
            to="/intelligence/readiness"
            style={{
              fontFamily: C.mono,
              fontSize: 11,
              fontWeight: 600,
              color: C.accentL,
              textDecoration: "none"
            }}
          >
            Full view →
          </Link>
        }
      >
        {!prodObsEnabled ? (
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
            Enable <strong style={{ color: C.text }}>Production observation</strong> to see loop band and funnel metrics.{" "}
            <Link to="/settings?section=workspace" style={{ color: C.accentL, fontWeight: 600 }}>
              Open settings
            </Link>
          </div>
        ) : loading && !data ? (
          <Spinner />
        ) : !data ? (
          <EmptyState msg="No loop readiness data yet — certify releases and gather production signals." />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: bm.bg,
                border: `1px solid ${bm.color}40`,
                borderRadius: 8,
                padding: "8px 14px"
              }}
            >
              <span style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 800, color: bm.color }}>
                {data.is_stale ? "STALE" : band.toUpperCase()}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                {data.full_loop_rate_pct}% full loop rate · {data.full_loop_count} completed loops
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{data.next_action}</div>
            </div>
          </div>
        )}
      </Card>

      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12
        }}
      >
        {OVERVIEW_QUICK_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            style={{
              display: "block",
              padding: "16px 18px",
              borderRadius: 10,
              background: C.surface,
              border: `1px solid ${C.border}`,
              textDecoration: "none",
              transition: "border-color .15s"
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6 }}>{item.title}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{item.desc}</div>
            <div
              style={{
                marginTop: 10,
                fontFamily: C.mono,
                fontSize: 11,
                fontWeight: 600,
                color: C.accentL
              }}
            >
              Open →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
