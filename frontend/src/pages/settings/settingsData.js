/** Shared constants for Settings (ported from verdikt-settings.html). */

export const SECTION_LABELS = {
  general: "General",
  team: "Team & Roles",
  thresholds: "Quality Thresholds",
  api: "API & Signal Sources",
  trigger: "Release Trigger",
  governance: "Governance",
  notifications: "Notifications",
  emails: "Email Previews",
  billing: "Plan & Billing",
  danger: "Danger Zone"
};

export const THRESH_DEFAULTS = {
  smoke: 100,
  e2e_regression: 95,
  manual_qa_pct: 95,
  manual_qa_showstopper: "P0",
  startup: 3.0,
  screenload: 1.5,
  fps: 58,
  jserrors: 0.5,
  p95latency: 300,
  p99latency: 600,
  errorunderload: 1.0,
  recovery: 30,
  crashrate: 0.1,
  anrrate: 0.05,
  errorrate: 1.0,
  oomrate: 0.2,
  accuracy: 85,
  safety: 90,
  tone: 85,
  hallucination: 90,
  relevance: 82,
  accuracy_delta: 5,
  safety_delta: 5,
  tone_delta: 5,
  hallucination_delta: 5,
  relevance_delta: 5
};

export const TRIGGER_MODES = [
  {
    id: "manual",
    icon: "✎",
    name: "Manual declaration",
    desc: 'Anyone with certification authority clicks "Start certification" in Verdikt for a specific build or model version. No integration required.'
  },
  {
    id: "env",
    icon: "◎",
    name: "Environment promotion",
    desc: "Any deployment to a designated release candidate environment (e.g. pre-prod) opens a certification window automatically."
  },
  {
    id: "label",
    icon: "◈",
    name: "GitHub label",
    desc: "Applying a label (e.g. verdikt:rc) to a PR or release in GitHub triggers a certification window."
  },
  {
    id: "webhook",
    icon: "⌥",
    name: "Pipeline webhook",
    desc: "Your release/eval pipeline POSTs to Verdikt when a model version is ready to certify. Most precise option."
  }
];

/** Shown in Release Trigger UI — all modes from the static `verdikt-settings.html` mock. */
export const MVP_TRIGGER_MODE_IDS = TRIGGER_MODES.map((m) => m.id);

export const MEMBERS_SEED = [
  { name: "Jordan Blake", email: "jordan@useverdikt.com", role: "ai_product_lead", status: "active", color: "#3b82f6", initials: "JB" },
  { name: "Alex Baird", email: "alex@useverdikt.com", role: "vp_engineering", status: "active", color: "#0891b2", initials: "AB" },
  { name: "Priya Nair", email: "priya@useverdikt.com", role: "ml_engineer", status: "active", color: "#059669", initials: "PN" },
  { name: "Tom Hale", email: "tom@useverdikt.com", role: "engineer", status: "active", color: "#d97706", initials: "TH" },
  { name: "Lukas Bauer", email: "lukas@useverdikt.com", role: "tech_lead", status: "active", color: "#db2777", initials: "LB" },
  { name: "Mina Okafor", email: "mina.okafor@useverdikt.com", role: "ml_engineer", status: "pending", color: "#6b7280", initials: "MO" },
  { name: "Leo Grant", email: "leo@useverdikt.com", role: "engineer", status: "pending", color: "#6b7280", initials: "LG" }
];

export const ROLES = {
  ai_product_lead: "AI Product Lead",
  ml_engineer: "ML / AI Engineer",
  qe_lead: "QE Leader",
  tech_lead: "Tech Lead",
  release_manager: "Release Manager",
  vp_engineering: "VP Engineering",
  cto: "CTO / Founder",
  engineer: "Engineer"
};

export const API_KEYS_SEED = [
  { name: "Release/Eval Production", key: "vdk_live_4f9a2b••••••••••••••••••••", created: "2026-01-15", lastUsed: "2 hours ago" },
  { name: "Local development", key: "vdk_test_9e2c1d••••••••••••••••••••", created: "2026-01-20", lastUsed: "Never" }
];

export const SOURCES_SEED = [
  {
    icon: "✦",
    name: "Braintrust",
    detail: "AI eval scores — accuracy, safety, tone, hallucination, relevance",
    status: "connected",
    statusColor: "var(--green)"
  },
  {
    icon: "◐",
    name: "LangSmith",
    detail: "LLM eval traces — quality, faithfulness, correctness",
    status: "not connected",
    statusColor: "var(--dim)"
  },
  {
    icon: "⚡",
    name: "Sentry",
    detail: "Crash rate, error rate, exception volume",
    status: "connected",
    statusColor: "var(--green)"
  },
  {
    icon: "◈",
    name: "Datadog",
    detail: "Not connected",
    status: "not connected",
    statusColor: "var(--dim)"
  },
  {
    icon: "⊞",
    name: "CSV import",
    detail: "Manual release rows imported from a spreadsheet when connectors aren’t in use",
    sourceType: "upload",
    status: "active",
    statusColor: "var(--cyan)"
  }
];
