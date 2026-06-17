import { Link } from "react-router-dom";
import { normalizeReleaseStatus, UI_RELEASE_STATUS, isLiveBypassRisk, canOfferOverride } from "../../../lib/releaseStatus.js";
import IntegrationPullBanner from "../../IntegrationPullBanner.jsx";
import {
  SignalEvidenceBlock,
  SignalSourceBadge,
  provenanceSourceForSignal
} from "../SignalEvidenceProvenance.jsx";
import {
  evaluateSignalLocal,
  formatSignalValueLocal,
  formatThresholdLineLocal,
  getOrderedDetailSignals,
  regressionRequiredLocal
} from "./releaseDashboardUtils.js";
import { buildDetailSignalRows } from "../../../lib/workspaceSignalUi.js";
import { isReleaseDetailPending } from "../../../lib/releaseDetailRefresh.js";
import ReleaseDetailLoadingSkeleton from "./ReleaseDetailLoadingSkeleton.jsx";

export default function ReleaseDetail({
  release,
  signalCategories,
  signalDefinitions = [],
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
  const isCollecting = normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.COLLECTING;
  const liveBypassRisk = isLiveBypassRisk(release);
  const showOverrideAction = canOfferOverride(release);
  const releaseId =
    release.backendReleaseId ||
    (typeof release.id === "string" && release.id.startsWith("rel_") ? release.id : null);
  const receivedSignalCount = Object.values(signals).filter((v) => v != null).length;
  const detailPending = isReleaseDetailPending(release);

  const legacyOrdered = getOrderedDetailSignals(signalCategories);
  const ordered =
    signalDefinitions.length > 0
      ? buildDetailSignalRows(signalDefinitions, legacyOrdered, signals)
      : legacyOrdered;

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
      "No signal values were recorded for this release. Connect signal sources in Settings or ingest via API, then re-evaluate."
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
    const provSource = provenanceSourceForSignal(release, sig.id);

    return (
      <div className="sig-row" key={sig.id}>
        <span className="sn">{sig.label}</span>
        <div className="sv">
          <div className={`sa ${pass ? "p" : "f"}`}>{display}</div>
          {thLine ? <div className="st">{thLine}</div> : null}
          {provSource != null && !isCollecting ? (
            <div className="st" style={{ marginTop: 4 }}>
              <SignalSourceBadge source={provSource} compact />
            </div>
          ) : null}
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
          : Number.isFinite(verdictIntel.confidence)
            ? ` · ${Math.round(verdictIntel.confidence * 100)}%`
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
          {normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.CERTIFIED && (
            <div className="ri">No correlated failure patterns matched prior incidents.</div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="release-detail">
      {detailPending ? (
        <ReleaseDetailLoadingSkeleton signalCount={ordered.length} />
      ) : (
        <>
      {!isCollecting && receivedSignalCount > 0 ? (
        <SignalEvidenceBlock release={release} showFlag />
      ) : null}
      <div className="detail-grid">
        <div>
          <div className="dl">Signal evaluation</div>
          {ordered.map((entry) => renderSignalRow(entry))}
        </div>

        <div>
          {release.status === "collecting" ? (
            <>
              {release.integration_pull && (
                <IntegrationPullBanner
                  integrationPull={release.integration_pull}
                  releaseId={releaseId}
                  compact
                />
              )}
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
                <Link
                  to="/settings?section=api"
                  className="dab"
                  style={{ textAlign: "center", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Settings → Signal sources
                </Link>
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
              <div style={{ height: 14 }} />
            </>
          )}
          <div className="dl">Suggested actions</div>
          {(() => {
            const actions =
              Array.isArray(verdictIntel.recommended_actions) && verdictIntel.recommended_actions.length
                ? verdictIntel.recommended_actions
                : Array.isArray(recommendationIntel.suggested_actions) && recommendationIntel.suggested_actions.length
                  ? recommendationIntel.suggested_actions
                  : null;
            if (actions) {
              return actions.slice(0, 4).map((a, i) => (
                <div className="ri" key={i}>{a}</div>
              ));
            }
            return hasFailed ? (
              liveBypassRisk ? (
                <>
                  <div className="ri">Code is live in production without certification — assess rollback, escalate, or document the incident.</div>
                  <div className="ri">Gate signal ingest is closed; pre-ship override is not available.</div>
                </>
              ) : (
                <>
                  <div className="ri">Address failing signals before promoting to production.</div>
                  <div className="ri">Review thresholds in App → Thresholds.</div>
                </>
              )
            ) : (
              <>
                <div className="ri">Continue monitoring post-deploy alignment.</div>
                {release.alignmentVerdict === "miss" && (
                  <div className="ri">
                    Post-deploy MISS detected — review prod calibration suggestions on{" "}
                    <Link to="/thresholds" style={{ color: "inherit" }}>Thresholds</Link>.
                  </div>
                )}
              </>
            );
          })()}
          <div className="da">
            {showOverrideAction && (
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
        </>
      )}
    </div>
  );
}
