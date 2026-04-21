import React from "react";
import { getSafeApiBase } from "../../../../lib/apiBase.js";

export default function GeneralSettingsSection({
  section,
  orgName,
  generalSlug,
  setGeneralSlug,
  apiBaseInput,
  setApiBaseInput,
  generalNote,
  generalDirty,
  saveGeneral,
  envChip,
  setEnvChip,
  toast,
  prodObservation,
  persistProdObservation,
  setGeneralDirty,
  setGeneralNote
}) {
  return (
    <div className={`section${section === "general" ? " active" : ""}`} id="panel-general">
      <div className="section-header">
        <div className="section-eyebrow">Workspace</div>
        <h1 className="section-h1">General</h1>
        <p className="section-desc">
          Workspace identity and core configuration. Changes here affect how Verdikt presents certification records, audit trail entries, and the public badge.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Workspace identity</div>
            <div className="sblock-desc">Name and project shown on certification records and the public badge.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="field">
            <label className="field-label">Organisation name</label>
            <input className="inp" value={orgName} readOnly style={{ opacity: 0.6, cursor: "not-allowed" }} title="Organisation name cannot be changed after setup" />
            <div className="field-hint">Set during workspace setup. Cannot be changed — contact support if this needs to be corrected.</div>
          </div>
          <div className="field">
            <label className="field-label">Workspace slug</label>
            <input
              className="inp mono"
              value={generalSlug}
              onChange={(e) => {
                setGeneralSlug(e.target.value);
                setGeneralDirty(true);
                setGeneralNote("Unsaved changes");
              }}
            />
            <div className="field-hint">
              Used in certification record URLs: useverdikt.com/cert/<strong>{generalSlug || "workspace"}</strong>/v2.14.0
            </div>
          </div>
          <div className="field">
            <label className="field-label">API base URL</label>
            {import.meta.env.DEV ? (
              <>
                <input
                  className="inp mono"
                  type="url"
                  placeholder="https://api.yourdomain.com"
                  value={apiBaseInput}
                  onChange={(e) => {
                    setApiBaseInput(e.target.value);
                    setGeneralDirty(true);
                    setGeneralNote("Unsaved changes");
                  }}
                  title="Verdikt backend origin (no trailing slash)"
                />
                <div className="field-hint">
                  Dashboard and login call this origin. Save, then reload open tabs so they pick up the new value. (Dev only — production uses
                  VITE_API_BASE at build time.)
                </div>
              </>
            ) : (
              <>
                <input
                  className="inp mono"
                  readOnly
                  value={getSafeApiBase() || "(same origin as this app)"}
                  style={{ opacity: 0.85, cursor: "not-allowed" }}
                  title="Configured at deploy time"
                />
                <div className="field-hint">Set via VITE_API_BASE when the frontend is built. Same-origin when empty.</div>
              </>
            )}
          </div>
        </div>
        <div className="sblock-footer">
          <div className="footer-note">{generalNote}</div>
          <button type="button" className="btn-save" disabled={!generalDirty} onClick={saveGeneral}>
            Save changes
          </button>
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Pre-production certification</div>
            <div className="sblock-desc">
              Primary tier for new certification sessions and the workspace badge. Staging and UAT both inform ship decisions — pick the gate that matches your process. Staging is usually the last stop before
              release; when onboarding selects both tiers, <strong>staging</strong> is the default primary.
            </div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="chips">
            <div
              className={`chip${envChip === "staging" ? " active" : ""}`}
              onClick={() => {
                setEnvChip("staging");
                try {
                  const raw = localStorage.getItem("vdk3_project");
                  const parsed = raw ? JSON.parse(raw) : {};
                  localStorage.setItem("vdk3_project", JSON.stringify({ ...parsed, env: "STAGING", certEnvs: ["STAGING"] }));
                } catch (_) {}
                toast("Primary certification tier set to staging");
              }}
              role="presentation"
            >
              STAGING
            </div>
            <div
              className={`chip${envChip === "uat" ? " active" : ""}`}
              onClick={() => {
                setEnvChip("uat");
                try {
                  const raw = localStorage.getItem("vdk3_project");
                  const parsed = raw ? JSON.parse(raw) : {};
                  localStorage.setItem("vdk3_project", JSON.stringify({ ...parsed, env: "UAT", certEnvs: ["UAT"] }));
                } catch (_) {}
                toast("Primary certification tier set to UAT");
              }}
              role="presentation"
            >
              UAT
            </div>
          </div>
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Production observation</div>
            <div className="sblock-desc">
              When enabled, Verdikt may gather post-release monitoring and feedback from production for loop readiness, alignment, and Intelligence. Pre-production certification is unchanged.
            </div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">Gather production-side intelligence</div>
              <div className="toggle-desc">Opt in — off by default until you choose to connect post-deploy data.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={prodObservation} onChange={(e) => persistProdObservation(e.target.checked)} />
              <div className="toggle-track" />
            </label>
          </div>
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Certification record visibility</div>
            <div className="sblock-desc">Who can view public certification records at useverdikt.com/cert/{generalSlug || "workspace"}/{`{version}`}. </div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">Public certification records</div>
              <div className="toggle-desc">Anyone with the URL can view the certification record. Disable to require login.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" defaultChecked onChange={() => toast("Record visibility updated")} />
              <div className="toggle-track" />
            </label>
          </div>
          <div className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">Show signal detail on public record</div>
              <div className="toggle-desc">Include per-signal pass/fail detail. Disable to show only the certification state and override record.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" defaultChecked onChange={() => toast("Signal visibility updated")} />
              <div className="toggle-track" />
            </label>
          </div>
          <div className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">Show override justification publicly</div>
              <div className="toggle-desc">Include the written justification on the public record. Always on for internal view.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" defaultChecked onChange={() => toast("Override visibility updated")} />
              <div className="toggle-track" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
