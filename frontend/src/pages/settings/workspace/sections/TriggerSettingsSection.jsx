import React, { useMemo } from "react";
import { TRIGGER_MODES, MVP_TRIGGER_MODE_IDS } from "../../settingsData.js";

export default function TriggerSettingsSection({ section, wsId, triggerConfig, setTriggerConfig, saveTrigger, toast }) {
  const visibleModes = TRIGGER_MODES.filter((m) => MVP_TRIGGER_MODE_IDS.includes(m.id));
  const modeCfg = useMemo(() => {
    const m = triggerConfig.mode;
    const configs = {
      label: { title: "GitHub label configuration", body: "label" },
      webhook: { title: "Webhook endpoint", body: "webhook" }
    };
    return configs[m] || { title: "Optional automation", body: "none" };
  }, [triggerConfig.mode]);

  return (
    <div className={`section${section === "trigger" ? " active" : ""}`} id="panel-trigger">
      <div className="section-header">
        <div className="section-eyebrow">Integration</div>
        <h1 className="section-h1">
          Release <em>Trigger</em>
        </h1>
        <p className="section-desc">
          Releases start from <strong>New release</strong> on the dashboard by default. Optionally connect GitHub or your pipeline here to open certification windows automatically. You can change this at any time without affecting past records.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Trigger mode</div>
            <div className="sblock-desc">Optional — choose an automation trigger, or continue using New release on the Releases page.</div>
          </div>
        </div>
        <div className="sblock-body">
          {visibleModes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`trigger-option${triggerConfig.mode === m.id ? " active" : ""}`}
              onClick={() => setTriggerConfig((c) => ({ ...c, mode: m.id }))}
            >
              <span className="trigger-icon">{m.icon}</span>
              <div>
                <div className="trigger-name">
                  {m.name}
                  {triggerConfig.mode === m.id ? <span className="trigger-active-tag">ACTIVE</span> : null}
                </div>
                <div className="trigger-desc">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">{modeCfg.title}</div>
            <div className="sblock-desc">Configure the selected trigger mode.</div>
          </div>
        </div>
        <div className="sblock-body">
          {modeCfg.body === "none" ? (
            <div style={{ background: "var(--raise)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", fontSize: 13, color: "var(--mid)", lineHeight: 1.65 }}>
              No automation trigger selected. Use <strong>New release</strong> on the Releases page, or choose GitHub label or Pipeline webhook above.
            </div>
          ) : null}
          {triggerConfig.mode === "label" ? (
            <div className="field" style={{ maxWidth: 320 }}>
              <label className="field-label">Label name</label>
              <input
                className="inp"
                value={triggerConfig.label || "verdikt:rc"}
                onChange={(e) => setTriggerConfig((c) => ({ ...c, label: e.target.value }))}
                placeholder="e.g. verdikt:rc"
                style={{ marginTop: 6 }}
              />
              <div className="field-hint">
                Apply this label to a PR or release in GitHub to open a certification window. Verdikt requires a GitHub webhook configured in your repo settings.
              </div>
            </div>
          ) : null}
          {triggerConfig.mode === "webhook" ? (
            <div>
              <div className="field">
                <label className="field-label">Inbound endpoint</label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input className="inp mono" readOnly style={{ color: "var(--accentL)" }} value={`https://api.useverdikt.com/api/workspaces/${wsId}/integrations/evals`} />
                  <button type="button" className="btn-secondary" onClick={() => toast("Endpoint URL copied")}>
                    Copy
                  </button>
                </div>
                <div className="field-hint">POST signed payloads from your eval/release pipeline.</div>
              </div>
              <pre style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 11, color: "var(--mid)", overflowX: "auto", margin: "8px 0 0" }}>{`POST https://api.useverdikt.com/api/workspaces/${wsId}/integrations/evals\n{\n  "provider": "braintrust",\n  "release_ref": "rc/model-v2.4.1",\n  "payload": { "metrics": { "exact_match": 83 } }\n}`}</pre>
            </div>
          ) : null}
        </div>
        <div className="sblock-footer">
          <button type="button" className="btn-primary" onClick={saveTrigger}>
            Save trigger settings
          </button>
        </div>
      </div>
    </div>
  );
}
