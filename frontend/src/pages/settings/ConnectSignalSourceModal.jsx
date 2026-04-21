import React, { useEffect, useState } from "react";
import { apiPut } from "./settingsClient.js";

const DD_SITES = [
  { value: "datadoghq.com", label: "US1 (datadoghq.com)" },
  { value: "us3.datadoghq.com", label: "US3" },
  { value: "us5.datadoghq.com", label: "US5" },
  { value: "datadoghq.eu", label: "EU" },
  { value: "ddog-gov.com", label: "US1-FED (Gov)" }
];

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   sourceId: string,
 *   name: string,
 *   workspaceId: string,
 *   navigate: import("react-router-dom").NavigateFunction,
 *   onSuccess: () => void,
 *   toast: (msg: string) => void
 * }} props
 */
export default function ConnectSignalSourceModal({ open, onClose, sourceId, name, workspaceId, navigate, onSuccess, toast }) {
  const [apiKey, setApiKey] = useState("");
  const [appKey, setAppKey] = useState("");
  const [site, setSite] = useState("datadoghq.com");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setApiKey("");
      setAppKey("");
      setSite("datadoghq.com");
      setError("");
      setSubmitting(false);
    }
  }, [open, sourceId]);

  if (!open) return null;

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const body = sourceId === "datadog" ? { apiKey: apiKey.trim(), appKey: appKey.trim(), site } : { apiKey: apiKey.trim() };
      if (sourceId === "datadog") {
        if (!body.apiKey || !body.appKey) {
          setError("API key and application key are required.");
          setSubmitting(false);
          return;
        }
      } else if (!body.apiKey) {
        setError("API key is required.");
        setSubmitting(false);
        return;
      }
      await apiPut(`/api/workspaces/${workspaceId}/signal-integrations/${sourceId}`, body, { navigate });
      onSuccess();
      onClose();
      toast(`${name} connected — credentials verified`);
    } catch (e) {
      setError(e?.message || "Connection failed");
    } finally {
      setSubmitting(false);
    }
  };

  const hint =
    sourceId === "sentry"
      ? "Use a Sentry auth token with at least org:read (Settings → Auth Tokens)."
      : sourceId === "langsmith"
        ? "Create an API key under LangSmith → Settings → API Keys."
        : sourceId === "braintrust"
          ? "Create an API key under Braintrust → Organization settings → API keys."
          : sourceId === "datadog"
            ? "Use your Datadog API key and application key (Organization settings → API keys)."
            : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000d8",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-signal-title"
    >
      <div
        style={{
          background: "#0e1016",
          border: "1px solid #1a1f2e",
          borderRadius: 16,
          padding: "28px 32px",
          width: "100%",
          maxWidth: 460,
          position: "relative"
        }}
      >
        <button
          type="button"
          style={{
            position: "absolute",
            top: 16,
            right: 18,
            background: "transparent",
            border: "none",
            color: "#4b5280",
            fontSize: 18,
            cursor: "pointer",
            lineHeight: 1
          }}
          onClick={onClose}
          disabled={submitting}
        >
          ✕
        </button>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accentL)", letterSpacing: "0.12em", marginBottom: 8 }}>CONNECT SOURCE</div>
        <h3 id="connect-signal-title" style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>
          {name}
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--fg2)", lineHeight: 1.45 }}>{hint}</p>

        {error ? (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "#fca5a5",
              fontSize: 13
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="field" style={{ marginBottom: 14 }}>
          <label className="field-label">{sourceId === "sentry" ? "Auth token" : "API key"}</label>
          <input
            className="inp mono"
            type="password"
            autoComplete="off"
            style={{ marginTop: 6 }}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={sourceId === "sentry" ? "sntryu_…" : "Paste key"}
          />
        </div>

        {sourceId === "datadog" ? (
          <>
            <div className="field" style={{ marginBottom: 14 }}>
              <label className="field-label">Application key</label>
              <input
                className="inp mono"
                type="password"
                autoComplete="off"
                style={{ marginTop: 6 }}
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                placeholder="Application key"
              />
            </div>
            <div className="field" style={{ marginBottom: 18 }}>
              <label className="field-label">Datadog site</label>
              <select className="inp" style={{ marginTop: 6, width: "100%", cursor: "pointer" }} value={site} onChange={(e) => setSite(e.target.value)}>
                {DD_SITES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Verifying…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
