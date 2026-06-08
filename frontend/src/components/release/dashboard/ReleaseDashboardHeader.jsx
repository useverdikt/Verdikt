import { SearchIcon } from "./ReleaseDashboardIcons.jsx";

export default function ReleaseDashboardHeader({
  activeEnv,
  setActiveEnv,
  searchQ,
  setSearchQ,
  onNewRelease
}) {
  return (
    <div className="rr-header">
      <div className="header-title">Releases</div>
      <div className="env-selector">
        {["All", "Prod", "Pre-Prod"].map((env) => (
          <button
            key={env}
            type="button"
            className={`env-btn${activeEnv === env ? " active" : ""}`}
            onClick={() => setActiveEnv(env)}
          >
            {env}
          </button>
        ))}
      </div>
      <div className="header-search">
        <SearchIcon />
        <input
          type="text"
          placeholder="Search releases…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
      </div>
      <button type="button" className="btn-new" onClick={onNewRelease}>
        + New release
      </button>
    </div>
  );
}
