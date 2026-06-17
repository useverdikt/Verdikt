import { normalizeReleaseStatus, UI_RELEASE_STATUS } from "../../../lib/releaseStatus.js";
import { isSummaryPending } from "../../../lib/releaseDetailRefresh.js";
import {
  envClass,
  envDisplayLabel,
  summarizeListSignalOutcomes,
  verdictMeta
} from "./releaseDashboardUtils.js";
import { ExpandChevron } from "./ReleaseDashboardIcons.jsx";
import { EvidenceQualityFlag } from "../SignalEvidenceProvenance.jsx";

export default function ReleaseRow({
  release,
  isExpanded,
  isLast,
  onToggle,
  catStatuses,
  signalCategories,
  signalDefinitions = [],
  thresholds = {},
  formatAge,
  releaseVersionPrimarySecondary,
  releaseTypes
}) {
  const verdict = verdictMeta(release);
  const rvHead = releaseVersionPrimarySecondary
    ? releaseVersionPrimarySecondary(release.version)
    : { primary: release.version || "—", secondary: "" };

  const env = release.environment || "";
  const rtLabel = (releaseTypes || []).find((rt) => rt.id === release.releaseType)?.label || "";
  const secondaryLabel = rvHead.secondary || rtLabel || null;
  const fullTitle = rvHead.fullTitle || String(release.version || rvHead.primary || "—");

  const { dots, passCount, failCount, warnCount, evaluatedCount, overflow } = summarizeListSignalOutcomes({
    signalDefinitions,
    signalCategories,
    releaseSignals: release.signals,
    thresholds,
    releaseType: release.releaseType,
    releaseTypes
  });
  const receivedSignalCount = evaluatedCount;
  const summaryPending = isSummaryPending(release);

  const timeLabel = formatAge ? formatAge(release) : release.date || "—";
  const subLabel =
    normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.COLLECTING
      ? "in progress"
      : normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE
        ? release.overrideBy?.split(",")[0]?.trim() || "override"
        : normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.CERTIFIED
          ? receivedSignalCount > 0
            ? "certified"
            : "certified · no signals"
          : normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.UNCERTIFIED
            ? "uncertified"
            : "—";

  return (
    <div
      className={`release-row${isExpanded ? " expanded" : ""}${verdict.pulse ? " coll-pulse" : ""}${verdict.cls === "v-bypass" ? " bypass-risk" : ""}`}
      data-last={isLast ? "true" : undefined}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="td">
        <ExpandChevron />
      </div>

      <div className="td">
        <div>
          <div className="release-version" title={fullTitle}>
            {rvHead.primary}
            <span className={`release-env ${envClass(env)}`}>{envDisplayLabel(env)}</span>
          </div>
          {secondaryLabel && (
            <div className="release-label" title={fullTitle}>
              {secondaryLabel}
            </div>
          )}
        </div>
      </div>

      <div className="td verdict-cell">
        <div className={`vbadge ${verdict.cls}`}>
          <div className="vbadge-dot"></div>
          {verdict.label}
        </div>
        {release.evidenceQuality && normalizeReleaseStatus(release.status) !== UI_RELEASE_STATUS.COLLECTING ? (
          <EvidenceQualityFlag flag={release.evidenceQuality} compact />
        ) : null}
      </div>

      <div className="td sig-cell">
        {summaryPending ? (
          <>
            <div className="sig-mini sig-mini--loading" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="sd sk-pulse" />
              ))}
            </div>
            <div className="sig-frac sig-frac--loading sk-pulse" aria-busy="true">
              Loading signals…
            </div>
          </>
        ) : (
          <>
            <div className="sig-mini">
              {dots.map((d, i) => (
                <div key={i} className={`sd ${d}`}></div>
              ))}
              {overflow > 0 ? <span className="sig-overflow">+{overflow}</span> : null}
            </div>
            <div className="sig-frac">
              {normalizeReleaseStatus(release.status) === UI_RELEASE_STATUS.COLLECTING ? (
                evaluatedCount === 0 ? (
                  "0 received"
                ) : (
                  <>
                    <span className="fp">{passCount}</span> / {evaluatedCount} received
                  </>
                )
              ) : evaluatedCount === 0 ? (
                "no signals"
              ) : failCount > 0 ? (
                <>
                  <span className="ff">{failCount} failed</span>
                  {warnCount > 0 ? ` · ${warnCount} warn` : ""}
                  {overflow > 0 ? ` · +${overflow}` : ""}
                </>
              ) : warnCount > 0 ? (
                <>
                  <span className="fp">{passCount}</span> / {evaluatedCount} · {warnCount} warn
                  {overflow > 0 ? ` · +${overflow}` : ""}
                </>
              ) : (
                <>
                  <span className="fp">{passCount}</span> / {evaluatedCount} passed
                  {overflow > 0 ? ` · +${overflow}` : ""}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="td r time-cell">
        <span className="tm">{timeLabel}</span>
        <span>{subLabel}</span>
      </div>
    </div>
  );
}
