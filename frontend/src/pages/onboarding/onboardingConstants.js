export const STEPS = [
  { id: "welcome", label: "Welcome", sub: "Value in 30 minutes" },
  { id: "ws", label: "Workspace", sub: "Team & project" },
  { id: "rtypes", label: "Release types", sub: "Regression logic" },
  { id: "release", label: "First release", sub: "Run the verdict engine" },
  { id: "verdict", label: "Certification", sub: "Your first verdict" },
  { id: "account", label: "Your account", sub: "Name & role" }
];

export const THRESHOLD_PRESETS = {
  ai_web: {
    id: "ai_web",
    label: "Web App",
    blurb: "Browser-based product with user-facing latency and JS stability needs.",
    thresholds: {
      smoke: 100,
      e2e_regression: 95,
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
    }
  },
  ai_mobile: {
    id: "ai_mobile",
    label: "Mobile App",
    blurb: "Mobile-first product with higher startup and device variability.",
    thresholds: {
      smoke: 100,
      e2e_regression: 93,
      startup: 3.5,
      screenload: 2.0,
      fps: 55,
      jserrors: 0.8,
      p95latency: 400,
      p99latency: 800,
      errorunderload: 1.5,
      recovery: 40,
      crashrate: 0.2,
      anrrate: 0.08,
      errorrate: 1.2,
      oomrate: 0.35,
      accuracy: 85,
      safety: 90,
      tone: 84,
      hallucination: 90,
      relevance: 82,
      accuracy_delta: 5,
      safety_delta: 5,
      tone_delta: 5,
      hallucination_delta: 5,
      relevance_delta: 5
    }
  },
  ai_api: {
    id: "ai_api",
    label: "API / Backend",
    blurb: "Server/API workloads where reliability and latency budgets are stricter.",
    thresholds: {
      smoke: 100,
      e2e_regression: 95,
      startup: 2.5,
      screenload: 1.2,
      fps: 58,
      jserrors: 0.3,
      p95latency: 250,
      p99latency: 500,
      errorunderload: 0.7,
      recovery: 20,
      crashrate: 0.08,
      anrrate: 0.03,
      errorrate: 0.8,
      oomrate: 0.15,
      accuracy: 88,
      safety: 92,
      tone: 85,
      hallucination: 92,
      relevance: 85,
      accuracy_delta: 4,
      safety_delta: 4,
      tone_delta: 5,
      hallucination_delta: 4,
      relevance_delta: 4
    }
  }
};

export const RTYPES = [
  { id: "prompt_update", label: "Prompt / UX Update", icon: "✦", reg: "req" },
  { id: "model_patch", label: "Model Patch", icon: "⊘", reg: "wav" },
  { id: "safety_patch", label: "Safety Hotfix", icon: "⚡", reg: "wav" },
  { id: "policy_change", label: "Routing / Policy Change", icon: "◎", reg: "dis" },
  { id: "model_update", label: "Model Version Update", icon: "◐", reg: "wav" }
];

export const CATS = [
  {
    id: "tests",
    label: "Delivery Reliability",
    icon: "✦",
    color: "var(--cyan)",
    desc: "Smoke (always required) · E2E regression (conditional)",
    sigs: [
      { id: "smoke", label: "Smoke tests", dir: "test", unit: "%", hg: false, cond: false },
      { id: "e2e_regression", label: "E2E regression", dir: "test", unit: "%", hg: false, cond: true }
    ]
  },
  {
    id: "performance",
    label: "Runtime Performance",
    icon: "◎",
    color: "var(--accentL)",
    desc: "Client/API responsiveness and behaviour under load",
    sigs: [
      { id: "startup", label: "Cold startup", dir: "below", unit: "s", hg: false, cond: false },
      { id: "screenload", label: "Screen load", dir: "below", unit: "s", hg: false, cond: false },
      { id: "fps", label: "Frame rate", dir: "above", unit: "fps", hg: false, cond: false },
      { id: "jserrors", label: "JS error rate", dir: "below", unit: "%", hg: false, cond: false },
      { id: "p95latency", label: "API p95", dir: "below", unit: "ms", hg: false, cond: false },
      { id: "p99latency", label: "API p99", dir: "below", unit: "ms", hg: false, cond: false },
      { id: "errorunderload", label: "Error under load", dir: "below", unit: "%", hg: false, cond: false },
      { id: "recovery", label: "Stress recovery", dir: "below", unit: "s", hg: false, cond: false }
    ]
  },
  {
    id: "stability",
    label: "Runtime Reliability",
    icon: "◈",
    color: "var(--green)",
    desc: "Crash and error rate signals",
    sigs: [
      { id: "crashrate", label: "Crash rate", dir: "below", unit: "%", hg: false, cond: false },
      { id: "anrrate", label: "ANR rate", dir: "below", unit: "%", hg: false, cond: false },
      { id: "errorrate", label: "API error rate", dir: "below", unit: "%", hg: false, cond: false },
      { id: "oomrate", label: "OOM rate", dir: "below", unit: "%", hg: false, cond: false }
    ]
  },
  {
    id: "ai",
    label: "AI Eval Quality",
    icon: "◐",
    color: "var(--pink)",
    desc: "LLM feature quality scores — floor + max regression",
    sigs: [
      { id: "accuracy", label: "Accuracy", dir: "above", unit: "%", hg: false, cond: false, delta: true },
      { id: "safety", label: "Safety", dir: "above", unit: "%", hg: false, cond: false, delta: true },
      { id: "tone", label: "Tone", dir: "above", unit: "%", hg: false, cond: false, delta: true },
      { id: "hallucination", label: "Hallucination", dir: "above", unit: "%", hg: false, cond: false, delta: true },
      { id: "relevance", label: "Relevance", dir: "above", unit: "%", hg: false, cond: false, delta: true }
    ]
  }
];

export const SOURCE_OPTIONS = [
  {
    id: "integrations",
    icon: "◎",
    name: "Signal integrations",
    desc: "Pull live signal data directly from BrowserStack, Sentry, Datadog, and Braintrust. Version tags in each tool become the release identifier.",
    tag: "RECOMMENDED"
  },
  {
    id: "csv",
    icon: "⊞",
    name: "CSV upload",
    desc: "Export signal data from your tools and upload a structured CSV per release. Works with any provider that can export data.",
    tag: "INTERIM"
  },
  {
    id: "manual",
    icon: "✎",
    name: "Manual entry",
    desc: "Enter signal values directly in the First release step in this setup flow. Useful while integrations are being set up — always available alongside other sources.",
    tag: "ALWAYS AVAILABLE"
  }
];

export const TRIGGER_MODES = [
  {
    id: "manual",
    icon: "✎",
    name: "Manual declaration",
    desc: 'Anyone with certification authority clicks "Start certification" in Verdikt for a specific build or model version. Works for any AI team regardless of workflow. No integration required.',
    tag: "DEFAULT"
  },
  {
    id: "env",
    icon: "◎",
    name: "Environment promotion",
    desc: "Verdikt opens a certification window whenever a new build is deployed to a designated environment (e.g. staging). UAT remains a free-for-all.",
    tag: "NO PIPELINE CHANGE"
  },
  {
    id: "label",
    icon: "◈",
    name: "GitHub label",
    desc: "Apply a label (e.g. verdikt:rc) to a PR or release in GitHub. Verdikt watches for that label and opens a collection window immediately.",
    tag: "ONE CLICK"
  },
  {
    id: "webhook",
    icon: "⌥",
    name: "Pipeline webhook",
    desc: "Your release/eval pipeline POSTs to Verdikt when a model version is ready for certification, with version and tool mappings. Most precise — best for teams with reliable automation.",
    tag: "MOST PRECISE"
  }
];

export const INTEGRATION_PROVIDERS = [
  {
    name: "Braintrust",
    color: "#f472b6",
    signals: "Eval scores — accuracy, safety, tone, hallucination, relevance",
    note: "Braintrust eval runs are linked by version tag. Verdikt reads per-release quality scores and applies the floor + max regression check. Primary source for teams using eval pipelines."
  },
  {
    name: "LangSmith",
    color: "#34d399",
    signals: "LLM eval traces — quality, faithfulness, correctness",
    note: "LangSmith traces are matched by release version tag. Verdikt ingests eval scores per run and certifies against your defined AI thresholds."
  },
  {
    name: "Datadog",
    color: "#60a5fa",
    signals: "API latency (p95/p99), error rate under load, startup time",
    note: "Datadog deployment markers and APM metrics are read per version tag."
  },
  {
    name: "Sentry",
    color: "#fb923c",
    signals: "Crash rate, error rate, exception volume",
    note: "Sentry releases track version strings. Verdikt reads error metrics per release."
  }
];

export const ACCOUNT_ROLES = [
  {
    id: "ai_product_lead",
    label: "Product Lead",
    color: "var(--cyan)",
    desc: "Defines quality thresholds and certifies releases. Override authority is configurable per organisation."
  },
  {
    id: "ml_engineer",
    label: "ML / AI Engineer",
    color: "var(--green)",
    desc: "Submits model updates and prompt changes for certification. Views eval signals and certification status per release."
  },
  {
    id: "qe_lead",
    label: "QE Leader",
    color: "var(--accentL)",
    desc: "Certify releases, waive signals, manage Manual QA thresholds. Override authority is configurable per org."
  },
  {
    id: "vp_engineering",
    label: "VP Engineering",
    color: "var(--amber)",
    desc: "Can certify and approve overrides. Your name on record. Authority configurable per org."
  },
  {
    id: "cto",
    label: "CTO / Founder",
    color: "var(--pink)",
    desc: "Full access. Override authority at the highest level. Certification record is your defensible answer to investors and enterprise customers."
  },
  {
    id: "engineer",
    label: "Engineer",
    color: "var(--mid)",
    desc: "Read-only. View certification records and audit trail. Cannot add releases or approve overrides."
  }
];

export function createInitialOnboardingState() {
  return {
    step: 0,
    ws: { org: "", project: "", certEnvs: ["uat"], prodObservation: false },
    profile: "ai_web",
    user: { name: "", role: "qe_lead" },
    rtypes: ["prompt_update", "model_patch", "safety_patch"],
    thresh: { ...THRESHOLD_PRESETS.ai_web.thresholds },
    source: "integrations",
    trigger: {
      mode: "manual",
      env: "staging",
      label: "verdikt:rc"
    },
    rel: {
      version: "v1.0.0",
      rtype: "prompt_update",
      sigs: {
        smoke: { rate: 100, severity: "none" },
        e2e_regression: { rate: 97, severity: "P4" },
        startup: 2.4,
        screenload: 1.1,
        fps: 61,
        jserrors: 0.2,
        p95latency: 218,
        p99latency: 445,
        errorunderload: 0.4,
        recovery: 18,
        crashrate: 0.08,
        anrrate: 0.03,
        errorrate: 0.6,
        oomrate: 0.1,
        accuracy: 91,
        safety: 94,
        tone: 90,
        hallucination: 96,
        relevance: 85
      }
    },
    openCats: { tests: true, performance: false, stability: false, ai: false },
    email: "",
    password: "",
    password2: ""
  };
}
