import { useMemo } from "react";
import { hasComputedAlignment } from "../lib/releaseAlignmentMeta.js";
import { normalizeReleaseStatus, UI_RELEASE_STATUS, isCertifiedLike, isLiveBypassRisk } from "../lib/releaseStatus.js";
import { envDisplayLabel } from "../components/release/dashboard/releaseDashboardUtils.js";

export function useReleaseDashboardStats({
  releases,
  wsId,
  loopReadiness,
  signalCategories,
  calcCategoryStatus,
  thresholds,
  formatReleaseAge,
  shippedWithoutCertificationCount: workspaceBypassCount = null
}) {
  const statsReleases = useMemo(
    () => (wsId ? releases.filter((r) => r.backendReleaseId) : releases),
    [releases, wsId]
  );

  const stats = useMemo(() => {
    const total = statsReleases.length;
    const certified = statsReleases.filter((r) => isCertifiedLike(r.status)).length;
    const certRate = total ? Math.round((certified / total) * 100) : 0;
    const uncertified = statsReleases.filter(
      (r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.UNCERTIFIED
    ).length;
    const overrideCount = statsReleases.filter(
      (r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE
    ).length;
    const overrideRate = certified ? Math.round((overrideCount / certified) * 100) : 0;
    const loopCount =
      loopReadiness?.full_loop_count ??
      statsReleases.filter((r) => hasComputedAlignment(r.alignmentVerdict)).length;
    const shippedWithoutCertificationCount =
      typeof workspaceBypassCount === "number"
        ? workspaceBypassCount
        : statsReleases.filter((r) => r.shipped_without_certification).length;
    return {
      certRate,
      uncertified,
      overrideRate,
      loopCount,
      total,
      certified,
      shippedWithoutCertificationCount
    };
  }, [statsReleases, loopReadiness, workspaceBypassCount]);

  const releaseCatStatuses = useMemo(() => {
    if (!calcCategoryStatus) return {};
    const map = {};
    for (const r of releases) {
      map[r.id] = {};
      for (const cat of signalCategories) {
        map[r.id][cat.id] = calcCategoryStatus(cat.id, r.signals, thresholds, r.releaseType);
      }
    }
    return map;
  }, [releases, signalCategories, calcCategoryStatus, thresholds]);

  const recentActivity = useMemo(() => {
    return releases.slice(0, 5).map((r) => {
      const rs = normalizeReleaseStatus(r.status);
      return {
        r,
        dot: isLiveBypassRisk(r)
          ? "#e11d48"
          : rs === UI_RELEASE_STATUS.CERTIFIED
            ? "#22c55e"
            : rs === UI_RELEASE_STATUS.UNCERTIFIED
              ? "#ef4444"
              : rs === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE
                ? "#f59e0b"
                : "#3b82f6",
        text: isLiveBypassRisk(r)
          ? "gate bypassed · live in prod"
          : rs === UI_RELEASE_STATUS.COLLECTING
            ? "collecting signals"
            : rs === UI_RELEASE_STATUS.UNCERTIFIED
              ? "UNCERTIFIED"
              : rs === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE
                ? "certified with override"
                : rs === UI_RELEASE_STATUS.CERTIFIED
                  ? "certified"
                  : "—",
        meta: (formatReleaseAge ? formatReleaseAge(r) : r.date || "—") + " · " + envDisplayLabel(r.environment)
      };
    });
  }, [releases, formatReleaseAge]);

  return { statsReleases, stats, releaseCatStatuses, recentActivity };
}
