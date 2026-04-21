import { useCallback, useEffect, useState } from "react";
import { normalizeStoredProject } from "../../../lib/projectEnv.js";
import { authHeaders } from "../../../lib/apiClient.js";
import { api } from "../api.js";

export function readProdObservationEnabled() {
  try {
    const raw = localStorage.getItem("vdk3_project");
    if (!raw) return false;
    return normalizeStoredProject(JSON.parse(raw)).prodObservation === true;
  } catch {
    return false;
  }
}

/**
 * Production observation toggle (localStorage) + optional recommendation backfill for the Intelligence hub header.
 */
export function useIntelligencePageData(wsId) {
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [prodObsEnabled, setProdObsEnabled] = useState(readProdObservationEnabled);

  useEffect(() => {
    const sync = () => setProdObsEnabled(readProdObservationEnabled());
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await api(`/api/workspaces/${wsId}/recommendations/backfill`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" }
      });
      const d = await res.json();
      setBackfillResult(d);
    } catch {
      setBackfillResult({ error: "Backfill failed" });
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
