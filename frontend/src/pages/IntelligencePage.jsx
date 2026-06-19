import React, { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { C } from "./intelligence/theme.js";
import { getWorkspaceId } from "../lib/apiClient.js";
import { useIntelligencePageData } from "./intelligence/hooks/useIntelligencePageData.js";
import IntelligenceNav from "./intelligence/IntelligenceNav.jsx";
import ProdObsLayoutBanner from "./intelligence/ProdObsLayoutBanner.jsx";
import {
  INTELLIGENCE_ROUTE_TITLES,
  PROD_OBS_ROUTES,
  intelligenceRouteSegment
} from "./intelligence/intelligenceNav.js";

export default function IntelligencePage() {
  const wsId = getWorkspaceId();
  const location = useLocation();
  const { prodObsEnabled, backfilling, backfillResult, runBackfill } = useIntelligencePageData(wsId);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900);

  const routeSegment = intelligenceRouteSegment(location.pathname);
  const pageTitle = INTELLIGENCE_ROUTE_TITLES[routeSegment] || INTELLIGENCE_ROUTE_TITLES[""];
  const showProdObsBanner = !prodObsEnabled && PROD_OBS_ROUTES.has(routeSegment);

  useEffect(() => {
    document.title = `Verdikt — ${pageTitle}`;
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, [pageTitle]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const outletContext = {
    wsId,
    prodObsEnabled,
    suppressProdObsNotice: showProdObsBanner
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
      <header
        style={{
          borderBottom: `1px solid ${C.border}`,
          padding: isMobile ? "14px 16px" : "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          background: C.bg
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
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
              borderRadius: 8,
              flexShrink: 0
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
              ←
            </span>
            Back to dashboard
          </Link>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 10,
                color: C.dim,
                letterSpacing: "0.12em",
                textTransform: "uppercase"
              }}
            >
              Release Intelligence
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: C.serif,
                fontSize: isMobile ? 22 : 26,
                fontWeight: 600,
                color: C.text,
                letterSpacing: "-0.01em",
                lineHeight: 1.15
              }}
            >
              Intelligence <em style={{ fontStyle: "italic", color: C.accentL }}>Hub</em>
            </h1>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
            {backfilling ? "Computing…" : "Seed recommendations"}
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
      </header>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: isMobile ? "column" : "row",
          minHeight: 0
        }}
      >
        <IntelligenceNav isMobile={isMobile} />
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "16px" : "24px 28px",
            minWidth: 0
          }}
        >
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            {showProdObsBanner ? <ProdObsLayoutBanner /> : null}
            <Outlet context={outletContext} />
          </div>
        </main>
      </div>
    </div>
  );
}
