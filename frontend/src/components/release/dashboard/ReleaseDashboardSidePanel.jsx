import { fullLoopBarPct } from "../../../lib/loopReadinessUi.js";
import { formatRelativeTimestamp, gradeCls } from "./releaseDashboardUtils.js";

export default function ReleaseDashboardSidePanel({
  loopReadiness,
  loopBand,
  loopStageRows,
  stats,
  signalReliabilityComputedAt,
  reliabilityRows,
  recentActivity,
  releaseVersionPrimarySecondary
}) {
  return (
    <aside className="right-panel">
      <div>
        <div className="loop-card">
          <div className="loop-card-hd">
            <div className="loop-card-title">Loop readiness</div>
            <span className={`band-pill ${loopBand.cls}`} style={loopBand.style}>
              {loopBand.label}
            </span>
          </div>
          <div className="funnel">
            {loopStageRows.map(([label, count, amber]) => {
              const totalBase = Math.max(Number(loopStageRows[0]?.[1] || 0), 1);
              const isFullLoops = label === "Full loops";
              const pct = isFullLoops
                ? fullLoopBarPct(count, loopReadiness?.band_thresholds?.reliable_min_loops ?? 10)
                : Math.max(6, Math.min(100, Math.round((Number(count || 0) / totalBase) * 100)));
              return (
                <div className="fs" key={String(label)}>
                  <div className="fl">{label}</div>
                  <div className="fb">
                    <div className="ff2" style={{ width: `${pct}%` }}></div>
                  </div>
                  <div className="fc" style={amber ? { color: "#f59e0b" } : {}}>
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="loop-next">
            <strong>Next action</strong>
            {loopReadiness?.next_action ||
              (stats.uncertified > 0
                ? `${stats.uncertified} releases have failed signals. Connect VCS to close the loop automatically.`
                : "Connect VCS to close the loop automatically.")}
          </div>
        </div>
      </div>

      <div>
        <div className="rp-label">Signal reliability</div>
        {signalReliabilityComputedAt ? (
          <div
            style={{
              color: "#4a6378",
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: -4,
              marginBottom: 8
            }}
          >
            Last updated {formatRelativeTimestamp(signalReliabilityComputedAt)}
          </div>
        ) : null}
        {reliabilityRows.length === 0 ? (
          <div
            style={{
              color: "#384d60",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "8px 0"
            }}
          >
            No reliability data yet.
          </div>
        ) : (
          reliabilityRows.map((row) => (
            <div className="sh-row" key={row.name}>
              <span className="sh-name">{row.name}</span>
              <span className={`sh-grade ${gradeCls(row.grade)}`}>{row.grade}</span>
              <span className="sh-rate">{row.rate}</span>
            </div>
          ))
        )}
      </div>

      <div>
        <div className="rp-label">Recent activity</div>
        {recentActivity.length === 0 ? (
          <div
            style={{
              color: "#384d60",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "8px 0"
            }}
          >
            No activity yet.
          </div>
        ) : (
          recentActivity.map(({ r, dot, text, meta }, idx) => {
            const primary = releaseVersionPrimarySecondary
              ? releaseVersionPrimarySecondary(r.version).primary
              : r.version;
            return (
              <div className="act-item" key={r.id}>
                <div className="act-dot-col">
                  <div className="act-dot" style={{ background: dot }}></div>
                  {idx < recentActivity.length - 1 && <div className="act-line"></div>}
                </div>
                <div>
                  <div className="act-event">
                    <strong>{primary}</strong> · {text}
                  </div>
                  <div className="act-meta">{meta}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
