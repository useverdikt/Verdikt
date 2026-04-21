import React from "react";
import { THRESH_DEFAULTS } from "../../settingsData.js";

export default function DangerZoneSection({ section, toast, setApiKeys, setThresholds }) {
  return (
    <div className={`section${section === "danger" ? " active" : ""}`} id="panel-danger">
      <div className="section-header">
        <div className="section-eyebrow">Irreversible actions</div>
        <h1 className="section-h1">
          Danger <em>Zone</em>
        </h1>
        <p className="section-desc">These actions are permanent and cannot be undone. Each requires explicit confirmation before executing.</p>
      </div>
      <div className="sblock" style={{ borderColor: "var(--redBorder)" }}>
        <div className="danger-action">
          <div className="danger-action-inner">
            <div className="danger-title">Export full workspace data</div>
            <div className="danger-desc">Download all releases, verdicts, overrides, and audit trail entries as a JSON archive.</div>
          </div>
          <button type="button" className="btn-secondary" onClick={() => toast("Export started — you'll receive an email when ready")}>
            Export data
          </button>
        </div>
        <div className="danger-action">
          <div className="danger-action-inner">
            <div className="danger-title">Revoke all API keys</div>
            <div className="danger-desc">Immediately invalidate all active API keys.</div>
          </div>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              if (
                window.confirm(
                  "Revoke ALL API keys? This will immediately stop all release/eval signal submissions until new keys are created."
                )
              ) {
                setApiKeys([]);
                toast("All API keys revoked");
              }
            }}
          >
            Revoke all keys
          </button>
        </div>
        <div className="danger-action">
          <div className="danger-action-inner">
            <div className="danger-title">Reset all thresholds to defaults</div>
            <div className="danger-desc">Restore all signal thresholds to Verdikt&apos;s default values.</div>
          </div>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              setThresholds({ ...THRESH_DEFAULTS });
              localStorage.setItem("vdk3_thresholds", JSON.stringify(THRESH_DEFAULTS));
              toast("Thresholds reset to defaults");
            }}
          >
            Reset thresholds
          </button>
        </div>
        <div className="danger-action" style={{ borderBottom: "none" }}>
          <div className="danger-action-inner">
            <div className="danger-title" style={{ color: "var(--red)" }}>
              Delete workspace
            </div>
            <div className="danger-desc">Permanently delete this workspace and all data.</div>
          </div>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              const confirmed = window.prompt("Type DELETE to permanently remove this workspace and all its data:");
              if (confirmed === "DELETE") toast("Workspace deletion scheduled — you will receive a confirmation email");
              else if (confirmed !== null) toast("Workspace not deleted — type DELETE exactly to confirm");
            }}
          >
            Delete workspace
          </button>
        </div>
      </div>
    </div>
  );
}
