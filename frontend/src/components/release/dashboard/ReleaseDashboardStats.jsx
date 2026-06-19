export default function ReleaseDashboardStats({ wsReady, stats }) {
  const bypassCount = stats.shippedWithoutCertificationCount ?? 0;
  const incidents = stats.productionIncidentsCount ?? 0;
  const debtActive = stats.remediationDebtActive === true;

  return (
    <div className="stats-row">
      <div className="stat-card green">
        <div className="stat-label">Certified rate</div>
        <div className="stat-value g">{wsReady ? `${stats.certRate}%` : "—"}</div>
        <div className="stat-sub">{wsReady ? String(stats.total) : "—"}</div>
      </div>
      <div className="stat-card red">
        <div className="stat-label">Uncertified</div>
        <div className="stat-value r">{wsReady ? stats.uncertified : "—"}</div>
      </div>
      <div className={`stat-card bypass${bypassCount > 0 ? " bypass-active" : " bypass-idle"}`}>
        <div className="stat-label">Gate bypasses</div>
        <div className="stat-value">{wsReady ? bypassCount : "—"}</div>
      </div>
      <div className="stat-card amber">
        <div className="stat-label">Override rate</div>
        <div className="stat-value a">{wsReady ? `${stats.overrideRate}%` : "—"}</div>
      </div>
      <div className={`stat-card incident${incidents > 0 ? " incident-active" : " incident-idle"}`}>
        <div className="stat-label">Incidents</div>
        <div className="stat-value">{wsReady ? incidents : "—"}</div>
      </div>
      <div className={`stat-card debt${debtActive ? " debt-active" : " debt-idle"}`}>
        <div className="stat-label">Remediation debt</div>
        <div className="stat-value">{wsReady ? (debtActive ? 1 : 0) : "—"}</div>
      </div>
    </div>
  );
}
