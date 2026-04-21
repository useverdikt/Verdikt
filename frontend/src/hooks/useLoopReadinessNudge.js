import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";

/**
 * Session-dismissible banner when verdicts exist but no production observations (loop-readiness API).
 */
export function useLoopReadinessNudge({ releases, navigate, prodObservationEnabled }) {
  const [loopNudgeDismissed, setLoopNudgeDismissed] = useState(
    () => !!localStorage.getItem("vdk_loop_nudge_v1_dismissed")
  );
  const [showLoopNudge, setShowLoopNudge] = useState(false);
  const dismissLoopNudge = useCallback(() => {
    localStorage.setItem("vdk_loop_nudge_v1_dismissed", "1");
    setLoopNudgeDismissed(true);
    setShowLoopNudge(false);
  }, []);

  useEffect(() => {
    if (loopNudgeDismissed || !hasBackend() || !prodObservationEnabled) return;
    const wsId = getWorkspaceId();
    if (!wsId) return;
    const hasVerdicts = releases.some(
      (r) =>
        r.backendReleaseId &&
        (r.status === "CERTIFIED" || r.status === "UNCERTIFIED" || r.status === "CERTIFIED_WITH_OVERRIDE")
    );
    if (!hasVerdicts) return;
    apiGet(`/api/workspaces/${wsId}/loop-readiness`, { navigate })
      .then((data) => {
        if (data && data.verdict_issued > 0 && data.with_production_observations === 0) {
          setShowLoopNudge(true);
        }
      })
      .catch(() => {});
  }, [releases, loopNudgeDismissed, prodObservationEnabled, navigate]);

  return { showLoopNudge, dismissLoopNudge };
}
