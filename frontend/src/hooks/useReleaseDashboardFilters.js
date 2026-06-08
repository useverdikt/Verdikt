import { useMemo, useState } from "react";
import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "../lib/releaseStatus.js";
import { envBucket } from "../components/release/dashboard/releaseDashboardUtils.js";

export function useReleaseDashboardFilters(releases) {
  const [activeEnv, setActiveEnv] = useState("All");
  const [activeTab, setActiveTab] = useState("All releases");
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedId, setExpandedId] = useState(null);
  const [searchQ, setSearchQ] = useState("");

  const visibleReleases = useMemo(() => {
    let list = [...releases];
    if (activeEnv !== "All") {
      const want = activeEnv === "Prod" ? "prod" : activeEnv === "Pre-Prod" ? "pre-prod" : null;
      if (want) list = list.filter((r) => envBucket(r.environment) === want);
    }
    if (activeTab === "Uncertified") {
      list = list.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.UNCERTIFIED);
    }
    if (activeTab === "Overrides") {
      list = list.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE);
    }
    if (activeFilter === "CERTIFIED") {
      list = list.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED);
    }
    if (activeFilter === "UNCERTIFIED") {
      list = list.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.UNCERTIFIED);
    }
    if (activeFilter === "OVERRIDE") {
      list = list.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE);
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter((r) => String(r.version || "").toLowerCase().includes(q));
    }
    return list;
  }, [releases, activeEnv, activeTab, activeFilter, searchQ]);

  const toggleRow = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return {
    activeEnv,
    setActiveEnv,
    activeTab,
    setActiveTab,
    activeFilter,
    setActiveFilter,
    expandedId,
    searchQ,
    setSearchQ,
    visibleReleases,
    toggleRow
  };
}
