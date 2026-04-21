import React, { useState } from "react";
import { authHeaders, resolveApiOrigin } from "../../../lib/apiClient.js";
import { api } from "../api.js";
import { C } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Card } from "../ui.jsx";

export function SsePanel({ wsId: _wsId }) {
  const [releaseId, setReleaseId] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [events, setEvents] = useState([]);
  const esRef = React.useRef(null);
  const apiBase = resolveApiOrigin();

  const start = async () => {
    if (!releaseId) return;
    setEvents([]);
    try {
      const res = await api(`/api/releases/${releaseId}/sse-token`, { method: "POST", headers: authHeaders() });
      if (!res.ok) { setEvents([{ type: "error", msg: "Could not get stream token" }]); return; }
      const { token } = await res.json();
      const es = new EventSource(`${apiBase}/api/releases/${releaseId}/stream?token=${encodeURIComponent(token)}`);
      esRef.current = es;
      setStreaming(true);

      for (const evtName of ["connected", "signal_progress", "verdict", "stream_end"]) {
        es.addEventListener(evtName, (e) => {
          try {
            const d = JSON.parse(e.data);
            setEvents((prev) => [...prev, { type: evtName, ...d, _ts: new Date().toISOString() }]);
          } catch (_) {}
          if (evtName === "stream_end" || evtName === "verdict") { es.close(); setStreaming(false); }
        });
      }
      es.onerror = () => { setStreaming(false); setEvents((p) => [...p, { type: "error", msg: "Stream error" }]); };
    } catch (_) { setEvents([{ type: "error", msg: "Failed to connect" }]); }
  };

  const stop = () => {
    esRef.current?.close(); esRef.current = null; setStreaming(false);
  };

  const EVT_COLOR = { connected: C.green, signal_progress: C.cyan, verdict: C.accent, stream_end: C.dim, error: C.red };

  return (
    <Card title="Live Collecting Stream (SSE)" eyebrow="REAL-TIME">
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input className="inp inp-mono" placeholder="Release ID (rel_...)" value={releaseId} onChange={(e) => setReleaseId(e.target.value)} style={{ flex: 1 }} />
        {!streaming
          ? <button onClick={start} disabled={!releaseId} style={btnStyle(C.green)}>Connect</button>
          : <button onClick={stop} style={btnStyle(C.red)}>Disconnect</button>
        }
      </div>
      {streaming && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, boxShadow: `0 0 8px ${C.green}` }} />
          <span style={{ fontSize: 12, color: C.green, fontFamily: C.mono }}>LIVE</span>
        </div>
      )}
      <div style={{ fontFamily: C.mono, fontSize: 12, background: "#070810", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, minHeight: 120, maxHeight: 260, overflowY: "auto" }}>
        {!events.length && <span style={{ color: C.dim }}>Waiting for events…</span>}
        {events.map((ev, i) => (
          <div key={i} style={{ color: EVT_COLOR[ev.type] || C.mid, marginBottom: 4 }}>
            <span style={{ color: C.dim }}>[{ev._ts?.slice(11, 19) || "--:--:--"}]</span>{" "}
            <span style={{ fontWeight: 700 }}>{ev.type.toUpperCase()}</span>{" "}
            {ev.status && <span style={{ color: C.mid }}>status={ev.status}</span>}{" "}
            {ev.missing_required != null && <span style={{ color: C.amber }}>missing={ev.missing_required}</span>}{" "}
            {ev.early_warning?.overall_risk && ev.early_warning.overall_risk !== "stable" && (
              <span style={{ color: C.red }}>⚠ {ev.early_warning.overall_risk}</span>
            )}
            {ev.type === "error" && <span style={{ color: C.red }}>{ev.msg}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
