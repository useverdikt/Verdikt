import React, { useMemo, useState } from "react";
import { confMeta } from "../../lib/releaseConfidenceMeta.js";
import "./ReleaseDashboardRedesign.css";

/* ── helpers ──────────────────────────────────────────────────────────────── */
function verdictMeta(status) {
  if (status === "shipped")    return { cls: "v-cert", label: "CERTIFIED",     pulse: false };
  if (status === "overridden") return { cls: "v-ov",   label: "WITH OVERRIDE", pulse: false };
  if (status === "blocked")    return { cls: "v-un",   label: "UNCERTIFIED",   pulse: false };
  if (status === "collecting") return { cls: "v-col",  label: "COLLECTING",    pulse: true  };
  return                              { cls: "v-col",  label: "PENDING",       pulse: false };
}

/* env comes from r.environment (set on new releases / backend) */
function envBucket(env) {
  const s = String(env || "").toLowerCase().trim();
  if (!s) return "production";
  if (s.includes("stag")) return "staging";
  if (s.includes("uat") || s.includes("preview") || s.includes("pre") || s.includes("non-prod")) return "uat";
  if (s.includes("prod")) return "production";
  return "production";
}

function envClass(env) {
  const b = envBucket(env);
  if (b === "staging") return "env-stg";
  if (b === "uat") return "env-pre";
  return "env-prod";
}

/** Short label on the release row — matches env tabs (prod / staging / uat) */
function envDisplayLabel(env) {
  const b = envBucket(env);
  if (b === "staging") return "staging";
  if (b === "uat") return "uat";
  return "prod";
}

function alignBadge(status, alignmentVerdict) {
  if (alignmentVerdict === "correct")  return { cls: "al-c", label: "CORRECT"  };
  if (alignmentVerdict === "miss")     return { cls: "al-m", label: "MISS"     };
  if (alignmentVerdict === "override") return { cls: "al-o", label: "OVERRIDE" };
  if (status === "collecting")         return { cls: "al-p", label: "—"        };
  if (status === "blocked")            return { cls: "al-p", label: "pending"  };
  return                                      { cls: "al-p", label: "pending"  };
}

/* Mirrors AppMain evaluateSignal / fmtVal — used for rich expanded rows */
function evaluateSignalLocal(sig, value, threshold) {
  if (sig.direction === "test") {
    const v = value && typeof value === "object" ? value : { rate: value === "pass" ? 100 : 0, severity: value === "pass" ? "none" : "P0" };
    const rate = v.rate ?? 0;
    const severity = v.severity ?? "none";
    const isP0 = severity === "P0";
    const ratePass = rate >= Number(threshold);
    return { pass: ratePass && !isP0 };
  }
  if (sig.direction === "pass") return { pass: value === "pass" };
  if (sig.direction === "above") return { pass: Number(value) >= Number(threshold) };
  if (sig.direction === "below") return { pass: Number(value) <= Number(threshold) };
  return { pass: false };
}

function formatSignalValueLocal(sig, value) {
  if (value === undefined || value === null) return null;
  if (sig.direction === "test") {
    const v = value && typeof value === "object" ? value : { rate: value === "pass" ? 100 : 0, severity: value === "pass" ? "none" : "P0" };
    const rate = v.rate ?? 0;
    const sev = v.severity ?? "none";
    return `${rate}%${sev !== "none" ? ` · ${sev}` : ""}`;
  }
  if (sig.direction === "pass") return value === "pass" ? "PASS" : "FAIL";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (sig.unit === "%") return (n < 10 && n !== Math.floor(n) ? n.toFixed(2) : n.toFixed(1)) + "%";
  if (sig.unit === "s") return n.toFixed(1) + "s";
  if (sig.unit === "ms") return Math.round(n) + "ms";
  if (sig.unit === "fps") return Math.round(n) + "fps";
  return String(value);
}

function formatThresholdLineLocal(sig, threshold) {
  if (threshold === undefined || threshold === null) return "";
  if (sig.direction === "test") return `threshold ≥${threshold}% pass rate`;
  if (sig.direction === "above") return `threshold ≥${threshold}${sig.unit || ""}`;
  if (sig.direction === "below") return `threshold ≤${threshold}${sig.unit || ""}`;
  return "";
}

function regressionRequiredLocal(releaseTypes, releaseTypeId) {
  const t = (releaseTypes || []).find((r) => r.id === releaseTypeId);
  if (t && Object.prototype.hasOwnProperty.call(t, "regressionRequired")) return t.regressionRequired;
  return null;
}

/** Same order as HTML mock: AI core + latency + smoke/e2e */
const DETAIL_SIGNAL_ORDER = ["accuracy", "safety", "hallucination", "relevance", "tone", "p95latency", "smoke", "e2e_regression"];

function getOrderedDetailSignals(signalCategories) {
  const byId = /* @__PURE__ */ new Map();
  for (const cat of signalCategories || []) {
    for (const sig of cat.signals || []) {
      if (!byId.has(sig.id)) byId.set(sig.id, { cat, sig });
    }
  }
  const out = [];
  for (const id of DETAIL_SIGNAL_ORDER) {
    if (byId.has(id)) out.push(byId.get(id));
  }
  return out;
}

/* ── inline SVGs ─────────────────────────────────────────────────────────── */
function ExpandChevron() {
  return (
    <svg className="expand-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.2"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="search-icon">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Release row ─────────────────────────────────────────────────────────── */
function ReleaseRow({ release, isExpanded, isLast, onToggle, catStatuses, signalCategories, formatAge, releaseVersionPrimarySecondary, releaseTypes }) {
  const verdict = verdictMeta(release.status);
  const intel = release.intelligence || {};
  const rawConf = intel.verdict?.confidence_pct;
  const confPct =
    rawConf !== undefined && rawConf !== null && rawConf !== ""
      ? Number(rawConf)
      : undefined;
  const conf = confMeta(
    release.status,
    Number.isFinite(confPct) ? confPct : undefined
  );
  const al = alignBadge(release.status, release.alignmentVerdict);
  const rvHead = releaseVersionPrimarySecondary
    ? releaseVersionPrimarySecondary(release.version)
    : { primary: release.version || "—", secondary: "" };

  /* Use r.environment for the env badge; fall back to a short release-type label */
  const env = release.environment || "";
  const rtLabel = (releaseTypes || []).find(rt => rt.id === release.releaseType)?.label || "";
  /* secondary row label: version tail OR release-type label */
  const secondaryLabel = rvHead.secondary || rtLabel || null;

  /* signal dots — up to 5 categories */
  const dots = signalCategories.slice(0, 5).map((cat) => {
    const s = catStatuses[cat.id] || "pending";
    if (s === "pass")   return "p";
    if (s === "fail")   return "f";
    if (s === "waived") return "w";
    return "m";
  });
  const passCount = dots.filter(d => d === "p").length;
  const failCount = dots.filter(d => d === "f").length;
  const warnCount = dots.filter(d => d === "w").length;

  const timeLabel = formatAge ? formatAge(release) : (release.date || "—");
  const subLabel =
    release.status === "collecting"  ? "in progress" :
    release.status === "overridden"  ? (release.overrideBy?.split(",")[0]?.trim() || "override") :
    release.status === "shipped"     ? "auto-certified" :
    release.status === "blocked"     ? "needs review" : "—";

  return (
    <div
      className={`release-row${isExpanded ? " expanded" : ""}${verdict.pulse ? " coll-pulse" : ""}`}
      data-last={isLast ? "true" : undefined}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
    >
      <div className="td"><ExpandChevron /></div>

      <div className="td">
        <div>
          <div className="release-version">
            {rvHead.primary}
            <span className={`release-env ${envClass(env)}`}>
              {envDisplayLabel(env)}
            </span>
          </div>
          {secondaryLabel && <div className="release-label">{secondaryLabel}</div>}
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
          {release.status === "collecting" || conf.band === "awaiting signals" ? (
            <span className="conf-awaiting">{conf.band}</span>
          ) : (
            <>
              <span>{conf.pct ? `${conf.pct}%` : "—"}</span>
              <span className="conf-band">{conf.band}</span>
            </>
          )}
        </div>
        <div className="conf-track">
          <div className={`conf-fill ${conf.fill}`} style={{ width: `${conf.pct}%` }}></div>
        </div>
      </div>

      <div className="td sig-cell">
        <div className="sig-mini">
          {dots.map((d, i) => <div key={i} className={`sd ${d}`}></div>)}
        </div>
        <div className="sig-frac">
          {release.status === "collecting" ? (
            <><span className="fp">{passCount}</span> / {dots.length} received</>
          ) : failCount > 0 ? (
            <><span className="ff">{failCount} failed</span>{warnCount > 0 ? ` · ${warnCount} warn` : ""}</>
          ) : warnCount > 0 ? (
            <><span className="fp">{passCount}</span> / {dots.length} · {warnCount} warn</>
          ) : (
            <><span className="fp">{passCount}</span> / {dots.length} passed</>
          )}
        </div>
      </div>

      <div className="td r"><span className={`al-badge ${al.cls}`}>{al.label}</span></div>

      <div className="td r time-cell">
        <span className="tm">{timeLabel}</span>
        <span>{subLabel}</span>
      </div>
    </div>
  );
}

/* ── Expand detail panel — per-signal values from release.signals + thresholds ─ */
function ReleaseDetail({
  release,
  signalCategories,
  catStatuses,
  thresholds,
  releaseTypes,
  onViewFullRecord,
  onBeginOverride,
  onCollectingAction,
}) {
  const intel = release.intelligence || {};
  const verdictIntel = intel.verdict || {};
  const overrideIntel = intel.override || {};
  const signals = release.signals || {};
  const reqd = regressionRequiredLocal(releaseTypes, release.releaseType);

  const ordered = getOrderedDetailSignals(signalCategories);

  /* Backend: recommendation engine uses decision.reasoning[]; verdict intel uses summary (incl. Gemini assistive). */
  let reasoningPoints = verdictIntel.reasoning
    ? (Array.isArray(verdictIntel.reasoning)
        ? verdictIntel.reasoning
        : [String(verdictIntel.reasoning)]).slice(0, 6)
    : null;
  if ((!reasoningPoints || reasoningPoints.length === 0) && typeof verdictIntel.summary === "string" && verdictIntel.summary.trim()) {
    reasoningPoints = [verdictIntel.summary.trim()];
  }

  const deltaRows = Array.isArray(release.release_deltas) ? release.release_deltas : [];
  const regressionBullets = deltaRows
    .filter((row) => row.no_baseline || !row.passed)
    .slice(0, 5)
    .map((row) => (row.no_baseline
      ? `${row.signal_id}: no baseline`
      : `${row.signal_id}: ${row.current_value} (baseline ${row.baseline_value})`));

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
      return (
        <div className="sig-row" key={sig.id}>
          <span className="sn">{sig.label}</span>
          <div className="sv">
            <div className="sa" style={{ color: "#384d60" }}>awaiting…</div>
            {thr !== undefined && thr !== null && (
              <div className="st">{formatThresholdLineLocal(sig, thr)}</div>
            )}
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
        Reasoning{verdictIntel.confidence_pct != null ? ` · ${verdictIntel.confidence_pct}%` : ""}
        {(catStatuses?.ai === "fail" || catStatuses?.tests === "fail") ? " · review" : ""}
      </div>
      {reasoningPoints && reasoningPoints.length > 0 ? (
        reasoningPoints.map((pt, i) => <div className="ri" key={i}>{pt}</div>)
      ) : regressionBullets.length > 0 ? (
        regressionBullets.map((pt, i) => <div className="ri" key={i}>{pt}</div>)
      ) : (
        <>
          <div className="ri">
            {hasFailed
              ? "One or more signals failed their configured threshold."
              : "All evaluated signals cleared their thresholds."}
          </div>
          {release.status === "shipped" && (
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
              <div className="dl" style={{ marginTop: 18 }}>Actions</div>
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
                  <div className="dl" style={{ marginTop: 12 }}>What this teaches the system</div>
                  {intel.alignment.teaches.map((t, i) => (
                    <div className="ri" key={i}>{t}</div>
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
              <div className="ri">Review thresholds in Settings → Quality Thresholds.</div>
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
            {release.status === "blocked" && (
              <button
                type="button"
                className="dab pr"
                onClick={() => onBeginOverride?.(release)}
              >
                Override &amp; certify
              </button>
            )}
            <button
              type="button"
              className="dab"
              onClick={() => onViewFullRecord?.(release)}
            >
              View full record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Setup checklist banner ──────────────────────────────────────────────── */
function SetupBanner({ setupChecklist }) {
  if (!setupChecklist || setupChecklist.complete) return null;
  return (
    <div style={{
      margin: "0 0 16px",
      background: "#090d14",
      border: "1px solid #18243a",
      borderRadius: 8,
      padding: "12px 14px",
    }}>
      <div style={{
        fontSize: 9, color: "#3b82f6", fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8,
      }}>Setup checklist</div>
      {setupChecklist.items.map((item) => (
        <div key={item.id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, marginBottom: 6,
        }}>
          <div style={{ fontSize: 12, color: item.done ? "#6e87a2" : "#c4d4e8", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: item.done ? "#22c55e" : "#f59e0b" }}>{item.done ? "✓" : "·"}</span>
            {item.label}
          </div>
          {!item.done && (
            <a href={item.to} style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none", fontFamily: "'JetBrains Mono', monospace" }}>
              Open →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export function ReleaseDashboard({
  releases = [],
  signalCategories = [],
  calcCategoryStatus,
  thresholds = {},
  releaseTypes = [],
  releaseVersionPrimarySecondary,
  formatReleaseAge,
  onNewRelease,
  onViewFullRecord,
  onBeginOverride,
  onCollectingAction,
  setupChecklist,
}) {
  const [activeEnv,    setActiveEnv]    = useState("All");
  const [activeTab,    setActiveTab]    = useState("All releases");
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedId,   setExpandedId]   = useState(null);
  const [searchQ,      setSearchQ]      = useState("");

  /* filtered table rows — tab keys map to envBucket(release.environment) */
  const visibleReleases = useMemo(() => {
    let list = [...releases];
    if (activeEnv !== "All") {
      const want =
        activeEnv === "Production" ? "production" :
        activeEnv === "Staging" ? "staging" :
        activeEnv === "UAT" ? "uat" : null;
      if (want) list = list.filter((r) => envBucket(r.environment) === want);
    }
    if (activeTab === "Needs review") list = list.filter(r => r.status === "blocked");
    if (activeTab === "Overrides")    list = list.filter(r => r.status === "overridden");
    if (activeFilter === "CERTIFIED")   list = list.filter(r => r.status === "shipped");
    if (activeFilter === "UNCERTIFIED") list = list.filter(r => r.status === "blocked");
    if (activeFilter === "OVERRIDE")    list = list.filter(r => r.status === "overridden");
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(r => String(r.version || "").toLowerCase().includes(q));
    }
    return list;
  }, [releases, activeEnv, activeTab, activeFilter, searchQ]);

  /* summary stats */
  const stats = useMemo(() => {
    const total = releases.length;
    const certified = releases.filter(r => r.status === "shipped" || r.status === "overridden").length;
    const certRate = total ? Math.round((certified / total) * 100) : 0;
    const uncertified = releases.filter(r => r.status === "blocked").length;
    const overrideCount = releases.filter(r => r.status === "overridden").length;
    const overrideRate = certified ? Math.round((overrideCount / certified) * 100) : 0;
    const loopCount = releases.filter(r => r.alignmentVerdict).length;
    return { certRate, uncertified, overrideRate, loopCount, total, certified };
  }, [releases]);

  /* per-release category statuses */
  const releaseCatStatuses = useMemo(() => {
    if (!calcCategoryStatus) return {};
    const map = {};
    for (const r of releases) {
      map[r.id] = {};
      for (const cat of signalCategories) {
        map[r.id][cat.id] = calcCategoryStatus(cat.id, r.signals, thresholds, r.releaseType);
      }
    }
    return map;
  }, [releases, signalCategories, calcCategoryStatus, thresholds]);

  /* recent activity */
  const recentActivity = useMemo(() => {
    return releases.slice(0, 5).map(r => ({
      r,
      dot: r.status === "shipped"    ? "#22c55e" :
           r.status === "blocked"    ? "#ef4444" :
           r.status === "overridden" ? "#f59e0b" : "#3b82f6",
      text: r.status === "collecting"  ? "collecting signals"        :
            r.status === "blocked"     ? "UNCERTIFIED"               :
            r.status === "overridden"  ? "certified with override"   :
            r.status === "shipped"     ? "certified"                 : "—",
      meta: (formatReleaseAge ? formatReleaseAge(r) : r.date || "—")
            + " · " + envDisplayLabel(r.environment),
    }));
  }, [releases, formatReleaseAge]);

  const reliabilityRows = [
    { name: "accuracy",     grade: "A",  rate: "98%"  },
    { name: "safety",       grade: "A",  rate: "100%" },
    { name: "hallucination",grade: "B+", rate: "91%"  },
    { name: "relevance",    grade: "B",  rate: "87%"  },
    { name: "latency p95",  grade: "C",  rate: "74%"  },
  ];
  const gradeCls = (g) => {
    if (g === "A" || g === "A+") return "ga";
    if (String(g).startsWith("B")) return "gb";
    if (String(g).startsWith("C")) return "gc";
    return "gd";
  };

  const toggleRow = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="release-redesign">

      {/* ── Top header ── */}
      <div className="rr-header">
        <div className="header-title">Releases</div>
        <div className="env-selector">
          {["All", "Production", "Staging", "UAT"].map(env => (
            <button key={env} type="button"
              className={`env-btn${activeEnv === env ? " active" : ""}`}
              onClick={() => setActiveEnv(env)}>
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
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>
        <button type="button" className="btn-new" onClick={onNewRelease}>
          + New release
        </button>
      </div>

      {/* ── Body ── */}
      <div className="body-split">
        <div className="content">

          {/* Setup checklist */}
          <SetupBanner setupChecklist={setupChecklist} />

          {/* Stats row */}
          <div className="stats-row">
            <div className="stat-card green">
              <div className="stat-label">Certified rate</div>
              <div className="stat-value g">{stats.certRate}%</div>
              <div className="stat-sub">of {stats.total} releases</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Uncertified</div>
              <div className="stat-value r">{stats.uncertified}</div>
              <div className="stat-sub">releases pending review</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Override rate</div>
              <div className="stat-value a">{stats.overrideRate}%</div>
              <div className="stat-sub">of certified releases</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-label">Full loop count</div>
              <div className="stat-value">{stats.loopCount}</div>
              <div className="stat-sub" style={{ color: "#f59e0b" }}>● Emerging band</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            {["All releases", "Needs review", "Overrides", "Alignment"].map(tab => (
              <button key={tab} type="button"
                className={`tab${activeTab === tab ? " active" : ""}`}
                onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </div>

          {/* Panel header */}
          <div className="panel-header">
            <div className="panel-title">Release history</div>
            <div className="panel-actions">
              {["All", "CERTIFIED", "UNCERTIFIED", "OVERRIDE"].map(f => (
                <button key={f} type="button"
                  className={`pf${activeFilter === f ? " active" : ""}`}
                  onClick={() => setActiveFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Releases table */}
          <div className="releases-table">
            <div className="table-head">
              <div className="th"></div>
              <div className="th">Version</div>
              <div className="th">Verdict</div>
              <div className="th">Confidence</div>
              <div className="th">Signals</div>
              <div className="th r">Alignment</div>
              <div className="th r">Issued</div>
            </div>

            {releases.length === 0 ? (
              <div style={{
                padding: "40px 24px", textAlign: "center",
                color: "#384d60", fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              }}>
                No releases yet. Add one to get started.
              </div>
            ) : visibleReleases.length === 0 ? (
              <div style={{
                padding: "32px 24px", textAlign: "center",
                color: "#384d60", fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              }}>
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

        </div>

        {/* ── Right panel ── */}
        <aside className="right-panel">

          {/* Loop readiness */}
          <div>
            <div className="loop-card">
              <div className="loop-card-hd">
                <div className="loop-card-title">Loop readiness</div>
                <span className="band-pill bp-em">EMERGING</span>
              </div>
              <div className="funnel">
                {[
                  ["Total releases",    stats.total,                            "f100", false],
                  ["Verdict issued",    releases.filter(r => r.status !== "collecting").length, "f88", false],
                  ["Eligible (3hr+)",   Math.max(0, releases.filter(r => !["collecting","pending"].includes(r.status)).length), "f72", false],
                  ["With observations", stats.total > 0 ? Math.round(stats.total * 0.77) : 0,  "f58", false],
                  ["Full loops",        stats.loopCount,                        "f41", true],
                ].map(([label, count, cls, amber]) => (
                  <div className="fs" key={String(label)}>
                    <div className="fl">{label}</div>
                    <div className="fb"><div className={`ff2 ${cls}`}></div></div>
                    <div className="fc" style={amber ? { color: "#f59e0b" } : {}}>{count}</div>
                  </div>
                ))}
              </div>
              <div className="loop-next">
                <strong>Next action</strong>
                {stats.uncertified > 0
                  ? `${stats.uncertified} releases have failed signals. Connect VCS to close the loop automatically.`
                  : "Connect VCS to close the loop automatically."}
              </div>
            </div>
          </div>

          {/* Signal reliability */}
          <div>
            <div className="rp-label">Signal reliability</div>
            {reliabilityRows.map(row => (
              <div className="sh-row" key={row.name}>
                <span className="sh-name">{row.name}</span>
                <span className={`sh-grade ${gradeCls(row.grade)}`}>{row.grade}</span>
                <span className="sh-rate">{row.rate}</span>
              </div>
            ))}
          </div>

          {/* Recent activity */}
          <div>
            <div className="rp-label">Recent activity</div>
            {recentActivity.length === 0 ? (
              <div style={{ color: "#384d60", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: "8px 0" }}>
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
      </div>
    </div>
  );
}

export { ReleaseDashboard as ReleaseDashboardRedesign };
