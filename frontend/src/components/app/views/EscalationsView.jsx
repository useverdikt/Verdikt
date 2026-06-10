import React, { useCallback, useEffect, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { apiGet, apiPost } from "../../../pages/settings/settingsClient.js";
import { getWorkspaceId } from "../../../lib/apiClient.js";
import EscalationOverrideModal from "../modals/EscalationOverrideModal.jsx";

function formatTs(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function EscalationsView({ isMobile, wsReady = true, onSelectRelease, currentUser }) {
  const wsId = getWorkspaceId();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overrideRow, setOverrideRow] = useState(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const canAcknowledge = ["vp_engineering", "cto", "org_admin", "release_manager"].includes(
    String(currentUser?.role || "")
  );

  const load = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    setError(null);
    try {
      const out = await apiGet(`/api/workspaces/${wsId}/escalations?state=pending_human_review`);
      setItems(Array.isArray(out.escalations) ? out.escalations : []);
    } catch (e) {
      setError(e?.message || "Could not load escalations");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    if (wsReady) void load();
  }, [wsReady, load]);

  async function handleAcknowledgeAndOverride(payload) {
    if (!wsId || !overrideRow || !canAcknowledge) return;
    setOverrideBusy(true);
    setError(null);
    try {
      await apiPost(`/api/workspaces/${wsId}/escalations/${overrideRow.id}/acknowledge-and-override`, {
        note: "Resolved from escalation inbox",
        ...payload
      });
      setOverrideRow(null);
      await load();
    } catch (e) {
      setError(e?.message || "Acknowledge & override failed");
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.dim, marginBottom: 6 }}>
          Human handoff
        </div>
        <h2 style={{ margin: 0, fontFamily: C.serif, fontSize: 28, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
          Escalation Inbox
        </h2>
        <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 13 }}>
          Agent-requested reviews when self-heal is blocked. Acknowledge &amp; Override certifies the release in one step.
        </p>
      </div>

      {error ? (
        <div style={{ color: C.red, fontSize: 13, fontFamily: C.mono }}>{error}</div>
      ) : null}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "140px 1fr 120px 140px",
            gap: 14,
            padding: isMobile ? "8px 12px" : "10px 18px",
            borderBottom: `1px solid ${C.border}`,
            fontFamily: C.mono,
            fontSize: 9.5,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: C.dim,
            background: C.raise
          }}
        >
          {!isMobile ? <div>Opened</div> : null}
          <div>Release / reason</div>
          {!isMobile ? <div>SLA</div> : null}
          <div style={{ textAlign: isMobile ? "left" : "right" }}>Action</div>
        </div>

        {!wsReady || loading ? (
          <div style={{ padding: "32px 18px", textAlign: "center", color: C.dim, fontFamily: C.mono, fontSize: 12 }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: "32px 18px", textAlign: "center", color: C.dim, fontFamily: C.mono, fontSize: 12 }}>
            No pending escalations — agents are self-healing or certified.
          </div>
        ) : (
          items.map((row, i) => (
            <div
              key={row.id}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "140px 1fr 120px 140px",
                gap: 14,
                padding: isMobile ? "12px 12px" : "14px 18px",
                borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : "none",
                alignItems: "flex-start"
              }}
            >
              {!isMobile ? (
                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.dim }}>{formatTs(row.created_at)}</div>
              ) : null}
              <div>
                <button
                  type="button"
                  onClick={() => onSelectRelease?.({ backendReleaseId: row.release_id, version: row.release_version })}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: C.accent,
                    fontFamily: C.mono,
                    fontSize: 12,
                    textAlign: "left"
                  }}
                >
                  {row.release_version || row.release_id}
                </button>
                {row.pr_number ? (
                  <div style={{ fontFamily: C.mono, fontSize: 10, color: C.dim, marginTop: 4 }}>PR #{row.pr_number}</div>
                ) : null}
                <div style={{ marginTop: 6, fontSize: 13, color: C.text, lineHeight: 1.45 }}>{row.reason}</div>
                {row.blocking_signals?.length ? (
                  <div style={{ marginTop: 6, fontFamily: C.mono, fontSize: 10, color: C.amber }}>
                    Blocking: {row.blocking_signals.join(", ")}
                  </div>
                ) : null}
                <div style={{ marginTop: 4, fontFamily: C.mono, fontSize: 10, color: C.dim }}>
                  Agent: {row.requested_by_name || "—"}
                </div>
              </div>
              {!isMobile ? (
                <div style={{ fontFamily: C.mono, fontSize: 11, color: row.sla_breached ? C.red : C.dim }}>
                  {row.sla_breached ? "Overdue" : formatTs(row.sla_due_at)}
                </div>
              ) : null}
              <div style={{ textAlign: isMobile ? "left" : "right" }}>
                {canAcknowledge ? (
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    onClick={() => setOverrideRow(row)}
                  >
                    Ack &amp; Override
                  </button>
                ) : (
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.dim }}>VP/RM only</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {overrideRow ? (
        <EscalationOverrideModal
          row={overrideRow}
          currentUser={currentUser}
          busy={overrideBusy}
          onClose={() => !overrideBusy && setOverrideRow(null)}
          onConfirm={(payload) => void handleAcknowledgeAndOverride(payload)}
        />
      ) : null}
    </div>
  );
}
