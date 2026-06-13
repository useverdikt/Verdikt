import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { applyThresholdApiMap, defaultRequiredFlags } from "../lib/thresholdBounds.js";
import { S, DEFAULT_THRESHOLDS } from "../app/main/appMainLogic.js";

/** Threshold state, suggestions, and server sync helpers. */
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

  useEffect(() => {
    if (hasBackend()) return;
    S.set("thresholds", thresholds);
  }, [thresholds]);

  useEffect(() => {
    S.set("thresholdRequired", thresholdRequired);
  }, [thresholdRequired]);

  const applyThresholdsFromApi = useCallback((thData) => {
    const map = thData?.thresholds || {};
    const parsed = applyThresholdApiMap(map);
    setThresholds((prev) => ({ ...DEFAULT_THRESHOLDS, ...prev, ...parsed.thresholds }));
    setThresholdRequired((prev) => ({ ...defaultRequiredFlags(), ...prev, ...parsed.required }));
  }, []);

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
    if (nav === "thresholds") void loadThresholdSuggestions();
  }, [nav, loadThresholdSuggestions]);

  return {
    thresholds,
    setThresholds,
    thresholdRequired,
    setThresholdRequired,
    thresholdSuggestions,
    thresholdSuggestNote,
    loadThresholdSuggestions,
    applyThresholdsFromApi
  };
}
