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
  const [signalDefinitions, setSignalDefinitions] = useState([]);
  const [signalLibrary, setSignalLibrary] = useState([]);
  const [signalConnectors, setSignalConnectors] = useState([]);
  const [signalsCatalogLoading, setSignalsCatalogLoading] = useState(false);
  const [signalsCatalogError, setSignalsCatalogError] = useState(null);

  const applyThresholdsFromApi = useCallback((thData) => {
    const map = thData?.thresholds || {};
    const parsed = applyThresholdApiMap(map);
    setThresholds((prev) => ({ ...DEFAULT_THRESHOLDS, ...prev, ...parsed.thresholds }));
    setThresholdRequired((prev) => ({ ...defaultRequiredFlags(), ...prev, ...parsed.required }));
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

  useEffect(() => {
    if (nav === "thresholds") {
      void loadThresholdSuggestions();
    }
  }, [nav, loadThresholdSuggestions]);

  return {
    thresholds,
    setThresholds,
    thresholdRequired,
    setThresholdRequired,
    thresholdSuggestions,
    thresholdSuggestNote,
    loadThresholdSuggestions,
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
