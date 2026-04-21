import React from "react";

export default function NotificationsSettingsSection({ section, toast }) {
  return (
    <div className={`section${section === "notifications" ? " active" : ""}`} id="panel-notifications">
      <div className="section-header">
        <div className="section-eyebrow">Alerts</div>
        <h1 className="section-h1">Notifications</h1>
        <p className="section-desc">
          Configure where Verdikt sends alerts for certification events. Webhooks fire within seconds of a verdict being issued.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Slack</div>
            <div className="sblock-desc">Post certification events to a Slack channel.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="field">
            <label className="field-label">Webhook URL</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="inp mono" placeholder="https://hooks.slack.com/services/..." />
              <button type="button" className="btn-save" onClick={() => toast("Slack connected — test message sent to channel")}>
                Connect
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
