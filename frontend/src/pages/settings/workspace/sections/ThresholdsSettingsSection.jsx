import React from "react";
import { THRESH_DEFAULTS } from "../../settingsData.js";
import { esc } from "../settingsWorkspaceModel.js";

const AI_DIMS = [
  { k: "accuracy", label: "Accuracy", desc: "Factual correctness of AI responses" },
  { k: "safety", label: "Safety", desc: "Absence of harmful or prohibited content" },
  { k: "tone", label: "Tone", desc: "Appropriate brand voice and register" },
  { k: "hallucination", label: "Hallucination", desc: "Responses grounded in available context" },
  { k: "relevance", label: "Relevance", desc: "Response addresses user intent" }
];

export default function ThresholdsSettingsSection({
  section,
  thresholds,
  updateThresh,
  threshNote,
  threshDirty,
  saveThresholds,
  suggestions,
  suggestNote,
  applySuggestion,
  dismissSuggestion,
  policyState,
  setPolicyState,
  policyNote,
  policyDirty,
  setPolicyNote,
  setPolicyDirty,
  savePolicies
}) {
  const num = (k) => {
    const v = thresholds[k];
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : THRESH_DEFAULTS[k];
  };

  const suggestListNote =
    suggestNote ||
    (suggestions.length
      ? `${suggestions.length} suggestion${suggestions.length > 1 ? "s" : ""} available`
      : "No active suggestions in the current analysis window.");

  return (
    <div className={`section${section === "thresholds" ? " active" : ""}`} id="panel-thresholds">
      <div className="section-header">
        <div className="section-eyebrow">Workspace</div>
        <h1 className="section-h1">
          Quality <em>Thresholds</em>
        </h1>
        <p className="section-desc">
          Pass/fail criteria applied to every release. AI Eval Quality thresholds are the primary output-quality gate. Changes take effect on the next certification session.
        </p>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Delivery Reliability</div>
            <div className="sblock-desc">Pass rate floors for smoke and E2E regression suites.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ padding: "0 22px 18px" }}>
          <div className="thresh-row">
            <div className="thresh-meta">
              <div className="thresh-label">Smoke tests</div>
              <div className="thresh-desc">Required on every release. P0 failure = hard block, no override.</div>
            </div>
            <div className="thresh-ctrl">
              <span className="thresh-dir">≥</span>
              <input className="thresh-inp" type="number" min={0} max={100} step={1} value={num("smoke")} onChange={(e) => updateThresh("smoke", parseFloat(e.target.value))} />
              <span className="thresh-unit">%</span>
            </div>
          </div>
          <div className="thresh-row">
            <div className="thresh-meta">
              <div className="thresh-label">
                E2E regression <span className="thresh-cond">CONDITIONAL</span>
              </div>
              <div className="thresh-desc">Required for new features. Waivable for bug fixes and hotfixes.</div>
            </div>
            <div className="thresh-ctrl">
              <span className="thresh-dir">≥</span>
              <input className="thresh-inp" type="number" min={0} max={100} step={1} value={num("e2e_regression")} onChange={(e) => updateThresh("e2e_regression", parseFloat(e.target.value))} />
              <span className="thresh-unit">%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Human Validation (Risk Scenarios)</div>
            <div className="sblock-desc">Targeted human review for high-risk journeys and edge cases.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ padding: "0 22px 18px" }}>
          <div className="thresh-row">
            <div className="thresh-meta">
              <div className="thresh-label">Acceptable pass rate</div>
              <div className="thresh-desc">Minimum percentage of manual QA checks that must pass.</div>
            </div>
            <div className="thresh-ctrl">
              <span className="thresh-dir">≥</span>
              <input className="thresh-inp" type="number" min={0} max={100} step={1} value={num("manual_qa_pct")} onChange={(e) => updateThresh("manual_qa_pct", parseFloat(e.target.value))} />
              <span className="thresh-unit">%</span>
            </div>
          </div>
          <div className="thresh-row">
            <div className="thresh-meta">
              <div className="thresh-label">Showstopper severity</div>
              <div className="thresh-desc">Any defect at this severity or higher = hard block.</div>
            </div>
            <div className="thresh-ctrl">
              <select className="member-role" style={{ minWidth: 100 }} value={String(thresholds.manual_qa_showstopper ?? "P0")} onChange={(e) => updateThresh("manual_qa_showstopper", e.target.value)}>
                {["P0", "P1", "P2", "P3"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Runtime Performance</div>
            <div className="sblock-desc">Operational runtime gate for client/API responsiveness.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ padding: "0 22px 18px" }}>
          {[
            { k: "startup", label: "Cold startup time", desc: "Time to interactive from cold launch", le: true, unit: "s", step: 0.1 },
            { k: "screenload", label: "Key screen load", desc: "Primary screen render time", le: true, unit: "s", step: 0.1 },
            { k: "fps", label: "Frame rate", desc: "Average FPS during key interactions", le: false, unit: "fps", step: 1 },
            { k: "jserrors", label: "JS error rate", desc: "Uncaught JS errors per session", le: true, unit: "%", step: 0.1 },
            { k: "p95latency", label: "API p95 latency", desc: "95th percentile API response time under load", le: true, unit: "ms", step: 10 },
            { k: "p99latency", label: "API p99 latency", desc: "99th percentile API response time under load", le: true, unit: "ms", step: 10 },
            { k: "errorunderload", label: "Error rate under load", desc: "5xx rate at peak concurrent users", le: true, unit: "%", step: 0.1 },
            { k: "recovery", label: "Stress recovery time", desc: "Time to recover after stress test peak", le: true, unit: "s", step: 1 }
          ].map((row) => (
            <div key={row.k} className="thresh-row">
              <div className="thresh-meta">
                <div className="thresh-label">{row.label}</div>
                <div className="thresh-desc">{row.desc}</div>
              </div>
              <div className="thresh-ctrl">
                <span className="thresh-dir">{row.le ? "≤" : "≥"}</span>
                <input className="thresh-inp" type="number" min={0} step={row.step} value={num(row.k)} onChange={(e) => updateThresh(row.k, parseFloat(e.target.value))} />
                <span className="thresh-unit">{row.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Runtime Reliability</div>
            <div className="sblock-desc">Crash and error rate signals from production and pre-production.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ padding: "0 22px 18px" }}>
          {[
            { k: "crashrate", label: "Crash rate", desc: "Sessions ending in a crash", step: 0.01 },
            { k: "anrrate", label: "ANR rate", desc: "Android Not Responding rate", step: 0.01 },
            { k: "errorrate", label: "API error rate", desc: "5xx errors as % of total API calls", step: 0.1 },
            { k: "oomrate", label: "OOM rate", desc: "Out of memory events per session", step: 0.01 }
          ].map((row) => (
            <div key={row.k} className="thresh-row">
              <div className="thresh-meta">
                <div className="thresh-label">{row.label}</div>
                <div className="thresh-desc">{row.desc}</div>
              </div>
              <div className="thresh-ctrl">
                <span className="thresh-dir">≤</span>
                <input className="thresh-inp" type="number" min={0} step={row.step} value={num(row.k)} onChange={(e) => updateThresh(row.k, parseFloat(e.target.value))} />
                <span className="thresh-unit">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">AI Eval Quality</div>
            <div className="sblock-desc">Absolute floor and maximum regression delta from the last certified release.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ padding: "0 22px 18px" }}>
          {AI_DIMS.map((d) => (
            <div key={d.k} className="thresh-row">
              <div className="thresh-meta">
                <div className="thresh-label">{d.label}</div>
                <div className="thresh-desc">{d.desc}</div>
              </div>
              <div className="thresh-ctrl">
                <div className="thresh-ai-wrap">
                  <div className="thresh-ai-row">
                    <span className="thresh-ai-lbl">FLOOR</span>
                    <span className="thresh-dir">≥</span>
                    <input className="thresh-inp" type="number" min={0} max={100} step={1} value={num(d.k)} onChange={(e) => updateThresh(d.k, parseFloat(e.target.value))} />
                    <span className="thresh-unit">%</span>
                  </div>
                  <div className="thresh-ai-row">
                    <span className="thresh-ai-lbl">MAX DROP</span>
                    <span className="thresh-dir">−</span>
                    <input className="thresh-inp" type="number" min={0} max={100} step={1} value={num(`${d.k}_delta`)} onChange={(e) => updateThresh(`${d.k}_delta`, parseFloat(e.target.value))} />
                    <span className="thresh-unit">pts</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="sblock-footer">
          <div className="footer-note">{threshNote}</div>
          <button type="button" className="btn-save" disabled={!threshDirty} onClick={saveThresholds}>
            Save thresholds
          </button>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Threshold suggestions</div>
            <div className="sblock-desc">Data-driven suggestions based on recent release outcomes and MISS/OVER_BLOCK patterns from the alignment table.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div style={{ fontSize: 11.5, color: "var(--fg3)", fontFamily: "var(--mono)", marginBottom: 10 }}>{suggestListNote}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {suggestions.map((s) => (
              <div key={s.id || s.signal_id} className="suggest-card">
                <div className="suggest-signal">{esc(s.signal_id)}</div>
                <div className="suggest-reason">{esc(s.reason || "")}</div>
                <div className="suggest-delta">
                  <span className="suggest-from">
                    {s.direction === "max" ? "max" : "min"}: {esc(s.current)}
                  </span>
                  <span className="suggest-arrow">→</span>
                  <span className="suggest-to">{esc(s.suggested)}</span>
                  <span className="suggest-conf">{Math.round((s.confidence || 0) * 100)}% confidence</span>
                </div>
                <div className="suggest-actions">
                  <button type="button" className="btn-save" style={{ fontSize: 11, padding: "7px 16px" }} onClick={() => applySuggestion(String(s.id || ""))}>
                    Apply
                  </button>
                  <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: "7px 14px" }} onClick={() => dismissSuggestion(String(s.id || ""))}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">AI Evidence Policy</div>
            <div className="sblock-desc">Control whether AI evaluation signals are mandatory at verdict time.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="gov-option">
            <div>
              <div className="gov-label">Require evaluation signals</div>
              <div className="gov-desc">If enabled, missing eval evidence can block certification at the end of the collection window.</div>
            </div>
            <input
              id="policy-require-ai"
              type="checkbox"
              checked={policyState.require_ai_eval}
              onChange={(e) => {
                setPolicyState((p) => ({ ...p, require_ai_eval: e.target.checked }));
                setPolicyDirty(true);
                setPolicyNote("Unsaved changes");
              }}
            />
          </div>
          <div className="gov-option">
            <div>
              <div className="gov-label">Missing AI signal behaviour</div>
              <div className="gov-desc">Choose whether missing AI signals block certification or are allowed with available evidence.</div>
            </div>
            <select
              className="gov-select"
              id="policy-missing-ai"
              value={policyState.ai_missing_policy}
              onChange={(e) => {
                setPolicyState((p) => ({ ...p, ai_missing_policy: e.target.value }));
                setPolicyDirty(true);
                setPolicyNote("Unsaved changes");
              }}
            >
              <option value="block_uncertified">Block certification (UNCERTIFIED)</option>
              <option value="allow_without_ai">Allow verdict without AI signals</option>
            </select>
          </div>
        </div>
        <div className="sblock-footer">
          <div className="footer-note">{policyNote}</div>
          <button type="button" className="btn-save" disabled={!policyDirty} onClick={savePolicies}>
            Save AI policy
          </button>
        </div>
      </div>
    </div>
  );
}
