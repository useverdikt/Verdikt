import React, { useMemo } from "react";
import { TRIGGER_MODES, MVP_TRIGGER_MODE_IDS } from "../../settingsData.js";

export default function TriggerSettingsSection({
  section,
  wsId,
  triggerConfig,
  setTriggerConfig,
  saveTrigger,
  triggerDirty,
  toast,
  githubAppStatus,
  githubRepos,
  githubReposLoading,
  beginGithubAppConnect,
  toggleGithubRepoSelected,
  refreshGithubRepos,
  vcsForm,
  setVcsForm,
  vcsCfg,
  saveVcsIntegration,
  removeVcsIntegration,
  vcsSaving,
}) {
  const visibleModes = TRIGGER_MODES.filter((m) => MVP_TRIGGER_MODE_IDS.includes(m.id));
  const modeCfg = useMemo(() => {
    const m = triggerConfig.mode;
    const configs = {
      label: { title: "GitHub label configuration", body: "label" }
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
          Releases start from <strong>New release</strong> on the dashboard by default. Optionally connect GitHub here to open certification windows automatically. You can change this at any time without affecting past records.
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
              No automation trigger selected. Use <strong>New release</strong> on the Releases page, or choose GitHub label above.
            </div>
          ) : null}
          {triggerConfig.mode === "label" ? (
            <div style={{ width: "100%" }}>
              <div className="field" style={{ maxWidth: 420 }}>
                <label className="field-label">Label name</label>
                <input
                  className="inp"
                  value={triggerConfig.label || "verdikt:rc"}
                  onChange={(e) => setTriggerConfig((c) => ({ ...c, label: e.target.value }))}
                  placeholder="e.g. verdikt:rc"
                  style={{ marginTop: 6 }}
                />
                <div className="field-hint">Any PR with this label opens a Verdikt certification session.</div>
              </div>
              <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", background: "var(--raise)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--mid)" }}>GitHub App connection</div>
                    <div style={{ fontSize: 13, color: "var(--text)" }}>
                      {githubAppStatus.connected
                        ? `Connected${githubAppStatus.installation?.account_login ? ` • ${githubAppStatus.installation.account_login}` : ""}`
                        : "Not connected"}
                    </div>
                  </div>
                  <button type="button" className="btn-secondary" onClick={beginGithubAppConnect}>
                    {githubAppStatus.connected ? "Reconnect GitHub App" : "Connect GitHub App"}
                  </button>
                </div>
                {githubAppStatus.connected ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div className="field-label" style={{ margin: 0 }}>Repositories for label trigger</div>
                      <button type="button" className="btn-secondary" onClick={refreshGithubRepos}>
                        Refresh
                      </button>
                    </div>
                    {githubReposLoading ? (
                      <div className="field-hint" style={{ marginTop: 8 }}>Loading repositories…</div>
                    ) : githubRepos.length === 0 ? (
                      <div className="field-hint" style={{ marginTop: 8 }}>No repositories available yet. Reconnect and grant repo access in GitHub App install settings.</div>
                    ) : (
                      <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)" }}>
                        {githubRepos.map((r) => (
                          <label key={String(r.repository_id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                            <input
                              type="checkbox"
                              checked={r.selected === true}
                              onChange={(e) => toggleGithubRepoSelected(r.repository_id, e.target.checked)}
                            />
                            <span style={{ fontSize: 12, color: "var(--text)" }}>{r.full_name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="field-hint" style={{ marginTop: 8 }}>
                      Save trigger settings after selecting repos.
                    </div>
                  </div>
                ) : (
                  <div className="field-hint" style={{ marginTop: 8 }}>
                    Connect the GitHub App first to choose repositories and start receiving PR label events.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="sblock-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={saveTrigger}
            disabled={!triggerDirty}
            style={{ opacity: triggerDirty ? 1 : 0.45, cursor: triggerDirty ? "pointer" : "not-allowed" }}
          >
            {triggerDirty ? "Save trigger settings" : "Trigger settings saved"}
          </button>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">VCS write-back &amp; production monitor</div>
            <div className="sblock-desc">
              Post verdict status checks to GitHub/GitLab PRs after every certification, and enable the VCS Production Monitor to automatically detect reverts, hotfixes, and incidents.
            </div>
          </div>
        </div>
        <div className="sblock-body">
          {vcsCfg && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, marginBottom: 14 }}>
              <span style={{ color: "var(--green)", fontSize: 13 }}>✓</span>
              <span style={{ fontSize: 13, color: "var(--text)" }}>
                {vcsCfg.provider === "github" ? "GitHub" : "GitLab"} connected — <code style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{vcsCfg.owner}/{vcsCfg.repo}</code>
              </span>
              <button
                type="button"
                className="api-key-revoke"
                style={{ marginLeft: "auto" }}
                onClick={removeVcsIntegration}
              >
                Remove
              </button>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">Provider</label>
              <select className="inp" value={vcsForm.provider} onChange={(e) => setVcsForm((f) => ({ ...f, provider: e.target.value }))} style={{ marginTop: 6 }}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Personal access token</label>
              <input
                className="inp mono"
                type="password"
                value={vcsForm.access_token}
                onChange={(e) => setVcsForm((f) => ({ ...f, access_token: e.target.value }))}
                placeholder="ghp_... or glpat-..."
                style={{ marginTop: 6 }}
              />
            </div>
            <div className="field">
              <label className="field-label">Owner / org</label>
              <input className="inp" value={vcsForm.owner} onChange={(e) => setVcsForm((f) => ({ ...f, owner: e.target.value }))} placeholder="e.g. acme-corp" style={{ marginTop: 6 }} />
            </div>
            <div className="field">
              <label className="field-label">Repository</label>
              <input className="inp" value={vcsForm.repo} onChange={(e) => setVcsForm((f) => ({ ...f, repo: e.target.value }))} placeholder="e.g. ai-model" style={{ marginTop: 6 }} />
            </div>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Verdikt uses this token to post commit status checks and PR comments after every verdict, and to scan for reverts and hotfixes in the VCS Production Monitor.
          </div>
        </div>
        <div className="sblock-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={saveVcsIntegration}
            disabled={vcsSaving || !vcsForm.access_token || !vcsForm.owner || !vcsForm.repo}
            style={{ opacity: (!vcsForm.access_token || !vcsForm.owner || !vcsForm.repo) ? 0.45 : 1 }}
          >
            {vcsSaving ? "Saving…" : "Save VCS integration"}
          </button>
        </div>
      </div>
    </div>
  );
}
