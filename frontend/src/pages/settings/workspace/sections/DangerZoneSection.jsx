import React, { useState } from "react";

export default function DangerZoneSection({ section, toast, resetThresholds }) {
  const [resetting, setResetting] = useState(false);

  const handleResetThresholds = async () => {
    const confirmed = window.confirm("Reset all signal thresholds to Verdikt defaults? This cannot be undone.");
    if (!confirmed) return;
    setResetting(true);
    try {
      if (typeof resetThresholds === "function") {
        await resetThresholds();
      } else {
        toast("Thresholds reset to defaults");
      }
    } finally {
      setResetting(false);
    }
  };

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
          <button type="button" className="btn-secondary" onClick={() => toast("Export coming soon — contact support@useverdikt.com to request a data export")}>
            Export data
          </button>
        </div>
        <div className="danger-action">
          <div className="danger-action-inner">
            <div className="danger-title">Reset all thresholds to defaults</div>
            <div className="danger-desc">Restore all signal thresholds to Verdikt&apos;s default values. Custom signal definitions are preserved.</div>
          </div>
          <button
            type="button"
            className="btn-danger"
            disabled={resetting}
            onClick={handleResetThresholds}
          >
            {resetting ? "Resetting…" : "Reset thresholds"}
          </button>
        </div>
        <div className="danger-action" style={{ borderBottom: "none" }}>
          <div className="danger-action-inner">
            <div className="danger-title" style={{ color: "var(--red)" }}>
              Delete workspace
            </div>
            <div className="danger-desc">Permanently delete this workspace and all data. Contact <a href="mailto:support@useverdikt.com" style={{ color: "inherit" }}>support@useverdikt.com</a> to initiate deletion.</div>
          </div>
          <button
            type="button"
            className="btn-danger"
            disabled
            title="Contact support@useverdikt.com to delete your workspace"
          >
            Delete workspace
          </button>
        </div>
      </div>
    </div>
  );
}
