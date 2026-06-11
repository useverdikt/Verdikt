import "../../ReleaseDashboardRedesign.css";

export default function ReleaseDetailLoadingSkeleton({ signalCount = 5 }) {
  return (
    <div className="release-detail-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="release-detail-loading-head">
        <span className="release-detail-loading-spinner" aria-hidden="true" />
        <span className="release-detail-loading-label">Loading signal data…</span>
      </div>
      <div className="release-detail-loading-grid">
        <div>
          <div className="dl">Signal evaluation</div>
          {Array.from({ length: signalCount }, (_, i) => (
            <div className="sig-row release-detail-sk-row" key={i}>
              <span className="release-detail-sk-bar release-detail-sk-bar--label sk-pulse" />
              <div className="sv">
                <span className="release-detail-sk-bar release-detail-sk-bar--value sk-pulse" />
                <span className="release-detail-sk-bar release-detail-sk-bar--meta sk-pulse" />
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="dl">Reasoning</div>
          <span className="release-detail-sk-bar release-detail-sk-bar--block sk-pulse" />
          <span className="release-detail-sk-bar release-detail-sk-bar--block sk-pulse" />
        </div>
        <div>
          <div className="dl">Suggested actions</div>
          <span className="release-detail-sk-bar release-detail-sk-bar--block sk-pulse" />
        </div>
      </div>
    </div>
  );
}
