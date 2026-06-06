import React from "react";
import { apiDelete, apiPostFormData } from "../../settingsClient.js";
import { sourceStatusDisplay } from "../settingsWorkspaceModel.js";

export default function ApiSignalSection({
  section,
  wsId,
  navigate,
  toast,
  sources,
  setSources,
  expandedSource,
  setExpandedSource,
  setConnectModal,
  csvInputRef,
  loadSignalSources
}) {
  return (
    <div className={`section${section === "api" ? " active" : ""}`} id="panel-api">
      <div className="section-header">
        <div className="section-eyebrow">Integration</div>
        <h1 className="section-h1">
          <em>Signal Sources</em>
        </h1>
        <p className="section-desc">
          Connect external signal sources and ingest data into this workspace.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Signal sources</div>
            <div className="sblock-desc">API integrations and CSV import that feed signal data into Verdikt.</div>
          </div>
          <button type="button" className="btn-ghost accent" onClick={() => toast("Add source — coming in integration docs")}>
            + Add source
          </button>
        </div>
        <div className="sblock-body">
          {sources.map((s, i) => {
            const st = sourceStatusDisplay(s);
            const isUpload = s.sourceType === "upload";
            return (
              <div key={s.sourceId || s.name}>
                <div className="source-row">
                  <div className="source-icon-wrap">{s.icon}</div>
                  <div className="source-info">
                    <div className="source-name">{s.name}</div>
                    <div className="source-detail">{s.detail}</div>
                  </div>
                  <div className="source-status" style={{ color: st.color }}>
                    <div className="status-dot" style={{ background: st.color }} />
                    {st.label}
                  </div>
                  <div className="source-actions">
                    {s.status === "connected" || s.status === "active" ? (
                      <>
                        {s.mapping ? (
                          <button type="button" className="btn-ghost" onClick={() => setExpandedSource((ex) => (ex === i ? null : i))}>
                            {expandedSource === i ? "▴ Mapping" : "▾ Mapping"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="api-key-revoke"
                          onClick={async () => {
                            if (isUpload) {
                              try {
                                await apiDelete(`/api/workspaces/${wsId}/signal-csv-imports`, { navigate });
                                await loadSignalSources();
                                toast("CSV import removed");
                              } catch (e) {
                                toast(e?.message || "Could not remove import");
                              }
                              return;
                            }
                            try {
                              await apiDelete(`/api/workspaces/${wsId}/signal-integrations/${s.sourceId}`, { navigate });
                              await loadSignalSources();
                              toast(`${s.name} disconnected`);
                            } catch (e) {
                              toast(e?.message || "Disconnect failed");
                            }
                          }}
                        >
                          {isUpload ? "Remove import" : "Disconnect"}
                        </button>
                      </>
                    ) : isUpload ? (
                      <>
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
                              let msg = `Imported ${out.row_count} rows from ${out.filename}`;
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
                        <button type="button" className="btn-ghost accent" onClick={() => csvInputRef.current?.click()}>
                          Upload CSV
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-ghost accent" onClick={() => setConnectModal({ sourceId: s.sourceId, name: s.name })}>
                        Connect
                      </button>
                    )}
                  </div>
                </div>
                {expandedSource === i && s.mapping ? (
                  <div style={{ background: "var(--bg)", borderTop: "1px solid #1a1f2e", padding: "18px 18px 18px 52px" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accentL)", letterSpacing: "0.1em", marginBottom: 12 }}>VERSION MAPPING</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 560, marginBottom: 12 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label className="field-label" style={{ fontSize: 10 }}>
                          {s.mapping.versionField}
                        </label>
                        <input
                          className="inp mono"
                          style={{ marginTop: 6 }}
                          value={s.mapping.pattern}
                          onChange={(e) => {
                            setSources((prev) => {
                              const n = [...prev];
                              n[i] = { ...n[i], mapping: { ...n[i].mapping, pattern: e.target.value } };
                              return n;
                            });
                          }}
                        />
                        <div className="field-hint">Use {"{version}"} for the canonical version string.</div>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label className="field-label" style={{ fontSize: 10 }}>
                          Example value
                        </label>
                        <input
                          className="inp mono"
                          style={{ marginTop: 6, color: "var(--green)" }}
                          value={s.mapping.example}
                          onChange={(e) => {
                            setSources((prev) => {
                              const n = [...prev];
                              n[i] = { ...n[i], mapping: { ...n[i].mapping, example: e.target.value } };
                              return n;
                            });
                          }}
                        />
                        <div className="field-hint">Reference for your org.</div>
                      </div>
                    </div>
                    <div style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 7, padding: "10px 14px", fontSize: 12, color: "var(--mid)", lineHeight: 1.6, marginBottom: 12 }}>{s.mapping.note}</div>
                    <button type="button" className="btn-primary" style={{ fontSize: 12, padding: "7px 18px" }} onClick={() => toast(`${s.name} mapping saved`)}>
                      Save mapping
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
