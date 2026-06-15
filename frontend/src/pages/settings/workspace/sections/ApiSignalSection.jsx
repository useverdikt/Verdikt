import React, { useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiPost, apiPostFormData, resolveApiOrigin } from "../../settingsClient.js";
import { sourceStatusDisplay, formatCsvRowCountLabel, formatSignalTypeCount, CSV_IMPORT_DETAIL } from "../settingsWorkspaceModel.js";
import { pullConnectorUi } from "../../../../lib/signalSourceCatalog.js";
import IntegrationReadinessPanel from "./IntegrationReadinessPanel.jsx";

const API_PUSH_DOCS_URL = "https://docs.useverdikt.com/connecting-signals/api-push";

function PullConnectorRow({ connector, wsId, navigate, toast, loadSignalSources, onConnect }) {
  const ui = pullConnectorUi(connector.source_id);
  const connected = !!connector.connected;
  return (
    <div className="source-row">
      <div className="source-icon-wrap">{ui.icon}</div>
      <div className="source-info">
        <div className="source-name">{ui.name}</div>
        <div className="source-detail" title={ui.signalNamesLabel ? `Signals: ${ui.signalNamesLabel}` : undefined}>
          {connected && connector.masked_key
            ? `${ui.detail} · key ${connector.masked_key}`
            : `${ui.detail}${connector.signal_count ? ` · ${formatSignalTypeCount(connector.signal_count)}` : ""}`}
        </div>
      </div>
      <div className="source-status" style={{ color: connected ? "var(--green)" : "var(--fg3)", display: "flex", alignItems: "center", gap: 6 }}>
        <div className="status-dot" style={{ background: connected ? "var(--green)" : "var(--fg3)" }} />
        {connected ? "Connected" : "Not connected"}
      </div>
      <div className="source-actions">
        {connected ? (
          <button
            type="button"
            className="api-key-revoke"
            onClick={async () => {
              try {
                await apiDelete(`/api/workspaces/${wsId}/signal-integrations/${connector.source_id}`, { navigate });
                await loadSignalSources();
                toast(`${ui.name} disconnected`);
              } catch (e) {
                toast(e?.message || "Disconnect failed");
              }
            }}
          >
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn-ghost accent" onClick={() => onConnect({ sourceId: connector.source_id, name: ui.name })}>
            Connect
          </button>
        )}
      </div>
    </div>
  );
}

function ActiveApiPushSummary({ signalCount }) {
  if (!signalCount) return null;
  return (
    <div className="source-row">
      <div className="source-icon-wrap">↗</div>
      <div className="source-info">
        <div className="source-name">API push</div>
        <div className="source-detail">
          {signalCount} signal{signalCount === 1 ? "" : "s"} active in{" "}
          <Link to="/thresholds" style={{ color: "var(--accentL)" }}>
            Thresholds
          </Link>
        </div>
      </div>
      <div className="source-status" style={{ color: "var(--certified)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="status-dot" style={{ background: "var(--certified)" }} />
          Active
        </div>
      </div>
      <div className="source-actions">
        <span style={{ fontSize: 11, color: "var(--fg3)", fontFamily: "var(--mono)" }}>API push</span>
      </div>
    </div>
  );
}

function CsvImportRow({ csvImport, csvInputRef, wsId, navigate, toast, loadSignalSources }) {
  const connected = csvImport && Number(csvImport.row_count) > 0;
  const st = sourceStatusDisplay({
    sourceType: "upload",
    status: connected ? "connected" : "not connected",
    statusColor: connected ? "var(--certified)" : "var(--dim)",
    detail: connected ? `${formatCsvRowCountLabel(csvImport.row_count)} from ${csvImport.filename}` : CSV_IMPORT_DETAIL
  });
  return (
    <div className="source-row">
      <div className="source-icon-wrap">⊞</div>
      <div className="source-info">
        <div className="source-name">CSV import</div>
        <div className="source-detail">{connected ? st.label === "Import in use" ? `${formatCsvRowCountLabel(csvImport.row_count)} from ${csvImport.filename}` : CSV_IMPORT_DETAIL : CSV_IMPORT_DETAIL}</div>
      </div>
      <div className="source-status" style={{ color: st.color }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="status-dot" style={{ background: st.color }} />
          {st.label}
        </div>
      </div>
      <div className="source-actions" style={{ display: "flex", gap: 8 }}>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const fd = new FormData();
            fd.append("file", f);
            try {
              const out = await apiPostFormData(`/api/workspaces/${wsId}/signal-csv-imports`, fd, { navigate });
              await loadSignalSources();
              const ar = out.apply_result;
              let msg = `Imported ${formatCsvRowCountLabel(out.row_count)} from ${out.filename}`;
              if (ar?.applied && Array.isArray(ar.releases)) {
                msg += ` — signals applied to ${ar.releases.length} release(s)`;
                if (ar.skipped?.length) msg += ` (${ar.skipped.length} row(s) skipped — check version column matches a release)`;
              } else if (ar?.reason) {
                msg += ` (apply: ${ar.reason})`;
              }
              toast(msg);
            } catch (err) {
              toast(err?.message || "Upload failed");
            }
          }}
        />
        {connected ? (
          <button
            type="button"
            className="api-key-revoke"
            onClick={async () => {
              try {
                await apiDelete(`/api/workspaces/${wsId}/signal-csv-imports`, { navigate });
                await loadSignalSources();
                toast("CSV import cleared");
              } catch (err) {
                toast(err?.message || "Clear failed");
              }
            }}
          >
            Clear
          </button>
        ) : null}
        <button type="button" className="btn-ghost accent" onClick={() => csvInputRef.current?.click()}>
          {connected ? "Replace CSV" : "Import CSV"}
        </button>
      </div>
    </div>
  );
}

export default function ApiSignalSection({
  section,
  wsId,
  navigate,
  toast,
  signalPanel,
  signalPanelLoading = false,
  signalPanelError = null,
  setConnectModal,
  csvInputRef,
  loadSignalSources,
  setSection
}) {
  const [requestName, setRequestName] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);

  const pullConnectors = signalPanel?.pull_connectors || [];
  const pushSources = signalPanel?.push_sources || [];
  const requests = signalPanel?.integration_requests || [];
  const apiPush = signalPanel?.api_push || {};
  const csvImport = signalPanel?.csv_import;

  const connectedPull = pullConnectors.filter((c) => c.connected);
  const availablePull = pullConnectors.filter((c) => !c.connected);
  const activePushSignalCount = pushSources.reduce((n, s) => n + (s.active ? Number(s.signal_count) || 0 : 0), 0);
  const hasActivePush = activePushSignalCount > 0;
  const apiOrigin = resolveApiOrigin();
  const ingestExample = `${apiOrigin || ""}${apiPush.ingest_path || "/api/releases/{release_id}/signals"}`;

  const submitRequest = async () => {
    const name = requestName.trim();
    if (!name) {
      toast("Enter the integration or vendor name");
      return;
    }
    setRequestSubmitting(true);
    try {
      await apiPost(
        `/api/workspaces/${wsId}/integration-requests`,
        { source_name: name, notes: requestNotes.trim() || undefined },
        { navigate }
      );
      setRequestName("");
      setRequestNotes("");
      await loadSignalSources();
      toast("Integration request submitted — we'll follow up");
    } catch (e) {
      toast(e?.message || "Request failed");
    } finally {
      setRequestSubmitting(false);
    }
  };

  return (
    <div className={`section${section === "api" ? " active" : ""}`} id="panel-api">
      <div className="section-header">
        <div className="section-eyebrow">Integration</div>
        <h1 className="section-h1">
          <em>Signal Sources</em>
        </h1>
        <p className="section-desc">
          Connect vendor APIs for pull-by-commit, push custom signals over HTTP, or request a new integration.
        </p>
      </div>
      <IntegrationReadinessPanel wsId={wsId} navigate={navigate} toast={toast} />

      {signalPanelError ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            borderRadius: 8,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#fca5a5",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12
          }}
        >
          <span>{signalPanelError}</span>
          <button type="button" className="btn-ghost accent" onClick={() => void loadSignalSources()}>
            Retry
          </button>
        </div>
      ) : null}

      {signalPanelLoading && !signalPanel ? (
        <div style={{ padding: "24px 18px", color: "var(--fg3)", fontSize: 13 }}>Loading signal sources…</div>
      ) : null}

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Connected</div>
            <div className="sblock-desc">Pull integrations with saved credentials, active API push signals, or CSV import in use.</div>
          </div>
        </div>
        <div className="sblock-body">
          {connectedPull.length === 0 && !hasActivePush && !csvImport ? (
            <div style={{ padding: "16px 18px", color: "var(--fg3)", fontSize: 13 }}>
              Nothing connected yet — connect a pull integration below, set up API push, or import CSV.
            </div>
          ) : null}
          {connectedPull.map((c) => (
            <PullConnectorRow
              key={c.source_id}
              connector={c}
              wsId={wsId}
              navigate={navigate}
              toast={toast}
              loadSignalSources={loadSignalSources}
              onConnect={setConnectModal}
            />
          ))}
          <ActiveApiPushSummary signalCount={activePushSignalCount} />
          <CsvImportRow csvImport={csvImport} csvInputRef={csvInputRef} wsId={wsId} navigate={navigate} toast={toast} loadSignalSources={loadSignalSources} />
        </div>
      </div>

      {availablePull.length > 0 ? (
        <div className="sblock">
          <div className="sblock-head">
            <div>
              <div className="sblock-title">Available to connect</div>
              <div className="sblock-desc">Save API credentials — Verdikt pulls metrics by commit SHA when a cert window opens.</div>
            </div>
          </div>
          <div className="sblock-body">
            {availablePull.map((c) => (
              <PullConnectorRow
                key={c.source_id}
                connector={c}
                wsId={wsId}
                navigate={navigate}
                toast={toast}
                loadSignalSources={loadSignalSources}
                onConnect={setConnectModal}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">API push</div>
            <div className="sblock-desc">POST signal values from your pipeline or partner systems — no pull credentials required.</div>
          </div>
          <button type="button" className="btn-ghost accent" onClick={() => setSection("agent")}>
            Agent access →
          </button>
        </div>
        <div className="sblock-body">
          <div style={{ padding: "16px 18px" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accentL)", letterSpacing: "0.1em", marginBottom: 8 }}>INGEST ENDPOINT</div>
            <div className="inp mono" style={{ fontSize: 12, padding: "10px 12px", color: "var(--green)", wordBreak: "break-all" }}>
              POST {ingestExample}
            </div>
            <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 10, lineHeight: 1.6 }}>
              Bearer API key from Settings → Agent access. POST JSON with signal values keyed by signal_id.
            </div>
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <a href={API_PUSH_DOCS_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accentL)" }}>
                Full setup guide → docs.useverdikt.com/connecting-signals/api-push
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Request integration</div>
            <div className="sblock-desc">Need a pull connector we don't ship yet? Tell us what to build.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ padding: "18px" }}>
          <div style={{ display: "grid", gap: 12, maxWidth: 480, marginBottom: requests.length ? 20 : 0 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Vendor or product</label>
              <input
                className="inp"
                value={requestName}
                onChange={(e) => setRequestName(e.target.value)}
                placeholder="e.g. Weights & Biases, Honeycomb"
                maxLength={120}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Notes (optional)</label>
              <textarea
                className="inp"
                rows={3}
                value={requestNotes}
                onChange={(e) => setRequestNotes(e.target.value)}
                placeholder="What signals do you need? How do you tag commits?"
                style={{ resize: "vertical" }}
              />
            </div>
            <button type="button" className="btn-primary" style={{ width: "fit-content" }} disabled={requestSubmitting} onClick={submitRequest}>
              {requestSubmitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
          {requests.length > 0 ? (
            <div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accentL)", letterSpacing: "0.1em", marginBottom: 10 }}>YOUR REQUESTS</div>
              {requests.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #1a1f2e", fontSize: 13 }}>
                  <div>
                    <div style={{ color: "var(--fg)" }}>{r.source_name}</div>
                    {r.notes ? <div style={{ color: "var(--fg3)", marginTop: 4 }}>{r.notes}</div> : null}
                  </div>
                  <div style={{ color: "var(--fg3)", fontFamily: "var(--mono)", fontSize: 11, whiteSpace: "nowrap" }}>{r.status}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
