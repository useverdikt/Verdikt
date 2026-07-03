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

const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

export function useReleaseStream(releaseId, enabled = true) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState(null);
  const [earlyWarning, setEarlyWarning] = useState(null);
  const [error, setError] = useState(null);
  const [collectionDeadline, setCollectionDeadline] = useState(null);
  const esRef = useRef(null);
  const terminalRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    if (!releaseId || !enabled) return;

    const apiBase = resolveApiOrigin();
    let cancelled = false;
    terminalRef.current = false;
    reconnectAttemptRef.current = 0;

    function scheduleReconnect(connect) {
      if (cancelled || terminalRef.current) return;
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError("Stream disconnected");
        return;
      }
      const delay = Math.min(BASE_RECONNECT_MS * 2 ** reconnectAttemptRef.current, MAX_RECONNECT_MS);
      reconnectAttemptRef.current += 1;
      setError("Reconnecting…");
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
    }

    async function connect() {
      if (cancelled || terminalRef.current) return;

      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      let token;
      try {
        const res = await fetch(`${apiBase}/api/releases/${releaseId}/sse-token`, apiFetchInit({ method: "POST" }));
        if (!res.ok) {
          scheduleReconnect(connect);
          return;
        }
        const data = await res.json();
        token = data.token;
      } catch {
        scheduleReconnect(connect);
        return;
      }

      if (cancelled || terminalRef.current) return;

      const url = `${apiBase}/api/releases/${releaseId}/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("connected", () => {
        reconnectAttemptRef.current = 0;
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

      es.addEventListener("deadline_extended", (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.collection_deadline) setCollectionDeadline(d.collection_deadline);
          setEvents((prev) => [...prev.slice(-49), { type: "deadline_extended", ...d }]);
        } catch (_) {}
      });

      es.addEventListener("verdict", (e) => {
        try {
          const d = JSON.parse(e.data);
          terminalRef.current = true;
          setStatus("verdict_issued");
          setError(null);
          setEvents((prev) => [...prev.slice(-49), { type: "verdict", ...d }]);
        } catch (_) {}
      });

      es.addEventListener("stream_end", () => {
        terminalRef.current = true;
        setStatus("closed");
        setError(null);
        es.close();
        esRef.current = null;
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelled || terminalRef.current) return;
        scheduleReconnect(connect);
      };
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [releaseId, enabled]);

  return { events, status, earlyWarning, error, collectionDeadline };
}
