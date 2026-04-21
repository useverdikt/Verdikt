/** Pure helpers and defaults for Settings workspace (no React). */

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export const CSV_IMPORT_DETAIL = "Upload signal rows from a file when API connectors aren’t configured";

export const SOURCES_INITIAL = [
  {
    sourceId: "braintrust",
    icon: "✦",
    name: "Braintrust",
    detail: "AI eval scores — accuracy, safety, tone, hallucination, relevance",
    status: "not connected",
    statusColor: "var(--dim)",
    mapping: null
  },
  {
    sourceId: "langsmith",
    icon: "◐",
    name: "LangSmith",
    detail: "LLM eval traces — quality, faithfulness, correctness",
    status: "not connected",
    statusColor: "var(--dim)",
    mapping: null
  },
  {
    sourceId: "sentry",
    icon: "⚡",
    name: "Sentry",
    detail: "Crash rate, error rate, exception volume",
    status: "not connected",
    statusColor: "var(--dim)",
    mapping: null
  },
  {
    sourceId: "datadog",
    icon: "◈",
    name: "Datadog",
    detail: "API latency and runtime health",
    status: "not connected",
    statusColor: "var(--dim)",
    mapping: null
  },
  {
    sourceId: "csv",
    icon: "⊞",
    name: "CSV import",
    detail: CSV_IMPORT_DETAIL,
    sourceType: "upload",
    status: "not connected",
    statusColor: "var(--dim)",
    mapping: null
  }
];

export const ROLE_POLICY_DEFAULT = {
  ai_product_lead: { label: "AI Product Lead", title: "AI Product Lead", canAct: true, canOverride: false, color: "#06b6d4" },
  ml_engineer: { label: "ML / AI Engineer", title: "ML / AI Engineer", canAct: true, canOverride: false, color: "#10b981" },
  qe_lead: { label: "QE Leader", title: "QE Lead", canAct: true, canOverride: false, color: "#6e87a2" },
  tech_lead: { label: "Tech Lead", title: "Tech Lead", canAct: true, canOverride: false, color: "#f59e0b" },
  release_manager: { label: "Release Manager", title: "Release Manager", canAct: true, canOverride: false, color: "#38bdf8" },
  vp_engineering: { label: "VP Engineering", title: "VP Engineering", canAct: true, canOverride: true, color: "#6e87a2" },
  cto: { label: "CTO / Founder", title: "CTO / Founder", canAct: true, canOverride: true, color: "#ec4899" },
  engineer: { label: "Engineer", title: "Engineer", canAct: false, canOverride: false, color: "#6b7280" }
};

export const ROLE_CARD_ORDER = ["engineer", "ai_product_lead", "ml_engineer", "qe_lead", "tech_lead", "release_manager", "vp_engineering", "cto"];

export const ROLE_CARD_PERMS = {
  engineer: { yes: ["View certification verdicts", "View audit trail", "View signal trends"], no: ["Submit releases", "Configure thresholds", "Manage projects", "Override"] },
  ai_product_lead: { yes: ["All Engineer permissions", "Submit releases & signals", "Certify releases", "Configure thresholds", "Manage projects"], no: ["Approve overrides"] },
  ml_engineer: { yes: ["All Engineer permissions", "Submit model/prompt releases", "View AI eval signal details", "Prepare release evidence"], no: ["Configure governance", "Approve overrides"] },
  qe_lead: { yes: ["All Engineer permissions", "Own manual QA standards", "Co-own threshold calibration", "Certify releases", "Waive conditional checks"], no: ["Approve overrides"] },
  tech_lead: { yes: ["All Engineer permissions", "Certify releases", "Manage project-level setup", "Coordinate release readiness"], no: ["Approve overrides (unless configured)", "Billing & workspace deletion"] },
  release_manager: { yes: ["All Engineer permissions", "Start certification windows", "Track release state & blockers", "Coordinate override workflow"], no: ["Approve overrides (unless configured)", "Billing & workspace deletion"] },
  vp_engineering: { yes: ["All QE Leader permissions", "Approve overrides", "Name on every override record", "Manage team & roles", "Workspace settings"], no: [] },
  cto: { yes: ["All VP Engineering permissions", "Override authority — highest level", "Billing & workspace deletion"], no: [] }
};

export function sourceStatusDisplay(s) {
  if (s.sourceType === "upload") {
    if (s.status === "connected" || s.status === "active") {
      return { label: "Import in use", color: s.statusColor || "var(--certified)" };
    }
    return { label: "No import yet", color: "var(--fg3)" };
  }
  if (s.status === "connected") {
    return { label: "Connected", color: s.statusColor || "var(--green)" };
  }
  return { label: s.status, color: s.statusColor };
}

export function cloneSourcesBase() {
  return SOURCES_INITIAL.map((s) => ({ ...s, mapping: s.mapping ? { ...s.mapping } : null }));
}

export function mergeSourcesFromApi(base, data) {
  const integrations = data?.integrations || [];
  const csv = data?.csv_import;
  return base.map((row) => {
    if (row.sourceType === "upload") {
      if (csv && csv.row_count > 0) {
        return {
          ...row,
          status: "connected",
          statusColor: "var(--certified)",
          detail: `${csv.row_count} rows from ${csv.filename}`
        };
      }
      return {
        ...row,
        status: "not connected",
        statusColor: "var(--dim)",
        detail: CSV_IMPORT_DETAIL
      };
    }
    const int = integrations.find((i) => i.source_id === row.sourceId);
    if (int) {
      return {
        ...row,
        status: "connected",
        statusColor: "var(--green)"
      };
    }
    return {
      ...row,
      status: "not connected",
      statusColor: "var(--dim)"
    };
  });
}

export function loadRolePolicy() {
  try {
    const stored = JSON.parse(localStorage.getItem("vdk3_role_policy") || "{}");
    if (Object.keys(stored).length) return { ...ROLE_POLICY_DEFAULT, ...stored };
  } catch {
    /* ignore invalid JSON */
  }
  return { ...ROLE_POLICY_DEFAULT };
}

export function mergeThresholdsFromApi(map) {
  const apiThresholds = {};
  Object.entries(map || {}).forEach(([signalId, cfg]) => {
    if (cfg && typeof cfg === "object") {
      if (cfg.min != null) apiThresholds[signalId] = cfg.min;
      if (cfg.max != null) apiThresholds[signalId] = cfg.max;
    }
  });
  return apiThresholds;
}
