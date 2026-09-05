import { useEffect, useMemo, useRef, useState } from "react";
import { matchReleaseByQueryId } from "../lib/releaseFocusQuery.js";
import { normalizeReleaseStatus, UI_RELEASE_STATUS } from "../lib/releaseStatus.js";
import { envBucket } from "../components/release/dashboard/releaseDashboardUtils.js";

export function useReleaseDashboardFilters(releases, { focusReleaseId = null } = {}) {
  const [activeEnv, setActiveEnv] = useState("All");
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedId, setExpandedId] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const appliedFocusRef = useRef(null);

  const visibleReleases = useMemo(() => {
    let list = [...releases];
    if (activeEnv !== "All") {
      const want = activeEnv === "Prod" ? "prod" : activeEnv === "Pre-Prod" ? "pre-prod" : null;
      if (want) list = list.filter((r) => envBucket(r.environment) === want);
    }
    if (activeFilter === "CERTIFIED") {
      list = list.filter((r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED);
    }
    if (activeFilter === "UNCERTIFIED") {
      list = list.filter((r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.UNCERTIFIED);
    }
    if (activeFilter === "OVERRIDE") {
      list = list.filter((r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE);
    }
    if (activeFilter === "REVOKED") {
      list = list.filter((r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.CERTIFICATION_REVOKED);
    }
    if (activeFilter === "INTEGRATION") {
      list = list.filter((r) => r.evidenceQuality === "INTEGRATION_BACKED");
    }
    if (activeFilter === "SIMULATOR") {
      list = list.filter((r) => r.evidenceQuality === "SIMULATOR_BACKED");
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter((r) => String(r.version || "").toLowerCase().includes(q));
    }
    return list;
  }, [releases, activeEnv, activeFilter, searchQ]);

  useEffect(() => {
    if (!focusReleaseId) return;
    const match = matchReleaseByQueryId(releases, focusReleaseId);
    if (!match) return;
    if (appliedFocusRef.current === focusReleaseId) return;
    appliedFocusRef.current = focusReleaseId;
    setActiveEnv("All");
    setActiveFilter("All");
    setSearchQ("");
    setExpandedId(match.id);
  }, [focusReleaseId, releases]);

  const toggleRow = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return {
    activeEnv,
    setActiveEnv,
    activeFilter,
    setActiveFilter,
    expandedId,
    searchQ,
    setSearchQ,
    visibleReleases,
    toggleRow
  };
}
