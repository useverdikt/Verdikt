import React, { useEffect, useState } from "react";
import { apiFetchInit, resolveApiOrigin } from "../settingsClient.js";

const BASELINE_STRATEGIES = [
  { id: "median_n", label: "Median (N releases)", desc: "Uses the median of the N most recent certified releases per signal. Robust to outliers." },
  { id: "trimmed_mean_n", label: "Trimmed mean (N releases)", desc: "Drops the top and bottom 10% of values before averaging. Best for large windows." },
  { id: "last_certified", label: "Last certified", desc: "Classic mode — uses the single most recent certified release as the baseline." },
  { id: "pinned_golden", label: "Pinned golden release", desc: "Manually pin a specific certified release as the immutable golden baseline." }
];

export default function GovernancePanel({ section, wsId, toast }) {
  const [, setBaselinePolicyState] = useState(null);
  const [bpSaving, setBpSaving] = useState(false);
  const [bpDraft, setBpDraft] = useState(null);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("CERTIFIED,UNCERTIFIED,CERTIFIED_WITH_OVERRIDE");
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);

  const [integrityResult, setIntegrityResult] = useState(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);

  const apiBase = resolveApiOrigin();

  useEffect(() => {
    if (section !== "governance" || !wsId) return;
    fetch(`${apiBase}/api/workspaces/${wsId}/baseline-policy`, apiFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setBaselinePolicyState(data);
          setBpDraft(data);
        }
      })
      .catch(() => {});
    fetch(`${apiBase}/api/workspaces/${wsId}/outbound-webhook`, apiFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setWebhookUrl(data.url || "");
          setWebhookEvents(data.events || "CERTIFIED,UNCERTIFIED,CERTIFIED_WITH_OVERRIDE");
          setWebhookSaved(true);
        }
      })
      .catch(() => {});
  }, [section, wsId, apiBase]);

  async function saveBaselinePolicy() {
    if (!bpDraft || !wsId) return;
    setBpSaving(true);
    try {
      const res = await fetch(
        `${apiBase}/api/workspaces/${wsId}/baseline-policy`,
        apiFetchInit({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy: bpDraft.strategy,
            window_n: Number(bpDraft.window_n),
            pinned_release_id: bpDraft.pinned_release_id || null
          })
        })
      );
      if (res.ok) {
        const d = await res.json();
        setBaselinePolicyState(d);
        setBpDraft(d);
        toast("Baseline policy saved");
      } else {
        const e = await res.json();
        toast(e.error || "Save failed");
      }
    } catch {
      toast("Network error");
    } finally {
      setBpSaving(false);
    }
  }

  async function saveWebhook() {
    if (!wsId || !webhookUrl) return;
    setWebhookSaving(true);
    try {
      const res = await fetch(
        `${apiBase}/api/workspaces/${wsId}/outbound-webhook`,
        apiFetchInit({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl, secret: webhookSecret || undefined, events: webhookEvents })
        })
      );
      if (res.ok) {
        setWebhookSaved(true);
        toast("Outbound webhook saved");
      } else {
        const e = await res.json();
        toast(e.error || "Save failed");
      }
    } catch {
      toast("Network error");
    } finally {
      setWebhookSaving(false);
    }
  }

  async function deleteWebhook() {
    if (!wsId) return;
    try {
      await fetch(`${apiBase}/api/workspaces/${wsId}/outbound-webhook`, apiFetchInit({ method: "DELETE" }));
      setWebhookUrl("");
      setWebhookSecret("");
      setWebhookSaved(false);
      toast("Outbound webhook removed");
    } catch {
      toast("Network error");
    }
  }

  async function runIntegrityCheck() {
    if (!wsId) return;
    setIntegrityLoading(true);
    setIntegrityResult(null);
    try {
      const res = await fetch(`${apiBase}/api/workspaces/${wsId}/audit/integrity`, apiFetchInit());
      if (res.ok) setIntegrityResult(await res.json());
      else setIntegrityResult({ error: "Check failed" });
    } catch {
      setIntegrityResult({ error: "Network error" });
    } finally {
      setIntegrityLoading(false);
    }
  }

  const CELL = { borderBottom: "1px solid var(--border)", padding: "9px 12px", fontSize: 12.5, color: "var(--mid)" };
  const HEAD = {
    ...CELL,
    color: "var(--dim)",
    fontSize: 11,
    fontFamily: "var(--mono)",
    fontWeight: 600,
    letterSpacing: "0.06em",
    paddingTop: 6,
    paddingBottom: 6,
    background: "rgba(255,255,255,0.015)"
  };

  return (
    <div className={`section${section === "governance" ? " active" : ""}`} id="panel-governance">
      <div className="section-header">
        <div className="section-eyebrow">Trust &amp; Integrity</div>
        <h1 className="section-h1">Governance</h1>
        <p className="section-desc">
          Cryptographic signing, baseline hardening, outbound verdict delivery, and audit integrity enforcement. These settings define the trust boundary of every certification Verdikt issues.
        </p>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Baseline strategy</div>
            <div className="sblock-desc">Controls how regression baselines are computed for delta-threshold evaluation.</div>
          </div>
        </div>
        <div className="sblock-body">
          {BASELINE_STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`strategy-option${bpDraft?.strategy === s.id ? " active" : ""}`}
              onClick={() => setBpDraft((d) => (d ? { ...d, strategy: s.id } : { strategy: s.id, window_n: 5 }))}
            >
              <span className="strategy-radio">{bpDraft?.strategy === s.id ? "◉" : "○"}</span>
              <div>
                <div className="strategy-name">
                  {s.label}
                  {bpDraft?.strategy === s.id ? (
                    <span className="trigger-active-tag" style={{ background: "var(--purple-dim)", color: "var(--purple)" }}>
                      ACTIVE
                    </span>
                  ) : null}
                </div>
                <div className="strategy-desc">{s.desc}</div>
              </div>
            </button>
          ))}
          {(bpDraft?.strategy === "median_n" || bpDraft?.strategy === "trimmed_mean_n") && (
            <div className="field" style={{ maxWidth: 200, marginTop: 12 }}>
              <label className="field-label">Window size (N releases)</label>
              <input
                className="inp"
                type="number"
                min={2}
                max={20}
                value={bpDraft?.window_n ?? 5}
                onChange={(e) => setBpDraft((d) => (d ? { ...d, window_n: Number(e.target.value) } : d))}
                style={{ marginTop: 6, width: "100%" }}
              />
              <div className="field-hint">How many prior certified releases to include in the baseline window (2–20).</div>
            </div>
          )}
          {bpDraft?.strategy === "pinned_golden" && (
            <div className="field" style={{ maxWidth: 340, marginTop: 12 }}>
              <label className="field-label">Pinned release ID</label>
              <input
                className="inp mono"
                placeholder="rel_..."
                value={bpDraft?.pinned_release_id || ""}
                onChange={(e) => setBpDraft((d) => (d ? { ...d, pinned_release_id: e.target.value } : d))}
                style={{ marginTop: 6 }}
              />
              <div className="field-hint">Enter the release ID of the golden release to pin as the immutable baseline.</div>
            </div>
          )}
        </div>
        <div className="sblock-footer">
          <button type="button" className="btn-primary" onClick={saveBaselinePolicy} disabled={bpSaving}>
            {bpSaving ? "Saving…" : "Save baseline policy"}
          </button>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">
              Outbound verdict webhook
              {webhookSaved && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    fontFamily: "var(--mono)",
                    color: "var(--green)",
                    background: "rgba(16,185,129,0.1)",
                    padding: "1px 6px",
                    borderRadius: 3,
                    verticalAlign: "middle"
                  }}
                >
                  ACTIVE
                </span>
              )}
            </div>
            <div className="sblock-desc">
              Verdikt will POST a signed verdict payload to this URL whenever a release is certified or rejected. Use to close the CI/CD loop without polling.
            </div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="field" style={{ maxWidth: 480 }}>
            <label className="field-label">Endpoint URL</label>
            <input
              className="inp mono"
              placeholder="https://your-pipeline.example.com/verdikt-hook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              style={{ marginTop: 6 }}
            />
          </div>
          <div className="field" style={{ maxWidth: 480, marginTop: 12 }}>
            <label className="field-label">
              Signing secret <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              className="inp mono"
              type="password"
              placeholder="Your webhook secret — Verdikt signs with HMAC-SHA256"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              style={{ marginTop: 6 }}
            />
            <div className="field-hint">
              Verdikt will send <code style={{ fontSize: 11 }}>X-Verdikt-Signature: sha256=…</code> on each delivery.
            </div>
          </div>
          <div className="field" style={{ maxWidth: 480, marginTop: 12 }}>
            <label className="field-label">Subscribed events</label>
            <input className="inp mono" value={webhookEvents} onChange={(e) => setWebhookEvents(e.target.value)} style={{ marginTop: 6 }} />
            <div className="field-hint">
              Comma-separated. Options: <code style={{ fontSize: 11 }}>CERTIFIED, UNCERTIFIED, CERTIFIED_WITH_OVERRIDE</code>
            </div>
          </div>
        </div>
        <div className="sblock-footer" style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn-primary" onClick={saveWebhook} disabled={webhookSaving || !webhookUrl}>
            {webhookSaving ? "Saving…" : "Save webhook"}
          </button>
          {webhookSaved && (
            <button type="button" className="btn-secondary" onClick={deleteWebhook} style={{ color: "var(--red)" }}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Audit log integrity</div>
            <div className="sblock-desc">
              Verify that no audit records have been modified since they were written. Each row is content-hashed at write time with SHA-256.
            </div>
          </div>
        </div>
        <div className="sblock-body">
          {integrityResult && !integrityResult.error && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: integrityResult.tampered?.length > 0 ? "rgba(239,68,68,0.07)" : "rgba(16,185,129,0.07)",
                border: `1px solid ${integrityResult.tampered?.length > 0 ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
                borderRadius: 8,
                marginBottom: 12
              }}
            >
              <span style={{ fontSize: 15 }}>{integrityResult.tampered?.length > 0 ? "⚠" : "✓"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: integrityResult.tampered?.length > 0 ? "#ef4444" : "var(--green)" }}>
                  {integrityResult.tampered?.length > 0 ? `${integrityResult.tampered.length} tampered record(s) detected` : "All records verified"}
                </div>
                <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>
                  {integrityResult.ok}/{integrityResult.total} rows passed • {integrityResult.tampered?.length ?? 0} failed
                </div>
              </div>
            </div>
          )}
          {integrityResult?.error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{integrityResult.error}</div>}
          {integrityResult?.tampered?.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={HEAD}>Row ID</th>
                    <th style={HEAD}>Event type</th>
                    <th style={HEAD}>Created</th>
                    <th style={HEAD}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {integrityResult.tampered.map((r) => (
                    <tr key={r.id}>
                      <td style={CELL}>{r.id}</td>
                      <td style={CELL}>
                        <code style={{ fontSize: 11 }}>{r.event_type}</code>
                      </td>
                      <td style={CELL}>{r.created_at?.slice(0, 19)}</td>
                      <td style={{ ...CELL, color: "#ef4444" }}>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="sblock-footer">
          <button type="button" className="btn-secondary" onClick={runIntegrityCheck} disabled={integrityLoading}>
            {integrityLoading ? "Verifying…" : "Run integrity check"}
          </button>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Cryptographic certification signing</div>
            <div className="sblock-desc">
              Every CERTIFIED or CERTIFIED_WITH_OVERRIDE verdict is automatically signed with HMAC-SHA256 at issuance. Anyone can verify a certificate without credentials at{" "}
              <code style={{ fontSize: 11 }}>/api/releases/:id/cert/verify</code>.
            </div>
          </div>
        </div>
        <div className="sblock-body">
          <div
            style={{
              background: "rgba(16,185,129,0.06)",
              border: "1px solid rgba(16,185,129,0.15)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13,
              color: "var(--mid)",
              lineHeight: 1.65
            }}
          >
            <span style={{ color: "var(--green)", fontWeight: 600 }}>Always on. </span>
            Signatures are computed automatically — no configuration required. Each signed record includes a{" "}
            <code style={{ fontSize: 11 }}>payload_hash</code> and <code style={{ fontSize: 11 }}>signature</code> that can be embedded in your CI/CD gate check or audit report.
          </div>
        </div>
      </div>
    </div>
  );
}
