import React from "react";
import { primaryCertEnvFromTiers } from "../../../lib/projectEnv.js";

export default function WorkspaceStep({ st, setSt }) {
  return (
    <>
      <div className="step-eyebrow">Step 2 of 6</div>
      <h1 className="step-title display">
        Set up your
        <br />
        <em>organisation.</em>
      </h1>
      <p className="step-body">
        Name your organisation and first project. These are required to start certification and keep release
        records attributable.
      </p>
      <div style={{ maxWidth: 480 }}>
        <div className="field">
          <label className="field-label">Organisation name</label>
          <input
            className="inp"
            placeholder="e.g. Verdikt"
            value={st.ws.org}
            onChange={(e) => setSt((s) => ({ ...s, ws: { ...s.ws, org: e.target.value } }))}
          />
          <div className="field-hint">
            The name of your company or engineering organisation. Cannot be changed after setup.
          </div>
        </div>
        <div className="field">
          <label className="field-label">Project name</label>
          <input
            className="inp"
            placeholder="e.g. Support Copilot"
            value={st.ws.project}
            onChange={(e) => setSt((s) => ({ ...s, ws: { ...s.ws, project: e.target.value } }))}
          />
          <div className="field-hint">Required. This becomes your first release stream on the dashboard.</div>
        </div>
        <div className="field">
          <label className="field-label">Pre-production certification</label>
          <div className="chips" style={{ marginTop: 6 }}>
            {["staging", "uat"].map((e) => {
              const on = st.ws.certEnvs.includes(e);
              return (
                <button
                  key={e}
                  type="button"
                  className={`chip ${on ? "active" : ""}`}
                  aria-pressed={on}
                  aria-label={`${on ? "Deselect" : "Select"} ${e.toUpperCase()} for certification signals`}
                  onClick={() =>
                    setSt((s) => {
                      const cur = new Set(s.ws.certEnvs || []);
                      if (cur.has(e)) {
                        if (cur.size <= 1) return s;
                        cur.delete(e);
                      } else {
                        cur.add(e);
                      }
                      const order = ["staging", "uat"];
                      const certEnvs = order.filter((x) => cur.has(x));
                      return { ...s, ws: { ...s.ws, certEnvs } };
                    })
                  }
                >
                  <div className="chip-dot" />
                  {e.toUpperCase()}
                </button>
              );
            })}
          </div>
          <div className="field-hint">
            Signals from these environments inform <strong>ship / no-ship</strong> decisions before production.
            <strong> Staging</strong> is typically the last production-like stop before release;{" "}
            <strong>UAT</strong> is often where acceptance and exploratory validation happen — your pipeline may
            differ. Select every tier you use for gates. New certification sessions use your primary tier (
            {primaryCertEnvFromTiers(st.ws.certEnvs).toUpperCase()}) — when both are on, <strong>staging</strong>{" "}
            wins as the release-candidate gate.
          </div>
        </div>
        <div className="field">
          <label className="field-label">Production observation</label>
          <label
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              cursor: "pointer",
              marginTop: 6,
              fontSize: 13,
              color: "var(--mid)",
              lineHeight: 1.55
            }}
          >
            <input
              type="checkbox"
              checked={st.ws.prodObservation}
              onChange={(ev) => setSt((s) => ({ ...s, ws: { ...s.ws, prodObservation: ev.target.checked } }))}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            <span>
              Allow Verdikt to gather <strong>post-release</strong> monitoring, e2e health, and feedback from{" "}
              <strong>production</strong> for intelligence and loop closure. Without this, pre-production
              certification still works; production-side learning stays off until you opt in. Separate from the
              certification gate — it does not replace validating release candidates upstream.
            </span>
          </label>
        </div>
        <div
          style={{
            background: "var(--raise)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: "14px 18px",
            marginTop: 4
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--accent)",
              letterSpacing: "0.12em",
              marginBottom: 8
            }}
          >
            PROJECTS
          </div>
          <div style={{ fontSize: 13, color: "var(--mid)", lineHeight: 1.7 }}>
            Your first project is created now. Additional projects can be added later from the dashboard.
          </div>
        </div>
      </div>
    </>
  );
}
