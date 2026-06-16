import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { applyThresholdApiMap, defaultRequiredFlags } from "../lib/thresholdBounds.js";
import { S, DEFAULT_THRESHOLDS } from "../app/main/appMainLogic.js";

/** Threshold + workspace signal definition state. */
export function useWorkspaceThresholds(navigate, nav) {
  const [thresholds, setThresholds] = useState(() => ({
    ...DEFAULT_THRESHOLDS,
    ...S.get("thresholds", {})
  }));
  const [thresholdRequired, setThresholdRequired] = useState(() =>
    S.get("thresholdRequired", defaultRequiredFlags())
  );
  const [thresholdSuggestions, setThresholdSuggestions] = useState([]);
  const [thresholdSuggestNote, setThresholdSuggestNote] = useState("");
  const [calibrationMode, setCalibrationMode] = useState("suggest_only");
  const [calibrationModeSaving, setCalibrationModeSaving] = useState(false);
  const [signalDefinitions, setSignalDefinitions] = useState([]);
  const [signalLibrary, setSignalLibrary] = useState([]);
  const [signalConnectors, setSignalConnectors] = useState([]);
  const [signalsCatalogLoading, setSignalsCatalogLoading] = useState(false);
  const [signalsCatalogError, setSignalsCatalogError] = useState(null);

  const applyThresholdsFromApi = useCallback((thData) => {
    const map = thData?.thresholds || {};
    if (!map || Object.keys(map).length === 0) return;
    const parsed = applyThresholdApiMap(map);
    // API is the source of truth — replace local state entirely rather than merging
    // over the previous value, which could re-apply stale user edits from an earlier render.
    setThresholds({ ...DEFAULT_THRESHOLDS, ...parsed.thresholds });
    setThresholdRequired({ ...defaultRequiredFlags(), ...parsed.required });
  }, []);

  const applySignalCatalogFromApi = useCallback((data) => {
    if (!data) return;
    setSignalDefinitions(Array.isArray(data.definitions) ? data.definitions : []);
    setSignalLibrary(Array.isArray(data.library) ? data.library : []);
    setSignalConnectors(Array.isArray(data.connectors) ? data.connectors : []);
    setSignalsCatalogError(null);
    if (data.thresholds) applyThresholdsFromApi({ thresholds: data.thresholds });
  }, [applyThresholdsFromApi]);

  const loadSignalCatalog = useCallback(async () => {
    if (!hasBackend()) return;
    setSignalsCatalogLoading(true);
    setSignalsCatalogError(null);
    try {
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/signal-definitions`, { navigate });
      applySignalCatalogFromApi(data);
    } catch (e) {
      setSignalsCatalogError(e?.message || "Failed to load signal catalog");
    } finally {
      setSignalsCatalogLoading(false);
    }
  }, [navigate, applySignalCatalogFromApi]);

  const adoptLibrarySignal = useCallback(
    async (signalId) => {
      const data = await apiPost(
        `/api/workspaces/${getWorkspaceId()}/signal-definitions/adopt`,
        { signal_id: signalId },
        { navigate }
      );
      applySignalCatalogFromApi(data);
      return data;
    },
    [navigate, applySignalCatalogFromApi]
  );

  const createCustomSignal = useCallback(
    async (payload) => {
      const data = await apiPost(
        `/api/workspaces/${getWorkspaceId()}/signal-definitions`,
        payload,
        { navigate }
      );
      applySignalCatalogFromApi(data);
      return data;
    },
    [navigate, applySignalCatalogFromApi]
  );

  const removeSignalDefinition = useCallback(
    async (signalId) => {
      const data = await apiDelete(
        `/api/workspaces/${getWorkspaceId()}/signal-definitions/${encodeURIComponent(signalId)}`,
        { navigate }
      );
      applySignalCatalogFromApi(data);
      setThresholds((prev) => {
        const next = { ...prev };
        delete next[signalId];
        delete next[`${signalId}_delta`];
        return next;
      });
      setThresholdRequired((prev) => {
        const next = { ...prev };
        delete next[signalId];
        delete next[`${signalId}_delta`];
        return next;
      });
      return data;
    },
    [navigate, applySignalCatalogFromApi]
  );

  const loadThresholdSuggestions = useCallback(async () => {
    if (!hasBackend()) {
      setThresholdSuggestions([]);
      setThresholdSuggestNote("");
      return;
    }
    setThresholdSuggestNote("Loading suggestions…");
    try {
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/threshold-suggestions`, { navigate });
      setThresholdSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setThresholdSuggestNote("");
    } catch (e) {
      const msg = e?.message || "";
      if (msg.includes("404") || msg.toLowerCase().includes("disabled")) {
        setThresholdSuggestions([]);
        setThresholdSuggestNote("Suggestions are currently disabled for this workspace.");
        return;
      }
      setThresholdSuggestions([]);
      setThresholdSuggestNote("Suggestions unavailable");
    }
  }, [navigate]);

  const loadCalibrationPolicy = useCallback(async () => {
    if (!hasBackend()) {
      setCalibrationMode("suggest_only");
      return;
    }
    try {
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/policies`, { navigate });
      const mode = data?.policies?.calibration_mode;
      setCalibrationMode(mode === "auto_apply" ? "auto_apply" : "suggest_only");
    } catch {
      setCalibrationMode("suggest_only");
    }
  }, [navigate]);

  const saveCalibrationMode = useCallback(
    async (autoApply) => {
      if (!hasBackend()) return;
      const next = autoApply ? "auto_apply" : "suggest_only";
      const prev = calibrationMode;
      setCalibrationMode(next);
      setCalibrationModeSaving(true);
      try {
        await apiPost(`/api/workspaces/${getWorkspaceId()}/policies`, { calibration_mode: next }, { navigate });
      } catch (e) {
        setCalibrationMode(prev);
        throw e;
      } finally {
        setCalibrationModeSaving(false);
      }
    },
    [navigate, calibrationMode]
  );

  useEffect(() => {
    if (nav === "thresholds") {
      void loadThresholdSuggestions();
      void loadCalibrationPolicy();
    }
  }, [nav, loadThresholdSuggestions, loadCalibrationPolicy]);

  return {
    thresholds,
    setThresholds,
    thresholdRequired,
    setThresholdRequired,
    thresholdSuggestions,
    thresholdSuggestNote,
    calibrationMode,
    calibrationModeSaving,
    loadThresholdSuggestions,
    loadCalibrationPolicy,
    saveCalibrationMode,
    applyThresholdsFromApi,
    applySignalCatalogFromApi,
    signalDefinitions,
    signalLibrary,
    signalConnectors,
    signalsCatalogLoading,
    signalsCatalogError,
    loadSignalCatalog,
    adoptLibrarySignal,
    createCustomSignal,
    deleteSignalDefinition: removeSignalDefinition,
    removeSignalDefinition
  };
}
