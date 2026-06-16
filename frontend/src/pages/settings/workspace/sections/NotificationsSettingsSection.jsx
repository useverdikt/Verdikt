import React from "react";

export default function NotificationsSettingsSection({
  section,
  toast,
  slackWebhookInput = "",
  setSlackWebhookInput = () => {},
  saveSlackWebhook = async () => {},
  slackSaving = false
}) {
  const handleConnect = async () => {
    const url = slackWebhookInput.trim();
    if (!url) {
      toast("Enter a Slack incoming webhook URL first");
      return;
    }
    if (!url.startsWith("https://hooks.slack.com/")) {
      toast("URL must start with https://hooks.slack.com/");
      return;
    }
    await saveSlackWebhook();
  };

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
            <div className="sblock-desc">Post certification events to a Slack channel via an incoming webhook.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="field">
            <label className="field-label">Webhook URL</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="inp mono"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhookInput}
                onChange={(e) => setSlackWebhookInput(e.target.value)}
              />
              <button
                type="button"
                className="btn-save"
                disabled={slackSaving}
                onClick={handleConnect}
              >
                {slackSaving ? "Saving…" : slackWebhookInput.trim() ? "Save" : "Connect"}
              </button>
            </div>
            <div className="field-hint">
              Create an incoming webhook in your Slack app settings and paste the URL here.{" "}
              {slackWebhookInput.trim() && (
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: 0, font: "inherit" }}
                  onClick={() => { setSlackWebhookInput(""); saveSlackWebhook(); }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
