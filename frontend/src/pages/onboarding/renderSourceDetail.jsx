import React from "react";
import { INTEGRATION_PROVIDERS } from "./onboardingConstants.js";

export function renderSourceDetail(source) {
  if (source === "integrations") {
    return (
      <>
        <div className="source-det-hd">
          <span>Supported signal providers</span>
        </div>
        <div
          className="source-det-body"
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            lineHeight: 1.75,
            display: "flex",
            flexDirection: "column",
            gap: 14
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {INTEGRATION_PROVIDERS.map((p) => (
              <div
                key={p.name}
                style={{
                  background: "#0e1016",
                  border: "1px solid #1a1f2e",
                  borderRadius: 8,
                  padding: "13px 15px"
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: p.color, marginBottom: 5 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#5c6480", lineHeight: 1.55, marginBottom: 6 }}>{p.signals}</div>
                <div style={{ fontSize: 10, color: "#2a2f45", fontStyle: "italic", lineHeight: 1.5 }}>{p.note}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="source-det-foot">
          Integrations are configured in workspace settings after setup. The version tag in each provider is how
          Verdikt knows which signals belong to which release.
        </div>
      </>
    );
  }
  if (source === "csv") {
    return (
      <>
        <div className="source-det-hd">
          <span>CSV format — one row per release</span>
        </div>
        <pre className="source-det-body">
          <span className="code-comment"># Required columns — export from your signal providers</span>
          {"\n"}
          <span className="code-key">version</span>,<span className="code-key">releasetype</span>,
          <span className="code-key">smoke</span>,<span className="code-key">crashrate</span>,
          <span className="code-key">p95latency</span>,...
          {"\n\n"}
          <span className="code-str">v2.14.0,prompt_update,pass,0.08,218,...</span>
          {"\n"}
          <span className="code-comment"># Leave blank to waive a conditional signal</span>
          {"\n"}
          <span className="code-str">v2.13.0,model_patch,pass,,234,...</span>
        </pre>
        <div className="source-det-foot">
          The version column must match the version tag used in your signal providers. Download the full CSV
          template from workspace settings after setup.
        </div>
      </>
    );
  }
  return (
    <>
      <div className="source-det-hd">
        <span>Manual entry — always available</span>
      </div>
      <div
        className="source-det-body"
        style={{ fontFamily: "var(--sans)", color: "var(--mid)", fontSize: 13, lineHeight: 1.75 }}
      >
        Enter signal values directly in the <strong style={{ color: "var(--text)" }}>First release</strong> step in
        this setup flow. Every field maps to a signal category. Useful while integrations are being set up.
        <br />
        <br />
        <strong style={{ color: "#5c6480" }}>Version number:</strong> enter the version string that matches your
        release tag (e.g. v2.14.0). This is how the record is identified — use the same string across all your
        tools.
      </div>
    </>
  );
}
