export default function ReleaseDashboardStats({ wsReady, stats, loopBand }) {
  return (
    <div className="stats-row">
      <div className="stat-card green">
        <div className="stat-label">Certified rate</div>
        <div className="stat-value g">{wsReady ? `${stats.certRate}%` : "—"}</div>
        <div className="stat-sub">{wsReady ? `of ${stats.total} releases` : "loading…"}</div>
      </div>
      <div className="stat-card red">
        <div className="stat-label">Uncertified</div>
        <div className="stat-value r">{wsReady ? stats.uncertified : "—"}</div>
        <div className="stat-sub">uncertified releases</div>
      </div>
      <div className="stat-card amber">
        <div className="stat-label">Override rate</div>
        <div className="stat-value a">{wsReady ? `${stats.overrideRate}%` : "—"}</div>
        <div className="stat-sub">of certified releases</div>
      </div>
      <div className="stat-card blue">
        <div className="stat-label">Full loop count</div>
        <div className="stat-value">{wsReady ? stats.loopCount : "—"}</div>
        <div
          className="stat-sub"
          style={
            loopBand.style || {
              color: loopBand.cls === "bp-rel" ? "#22c55e" : loopBand.cls === "bp-exp" ? "#94a3b8" : "#f59e0b"
            }
          }
        >
          ● {loopBand.label} band
        </div>
      </div>
    </div>
  );
}
