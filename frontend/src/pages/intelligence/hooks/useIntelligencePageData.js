import { useCallback, useEffect, useState } from "react";
import { readWorkspaceProdObservation } from "../../../lib/workspacePrefs.js";
import { apiPost } from "../../../lib/apiClient.js";

/**
 * Production observation toggle (localStorage) + optional recommendation backfill for the Intelligence hub header.
 */
export function useIntelligencePageData(wsId) {
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [prodObsEnabled, setProdObsEnabled] = useState(() => readWorkspaceProdObservation(wsId));

  useEffect(() => {
    const sync = () => setProdObsEnabled(readProdObservationEnabled(wsId));
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [wsId]);

  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      if (!wsId || String(wsId).trim() === "") {
        setBackfillResult({ error: "Workspace not resolved. Sign out and sign in again." });
        return;
      }
      const d = await apiPost(`/api/workspaces/${wsId}/recommendations/backfill`, {});
      setBackfillResult(d && typeof d === "object" ? d : { error: "Unexpected backfill response" });
    } catch (e) {
      setBackfillResult({ error: e?.message || "Backfill failed (network)" });
    } finally {
      setBackfilling(false);
    }
  }, [wsId]);

  return {
    prodObsEnabled,
    backfilling,
    backfillResult,
    runBackfill
  };
}
