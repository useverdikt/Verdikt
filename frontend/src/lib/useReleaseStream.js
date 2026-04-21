/**
 * useReleaseStream.js
 * React hook that opens an SSE stream for a collecting release.
 * Returns { events, status, earlyWarning, error }.
 *
 * Usage:
 *   const { events, status, earlyWarning } = useReleaseStream(releaseId);
 */

import { useEffect, useRef, useState } from "react";
import { apiFetchInit, resolveApiOrigin } from "./apiClient.js";

export function useReleaseStream(releaseId, enabled = true) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState(null);
  const [earlyWarning, setEarlyWarning] = useState(null);
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!releaseId || !enabled) return;

    const apiBase = resolveApiOrigin();
    let cancelled = false;

    async function openStream() {
      // Step 1: get a stream token
      let token;
      try {
        const res = await fetch(`${apiBase}/api/releases/${releaseId}/sse-token`, apiFetchInit({ method: "POST" }));
        if (!res.ok) { setError("Could not open stream"); return; }
        const data = await res.json();
        token = data.token;
      } catch {
        setError("Stream auth failed");
        return;
      }

      if (cancelled) return;

      // Step 2: open EventSource
      const url = `${apiBase}/api/releases/${releaseId}/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("connected", () => {
        setStatus("connected");
        setError(null);
      });

      es.addEventListener("signal_progress", (e) => {
        try {
          const d = JSON.parse(e.data);
          setStatus("collecting");
          if (d.early_warning) setEarlyWarning(d.early_warning);
          setEvents((prev) => [...prev.slice(-49), { type: "signal_progress", ...d }]);
        } catch (_) {}
      });

      es.addEventListener("verdict", (e) => {
        try {
          const d = JSON.parse(e.data);
          setStatus("verdict_issued");
          setEvents((prev) => [...prev.slice(-49), { type: "verdict", ...d }]);
        } catch (_) {}
      });

      es.addEventListener("stream_end", () => {
        setStatus("closed");
        es.close();
      });

      es.onerror = () => {
        if (!cancelled) setError("Stream disconnected");
        es.close();
      };
    }

    openStream();

    return () => {
      cancelled = true;
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [releaseId, enabled]);

  return { events, status, earlyWarning, error };
}
