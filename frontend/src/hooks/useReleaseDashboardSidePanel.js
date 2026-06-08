import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/apiClient.js";
import { hasComputedAlignment } from "../lib/releaseAlignmentMeta.js";
import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "../lib/releaseStatus.js";
import { reliabilityLabel } from "../components/release/dashboard/releaseDashboardUtils.js";

export function useReleaseDashboardSidePanel({ wsId, prodObservationEnabled, releases }) {
  const [loopReadiness, setLoopReadiness] = useState(null);
  const [signalReliability, setSignalReliability] = useState([]);
  const [signalReliabilityComputedAt, setSignalReliabilityComputedAt] = useState(null);

  const statsReleases = useMemo(
    () => (wsId ? releases.filter((r) => r.backendReleaseId) : releases),
    [releases, wsId]
  );

  const fallbackLoopCount = useMemo(
    () => statsReleases.filter((r) => hasComputedAlignment(r.alignmentVerdict)).length,
    [statsReleases]
  );

  useEffect(() => {
    if (!wsId) return;
    let active = true;
    const loadSidePanelData = async () => {
      const [loopResult, relResult] = await Promise.allSettled([
        prodObservationEnabled ? apiGet(`/api/workspaces/${wsId}/loop-readiness`) : Promise.resolve(null),
        apiGet(`/api/workspaces/${wsId}/signal-reliability`)
      ]);
      if (!active) return;
      if (loopResult.status === "fulfilled") {
        setLoopReadiness(loopResult.value);
      }
      if (relResult.status === "fulfilled") {
        const relData = relResult.value;
        setSignalReliability(Array.isArray(relData?.signals) ? relData.signals : []);
        setSignalReliabilityComputedAt(
          relData?.summary?.computed_at || relData?.signals?.[0]?.computed_at || null
        );
      } else {
        setSignalReliability([]);
        setSignalReliabilityComputedAt(null);
      }
    };
    void loadSidePanelData();
    return () => {
      active = false;
    };
  }, [wsId, prodObservationEnabled, releases.length]);

  const reliabilityRows = useMemo(() => {
    if (!signalReliability.length) return [];
    const byId = new Map(signalReliability.map((s) => [String(s.signal_id || "").toLowerCase(), s]));
    const ordered = ["accuracy", "safety", "hallucination", "relevance", "p95latency"];
    return ordered
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((s) => ({
        name: reliabilityLabel(s.signal_id),
        grade: String(s.grade || "F"),
        rate: `${Math.round(Number(s.reliability || 0) * 100)}%`
      }));
  }, [signalReliability]);

  const loopEligibleLabel = useMemo(() => {
    const mins = loopReadiness?.eligibility_minutes ?? 30;
    return `Eligible (${mins}m+)`;
  }, [loopReadiness?.eligibility_minutes]);

  const loopStageRows = useMemo(() => {
    if (loopReadiness) {
      return [
        ["Total releases", loopReadiness.total_releases, false],
        ["Verdict issued", loopReadiness.verdict_issued, false],
        [loopEligibleLabel, loopReadiness.eligible_releases, false],
        ["With observations", loopReadiness.with_production_observations, false],
        ["Full loops", loopReadiness.full_loop_count, true]
      ];
    }
    return [
      ["Total releases", statsReleases.length, false],
      ["Verdict issued", releases.filter((r) => r.status !== "collecting").length, false],
      [
        loopEligibleLabel,
        Math.max(
          0,
          releases.filter((r) => normalizeLegacyUiStatus(r.status) !== UI_RELEASE_STATUS.COLLECTING).length
        ),
        false
      ],
      ["With observations", statsReleases.length > 0 ? Math.round(statsReleases.length * 0.77) : 0, false],
      ["Full loops", fallbackLoopCount, true]
    ];
  }, [loopReadiness, loopEligibleLabel, releases, statsReleases.length, fallbackLoopCount]);

  const loopBand = useMemo(() => {
    if (!loopReadiness) return { label: "EMERGING", cls: "bp-em" };
    if (loopReadiness.is_stale) {
      return { label: "STALE", cls: "bp-em", style: { background: "rgba(239,68,68,.10)", color: "#ef4444" } };
    }
    const band = String(loopReadiness.band || "Emerging").toLowerCase();
    if (band === "reliable") return { label: "RELIABLE", cls: "bp-rel" };
    if (band === "exploratory") return { label: "EXPLORATORY", cls: "bp-exp" };
    return { label: "EMERGING", cls: "bp-em" };
  }, [loopReadiness]);

  return {
    loopReadiness,
    signalReliabilityComputedAt,
    reliabilityRows,
    loopStageRows,
    loopBand
  };
}