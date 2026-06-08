import { confMeta } from "../../../lib/releaseConfidenceMeta.js";
import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "../../../lib/releaseStatus.js";
import {
  alignBadge,
  envClass,
  envDisplayLabel,
  verdictMeta
} from "./releaseDashboardUtils.js";
import { ExpandChevron } from "./ReleaseDashboardIcons.jsx";

export default function ReleaseRow({
  release,
  isExpanded,
  isLast,
  onToggle,
  catStatuses,
  signalCategories,
  formatAge,
  releaseVersionPrimarySecondary,
  releaseTypes
}) {
  const verdict = verdictMeta(release.status);
  const intel = release.intelligence || {};
  const recommendation = intel.recommendation || {};
  const decisionScore = recommendation.confidence_score ?? intel.decision?.confidence_score;
  const rawVerdictConf = intel.verdict?.confidence_pct;
  const confPct = Number.isFinite(decisionScore)
    ? decisionScore
    : rawVerdictConf !== undefined && rawVerdictConf !== null && rawVerdictConf !== ""
      ? Number(rawVerdictConf)
      : undefined;
  const receivedSignalCount = Object.values(release.signals || {}).filter((v) => v != null).length;
  const conf = confMeta(release.status, Number.isFinite(confPct) ? confPct : undefined, {
    receivedSignalCount
  });
  const al = alignBadge(release.alignmentVerdict);
  const rvHead = releaseVersionPrimarySecondary
    ? releaseVersionPrimarySecondary(release.version)
    : { primary: release.version || "—", secondary: "" };

  const env = release.environment || "";
  const rtLabel = (releaseTypes || []).find((rt) => rt.id === release.releaseType)?.label || "";
  const secondaryLabel = rvHead.secondary || rtLabel || null;
  const fullTitle = rvHead.fullTitle || String(release.version || rvHead.primary || "—");

  const dots = signalCategories.slice(0, 5).map((cat) => {
    const s = catStatuses[cat.id] || "missing";
    if (s === "pass") return "p";
    if (s === "fail") return "f";
    if (s === "waived") return "w";
    return "m";
  });
  const passCount = dots.filter((d) => d === "p").length;
  const failCount = dots.filter((d) => d === "f").length;
  const warnCount = dots.filter((d) => d === "w").length;

  const timeLabel = formatAge ? formatAge(release) : release.date || "—";
  const subLabel =
    normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.COLLECTING
      ? "in progress"
      : normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE
        ? release.overrideBy?.split(",")[0]?.trim() || "override"
        : normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.CERTIFIED
          ? receivedSignalCount > 0
            ? "certified"
            : "certified · no signals"
          : normalizeLegacyUiStatus(release.status) === UI_RELEASE_STATUS.UNCERTIFIED
            ? "uncertified"
            : "—";

  return (
    <div
      className={`release-row${isExpanded ? " expanded" : ""}${verdict.pulse ? " coll-pulse" : ""}`}
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

      <div className="td">
        <div className={`vbadge ${verdict.cls}`}>
          <div className="vbadge-dot"></div>
          {verdict.label}
        </div>
      </div>

      <div className="td conf-cell">
        <div className="conf-lbl">
          <span className="conf-pct">{conf.displayPct}</span>
          <span className="conf-band">{conf.band}</span>
        </div>
        <div className="conf-track">
          <div className={`conf-fill ${conf.fill}`} style={{ width: `${conf.pct}%` }}></div>
        </div>
      </div>

      <div className="td sig-cell">
        <div className="sig-mini">
          {dots.map((d, i) => (
            <div key={i} className={`sd ${d}`}></div>
          ))}
        </div>
        <div className="sig-frac">
          {release.status === "collecting" ? (
            <>
              <span className="fp">{passCount}</span> / {dots.length} received
            </>
          ) : failCount > 0 ? (
            <>
              <span className="ff">{failCount} failed</span>
              {warnCount > 0 ? ` · ${warnCount} warn` : ""}
            </>
          ) : warnCount > 0 ? (
            <>
              <span className="fp">{passCount}</span> / {dots.length} · {warnCount} warn
            </>
          ) : (
            <>
              <span className="fp">{passCount}</span> / {dots.length} passed
            </>
          )}
        </div>
      </div>

      <div className="td r">
        <span className={`al-badge ${al.cls}`}>{al.label}</span>
      </div>

      <div className="td r time-cell">
        <span className="tm">{timeLabel}</span>
        <span>{subLabel}</span>
      </div>
    </div>
  );
}
