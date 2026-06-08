import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "../../../lib/releaseStatus.js";
import {
  evaluateSignalLocal,
  formatSignalValueLocal,
  formatThresholdLineLocal,
  getOrderedDetailSignals,
  regressionRequiredLocal
} from "./releaseDashboardUtils.js";

export default function ReleaseDetail({
  release,
  signalCategories,
  catStatuses,
  thresholds,
  releaseTypes,
  onViewFullRecord,
  onBeginOverride,
  onCollectingAction
}) {
  const intel = release.intelligence || {};
  const verdictIntel = intel.verdict || {};
  const recommendationIntel = intel.recommendation || {};
  const overrideIntel = intel.override || {};
  const signals = release.signals || {};
  const reqd = regressionRequiredLocal(releaseTypes, release.releaseType);
  const isCollecting = normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.COLLECTING;
  const receivedSignalCount = Object.values(signals).filter((v) => v != null).length;

  const ordered = getOrderedDetailSignals(signalCategories);

  let reasoningPoints =
    Array.isArray(recommendationIntel.reasoning) && recommendationIntel.reasoning.length
      ? recommendationIntel.reasoning.slice(0, 6)
      : verdictIntel.reasoning
        ? (Array.isArray(verdictIntel.reasoning)
            ? verdictIntel.reasoning
            : [String(verdictIntel.reasoning)]
          ).slice(0, 6)
        : null;
  if ((!reasoningPoints || reasoningPoints.length === 0) && typeof verdictIntel.summary === "string" && verdictIntel.summary.trim()) {
    reasoningPoints = [verdictIntel.summary.trim()];
  }
  if (
    !isCollecting &&
    receivedSignalCount === 0 &&
    ordered.some(({ sig }) => signals[sig.id] == null)
  ) {
    reasoningPoints = [
      "No signal values were recorded for this release. Ingest required signals via Signal Simulator or connected sources, then re-evaluate."
    ];
  }

  const deltaRows = Array.isArray(release.release_deltas) ? release.release_deltas : [];
  const regressionBullets = deltaRows
    .filter((row) => row.no_baseline || !row.passed)
    .slice(0, 5)
    .map((row) =>
      row.no_baseline
        ? `${row.signal_id}: no baseline`
        : `${row.signal_id}: ${row.current_value} (baseline ${row.baseline_value})`
    );

  const hasFailed = Object.values(catStatuses).some((s) => s === "fail");
  const hasOverride = release.status === "overridden";
  const overrideText = overrideIntel?.justification || release.overrideReason || "";

  function renderSignalRow({ sig }) {
    const thr = thresholds[sig.id];
    const raw = signals[sig.id];

    if (sig.conditional && (raw === undefined || raw === null)) {
      if (reqd === false) {
        return (
          <div className="sig-row" key={sig.id}>
            <span className="sn">{sig.label}</span>
            <div className="sv">
              <div className="sa w">WAIVED</div>
              <div className="st">not required for this release type</div>
            </div>
          </div>
        );
      }
    }

    if (raw === undefined || raw === null) {
      const awaitingLabel = isCollecting ? "awaiting…" : "NOT RECEIVED";
      const awaitingColor = isCollecting ? "#384d60" : "#f87171";
      return (
        <div className="sig-row" key={sig.id}>
          <span className="sn">{sig.label}</span>
          <div className="sv">
            <div className="sa" style={{ color: awaitingColor }}>
              {awaitingLabel}
            </div>
            {thr !== undefined && thr !== null && <div className="st">{formatThresholdLineLocal(sig, thr)}</div>}
          </div>
        </div>
      );
    }

    const { pass } = evaluateSignalLocal(sig, raw, thr);
    const display = formatSignalValueLocal(sig, raw);
    const thLine = formatThresholdLineLocal(sig, thr);

    return (
      <div className="sig-row" key={sig.id}>
        <span className="sn">{sig.label}</span>
        <div className="sv">
          <div className={`sa ${pass ? "p" : "f"}`}>{display}</div>
          {thLine ? <div className="st">{thLine}</div> : null}
        </div>
      </div>
    );
  }

  const midCollecting = (
    <>
      <div className="dl">Deadline</div>
      <div className="deadline-copy">
        Collection window is active while signals stream in from connected sources.
        <br />
        <span style={{ color: "#384d60" }}>Missing signals are treated as failures at verdict time.</span>
      </div>
    </>
  );

  const midOverride = (
    <>
      <div className="dl">Override record</div>
      <div className="cert-inline">
        <span className="who">{release.overrideBy || "Approver"}</span>
        <br />
        <span style={{ color: "#384d60" }}>&ldquo;{overrideText}&rdquo;</span>
      </div>
    </>
  );

  const midReasoning = (
    <>
      <div className="dl">
        Reasoning
        {Number.isFinite(recommendationIntel.confidence_score)
          ? ` · ${recommendationIntel.confidence_score}%`
          : verdictIntel.confidence_pct != null
            ? ` · ${verdictIntel.confidence_pct}%`
            : ""}
        {catStatuses?.ai === "fail" || catStatuses?.tests === "fail" ? " · review" : ""}
      </div>
      {reasoningPoints && reasoningPoints.length > 0 ? (
        reasoningPoints.map((pt, i) => (
          <div className="ri" key={i}>
            {pt}
          </div>
        ))
      ) : regressionBullets.length > 0 ? (
        regressionBullets.map((pt, i) => (
          <div className="ri" key={i}>
            {pt}
          </div>
        ))
      ) : (
        <>
          <div className="ri">
            {hasFailed
              ? "One or more signals failed their configured threshold."
              : "All evaluated signals cleared their thresholds."}
          </div>
          {normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.CERTIFIED && (
            <div className="ri">No correlated failure patterns matched prior incidents.</div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="release-detail">
      <div className="detail-grid">
        <div>
          <div className="dl">Signal evaluation</div>
          {ordered.map((entry) => renderSignalRow(entry))}
        </div>

        <div>
          {release.status === "collecting" ? (
            <>
              {midCollecting}
              <div className="dl" style={{ marginTop: 18 }}>
                Actions
              </div>
              <div className="da" style={{ marginTop: 0, paddingTop: 0, borderTop: "none", flexDirection: "column" }}>
                <button
                  type="button"
                  className="dab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCollectingAction?.("live");
                  }}
                >
                  View live stream
                </button>
                <button
                  type="button"
                  className="dab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCollectingAction?.("extend");
                  }}
                >
                  Extend deadline
                </button>
                <button
                  type="button"
                  className="dab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCollectingAction?.("pull");
                  }}
                >
                  Pull from connected sources
                </button>
              </div>
            </>
          ) : hasOverride && overrideText ? (
            midOverride
          ) : (
            midReasoning
          )}
        </div>

        <div>
          {intel?.alignment?.summary && release.status !== "collecting" && (
            <>
              <div className="dl">Post-deploy alignment</div>
              <div className="ri">{intel.alignment.summary}</div>
              {Array.isArray(intel.alignment.teaches) && intel.alignment.teaches.length > 0 && (
                <>
                  <div className="dl" style={{ marginTop: 12 }}>
                    What this teaches the system
                  </div>
                  {intel.alignment.teaches.map((t, i) => (
                    <div className="ri" key={i}>
                      {t}
                    </div>
                  ))}
                </>
              )}
              <div style={{ height: 14 }} />
            </>
          )}
          <div className="dl">Suggested actions</div>
          {hasFailed ? (
            <>
              <div className="ri">Address failing signals before promoting to production.</div>
              <div className="ri">Review thresholds in App → Thresholds.</div>
            </>
          ) : (
            <>
              <div className="ri">Continue monitoring post-deploy alignment.</div>
              {release.alignmentVerdict === "miss" && (
                <div className="ri">A revert was detected post-deploy — review the threshold suggestion.</div>
              )}
            </>
          )}
          <div className="da">
            {normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.UNCERTIFIED && (
              <button type="button" className="dab pr" onClick={() => onBeginOverride?.(release)}>
                Override &amp; certify
              </button>
            )}
            <button type="button" className="dab" onClick={() => onViewFullRecord?.(release)}>
              View full record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
