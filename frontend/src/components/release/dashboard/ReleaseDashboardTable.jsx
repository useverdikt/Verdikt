import React from "react";
import ReleaseRow from "./ReleaseRow.jsx";
import ReleaseDetail from "./ReleaseDetail.jsx";

export default function ReleaseDashboardTable({
  wsReady,
  releases,
  visibleReleases,
  activeFilter,
  setActiveFilter,
  expandedId,
  toggleRow,
  releaseCatStatuses,
  signalCategories,
  signalDefinitions = [],
  thresholds,
  releaseTypes,
  formatReleaseAge,
  releaseVersionPrimarySecondary,
  onViewFullRecord,
  onBeginOverride,
  onCollectingAction,
  hasMoreReleases = false,
  loadingMoreReleases = false,
  onLoadMoreReleases
}) {
  return (
    <>
      <div className="panel-header">
        <div className="panel-title">Release history</div>
        <div className="panel-actions">
          {["All", "CERTIFIED", "UNCERTIFIED", "OVERRIDE", "INTEGRATION", "SIMULATOR"].map((f) => (
            <button
              key={f}
              type="button"
              className={`pf${activeFilter === f ? " active" : ""}`}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="releases-table">
        <div className="table-head">
          <div className="th"></div>
          <div className="th">Version</div>
          <div className="th">Verdict</div>
          <div className="th">Signals</div>
          <div className="th r">Issued</div>
        </div>

        {!wsReady ? (
          <div style={{ padding: "0" }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr 110px 130px 70px",
                  gap: 8,
                  padding: "12px 16px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  alignItems: "center"
                }}
              >
                {[28, 160, 80, 100, 45].map((w, j) => (
                  <div
                    key={j}
                    style={{
                      height: 12,
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.06)",
                      width: w,
                      animation: "sk-pulse 1.4s ease-in-out infinite",
                      animationDelay: `${i * 0.15 + j * 0.05}s`
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : releases.length === 0 ? (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              color: "#384d60",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12
            }}
          >
            No releases yet. Add one to get started.
          </div>
        ) : visibleReleases.length === 0 ? (
          <div
            style={{
              padding: "32px 24px",
              textAlign: "center",
              color: "#384d60",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12
            }}
          >
            No releases match the current filters.
          </div>
        ) : (
          visibleReleases.map((r, idx) => {
            const catStatuses = releaseCatStatuses[r.id] || {};
            const isExpanded = expandedId === r.id;
            const isLast = idx === visibleReleases.length - 1;
            return (
              <React.Fragment key={r.id}>
                <ReleaseRow
                  isLast={isLast}
                  release={r}
                  isExpanded={isExpanded}
                  onToggle={() => toggleRow(r.id)}
                  catStatuses={catStatuses}
                  signalCategories={signalCategories}
                  formatAge={formatReleaseAge}
                  releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
                  releaseTypes={releaseTypes}
                />
                {isExpanded && (
                  <ReleaseDetail
                    release={r}
                    signalCategories={signalCategories}
                    signalDefinitions={signalDefinitions}
                    catStatuses={catStatuses}
                    thresholds={thresholds}
                    releaseTypes={releaseTypes}
                    onViewFullRecord={onViewFullRecord}
                    onBeginOverride={onBeginOverride}
                    onCollectingAction={onCollectingAction}
                  />
                )}
              </React.Fragment>
            );
          })
        )}
      </div>

      {hasMoreReleases && visibleReleases.length > 0 ? (
        <div style={{ padding: "16px", textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            type="button"
            className="pf"
            disabled={loadingMoreReleases}
            onClick={onLoadMoreReleases}
          >
            {loadingMoreReleases ? "Loading more…" : "Load more releases"}
          </button>
        </div>
      ) : null}
    </>
  );
}
