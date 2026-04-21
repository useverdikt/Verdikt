import React from "react";
import { CATS, RTYPES, SOURCE_OPTIONS, THRESHOLD_PRESETS } from "../onboardingConstants.js";
import { regReqd } from "../onboardingUtils.js";
import { renderThreshSigRow } from "../renderThreshSigRow.jsx";
import { renderSourceDetail } from "../renderSourceDetail.jsx";

export default function FirstReleaseStep({
  st,
  setSt,
  availRT,
  loadDemo,
  setSig,
  setRT,
  updateThresh,
  toggleOpenCat,
  setThresholdProfile,
  resetSuggestedThresholds,
  applyAISuggestions,
  setSource,
  aiBtnDone,
  suggestBtnDone
}) {
  const reqd = regReqd(st.rel.rtype);
  const proj = st.ws.org || "your organisation";
  const sevs = ["none", "P4", "P3", "P2", "P1", "P0"];
  const sevColors = {
    none: "var(--green)",
    P4: "var(--green)",
    P3: "var(--amber)",
    P2: "var(--amber)",
    P1: "var(--red)",
    P0: "var(--red)"
  };
  return (
    <>
      <div className="step-eyebrow">Step 4 of 6</div>
      <h1 className="step-title display">
        Run your first
        <br />
        <em>certification.</em>
      </h1>
      <p className="step-body">
        Choose how signals will reach Verdikt, set the thresholds releases are certified against, then enter
        values (or manual QA pass/fail) for this preview. Pre-filled with realistic demo data — replace with real
        numbers from <strong>{proj}</strong> when you have them.
      </p>

      <div className="field" style={{ marginBottom: 10 }}>
        <span className="field-label">Signal source</span>
        <div className="field-hint" style={{ marginBottom: 12, maxWidth: 700 }}>
          Where release metrics will come from after setup. You can connect integrations from settings later —
          this choice only frames the walkthrough.
        </div>
        <div className="source-cards">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`source-card ${st.source === opt.id ? "active" : ""}`}
              aria-pressed={st.source === opt.id}
              onClick={() => setSource(opt.id)}
            >
              <div className="source-icon">{opt.icon}</div>
              <div className="source-name">{opt.name}</div>
              <div className="source-desc">{opt.desc}</div>
              <div className="source-tag">{opt.tag}</div>
            </button>
          ))}
        </div>
        <div className="source-detail" style={{ marginBottom: 28 }}>
          {renderSourceDetail(st.source)}
        </div>
      </div>

      <div style={{ marginBottom: 28, maxWidth: 700 }}>
        <span className="field-label">Quality thresholds</span>
        <p className="field-hint" style={{ marginBottom: 14, lineHeight: 1.65 }}>
          Verdikt certifies every release against these floors. Pick a product profile to load a suggested pack,
          then expand a category to tune individual signals.{" "}
          <strong style={{ color: "var(--text)" }}>Thresholds are not configuration — they are law.</strong>
        </p>
        <div className="source-cards" style={{ marginBottom: 14 }}>
          {Object.values(THRESHOLD_PRESETS).map((p) => (
            <button
              key={p.id}
              type="button"
              className={`source-card ${st.profile === p.id ? "active" : ""}`}
              aria-pressed={st.profile === p.id}
              onClick={() => setThresholdProfile(p.id)}
            >
              <div className="source-name">{p.label}</div>
              <div className="source-desc">{p.blurb}</div>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12, alignItems: "center" }}>
          <button type="button" className="demo-btn" style={{ marginBottom: 0 }} onClick={resetSuggestedThresholds}>
            Use suggested defaults
            {suggestBtnDone ? (
              <span style={{ color: "var(--green)", marginLeft: 6 }} aria-hidden>
                ✓
              </span>
            ) : null}
          </button>
          <button type="button" className="demo-btn" style={{ marginBottom: 0 }} onClick={applyAISuggestions}>
            Apply stricter AI defaults
            {aiBtnDone ? (
              <span style={{ color: "var(--green)", marginLeft: 6 }} aria-hidden>
                ✓
              </span>
            ) : null}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--dim)", marginBottom: 14, fontFamily: "var(--mono)" }}>
          Suggested for <strong style={{ color: "var(--accent)" }}>{THRESHOLD_PRESETS[st.profile]?.label}</strong>
        </p>
        <div className="thresh-cats">
          {CATS.map((cat) => {
            const open = !!st.openCats[cat.id];
            return (
              <div key={cat.id} className={`thresh-cat ${open ? "open" : ""}`}>
                <button type="button" className="thresh-cat-hd" onClick={() => toggleOpenCat(cat.id)}>
                  <div className="thresh-cat-left">
                    <span className="thresh-cat-icon" style={{ color: cat.color }}>
                      {cat.icon}
                    </span>
                    <div>
                      <div className="thresh-cat-name">{cat.label}</div>
                      <div className="thresh-cat-desc">{cat.desc}</div>
                    </div>
                  </div>
                  <span className="chevron" aria-hidden>
                    ▼
                  </span>
                </button>
                <div className={`thresh-sigs ${open ? "open" : ""}`}>
                  {cat.sigs.map((sig) => renderThreshSigRow(sig, st, updateThresh))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rel-form">
        <button type="button" className="demo-btn" onClick={loadDemo}>
          ⊕ Load demo data
        </button>
        <div className="rel-top">
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Version</label>
            <input
              className="inp"
              value={st.rel.version}
              onChange={(e) => setSt((s) => ({ ...s, rel: { ...s.rel, version: e.target.value } }))}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Release type</label>
            <div className="chips" style={{ marginTop: 4 }}>
              {availRT.map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  className={`chip ${st.rel.rtype === rt.id ? "active" : ""}`}
                  aria-pressed={st.rel.rtype === rt.id}
                  aria-label={`Release type ${rt.label}`}
                  onClick={() => setRT(rt.id)}
                >
                  <span>{rt.icon}</span>
                  {rt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {reqd === false ? (
          <div className="waiver-note">
            <span style={{ flexShrink: 0, marginTop: 1 }}>⊘</span>
            <span>
              E2E regression is waivable for{" "}
              <strong>{RTYPES.find((r) => r.id === st.rel.rtype)?.label}</strong> releases. Add a waiver reason
              in the dashboard after setup.
            </span>
          </div>
        ) : null}
        <div className="sig-cats">
          {CATS.map((cat) => (
            <div key={cat.id}>
              <div className="sig-cat-label" style={{ color: cat.color }}>
                {cat.icon} {cat.label}
              </div>
              <div className="sig-grid">
                {cat.sigs.map((sig) => {
                  const isWaived = sig.cond && reqd === false;
                  if (isWaived) {
                    return (
                      <div key={sig.id} className="sig-cell waived-cell">
                        <div className="sig-cell-label">{sig.label}</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--amber)" }}>
                          WAIVED
                        </div>
                      </div>
                    );
                  }
                  if (sig.dir === "test") {
                    const raw = st.rel.sigs[sig.id];
                    const tv = raw && typeof raw === "object" ? raw : { rate: 100, severity: "none" };
                    const ratePass = (tv.rate ?? 0) >= st.thresh[sig.id] && tv.severity !== "P0";
                    return (
                      <div
                        key={sig.id}
                        className="sig-cell"
                        style={{
                          gridColumn: "1 / -1",
                          borderColor: ratePass ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.14)"
                        }}
                      >
                        <div className="sig-cell-label">{sig.label}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <input
                            className="sig-inp"
                            type="number"
                            min={0}
                            max={100}
                            value={tv.rate ?? 100}
                            step={1}
                            style={{
                              color: ratePass ? "var(--green)" : "var(--red)",
                              width: 46
                            }}
                            onChange={(e) =>
                              setSig(sig.id, {
                                ...tv,
                                rate: +e.target.value
                              })
                            }
                          />
                          <span className="sig-unit">%</span>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--mid)" }}>
                            ≥{st.thresh[sig.id]}%
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {sevs.map((sv) => (
                            <button
                              type="button"
                              key={sv}
                              onClick={() => setSig(sig.id, { ...tv, severity: sv })}
                              style={{
                                padding: "3px 7px",
                                borderRadius: 5,
                                border: `1px solid ${tv.severity === sv ? sevColors[sv] : "var(--border)"}`,
                                background: tv.severity === sv ? `${sevColors[sv]}22` : "transparent",
                                color: tv.severity === sv ? sevColors[sv] : "var(--dim)",
                                fontFamily: "var(--mono)",
                                fontSize: 9,
                                fontWeight: 700,
                                cursor: "pointer"
                              }}
                            >
                              {sv === "none" ? "All pass" : sv}
                            </button>
                          ))}
                        </div>
                        {tv.severity === "P0" ? (
                          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--red)", marginTop: 4 }}>
                            ⊗ P0 — hard block
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  if (sig.dir === "pass") {
                    const v = st.rel.sigs[sig.id] || "pass";
                    return (
                      <div key={sig.id} className="sig-cell">
                        <div className="sig-cell-label">
                          {sig.label}
                          {sig.hg ? " · HARD GATE" : ""}
                        </div>
                        <div className="pf-row">
                          <button
                            type="button"
                            className={`pf-btn pass ${v === "pass" ? "on" : ""}`}
                            onClick={() => setSig(sig.id, "pass")}
                          >
                            PASS
                          </button>
                          <button
                            type="button"
                            className={`pf-btn fail ${v === "fail" ? "on" : ""}`}
                            onClick={() => setSig(sig.id, "fail")}
                          >
                            FAIL
                          </button>
                        </div>
                      </div>
                    );
                  }
                  const v = st.rel.sigs[sig.id] ?? st.thresh[sig.id];
                  const pass = sig.dir === "above" ? +v >= st.thresh[sig.id] : +v <= st.thresh[sig.id];
                  const col = pass ? "var(--green)" : "var(--red)";
                  const dir = sig.dir === "above" ? "≥" : "≤";
                  return (
                    <div
                      key={sig.id}
                      className="sig-cell"
                      style={{
                        borderColor: pass ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.14)"
                      }}
                    >
                      <div className="sig-cell-label">{sig.label}</div>
                      <div className="sig-cell-row">
                        <input
                          className="sig-inp"
                          type="number"
                          value={v}
                          step={sig.unit === "s" || sig.unit === "%" ? 0.1 : sig.unit === "ms" ? 10 : 1}
                          style={{ color: col }}
                          onChange={(e) => setSig(sig.id, +e.target.value)}
                        />
                        <span className="sig-unit">{sig.unit}</span>
                      </div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--dim)", marginTop: 2 }}>
                        {dir}
                        {st.thresh[sig.id]}
                        {sig.unit}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
