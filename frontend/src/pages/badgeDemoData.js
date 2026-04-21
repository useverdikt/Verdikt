/**
 * Demo certification records for /badge (ported from verdikt-badge.html).
 * Share a state: `/badge?state=certified|uncertified|override`. Live tenant
 * records are not exposed on this public route — see backend README “MVP product surface”.
 */

export const DEMOS = {
  certified: {
    state: "certified",
    version: "v2.14.0",
    project: "Verdikt · Discover AI",
    env: "UAT",
    releaseType: "✦ Prompt / UX Update",
    certifiedBy: "Jordan Blake, AI Product Lead",
    date: "2026-02-28",
    time: "09:14 UTC",
    failing: [],
    override: null,
    waiver: { reason: null },
    signals: {
      tests: [
        { name: "Smoke tests", status: "pass", val: "PASS", thresh: "PASS required", hg: true },
        { name: "E2E regression", status: "pass", val: "PASS", thresh: "PASS required" }
      ],
      performance: [
        { name: "Cold startup", status: "pass", val: "2.4s", thresh: "≤3.0s" },
        { name: "Screen load", status: "pass", val: "1.1s", thresh: "≤1.5s" },
        { name: "Frame rate", status: "pass", val: "61fps", thresh: "≥58fps" },
        { name: "JS error rate", status: "pass", val: "0.2%", thresh: "≤0.5%" },
        { name: "API p95", status: "pass", val: "218ms", thresh: "≤300ms" },
        { name: "API p99", status: "pass", val: "445ms", thresh: "≤600ms" },
        { name: "Error under load", status: "pass", val: "0.4%", thresh: "≤1.0%" },
        { name: "Stress recovery", status: "pass", val: "18s", thresh: "≤30s" }
      ],
      stability: [
        { name: "Crash rate", status: "pass", val: "0.08%", thresh: "≤0.1%" },
        { name: "ANR rate", status: "pass", val: "0.03%", thresh: "≤0.05%" },
        { name: "API error rate", status: "pass", val: "0.6%", thresh: "≤1.0%" },
        { name: "OOM rate", status: "pass", val: "0.1%", thresh: "≤0.2%" }
      ],
      ai: [
        { name: "Accuracy", status: "pass", val: "91%", thresh: "≥85%" },
        { name: "Safety", status: "pass", val: "94%", thresh: "≥90%" },
        { name: "Tone", status: "pass", val: "90%", thresh: "≥85%" },
        { name: "Hallucination", status: "pass", val: "96%", thresh: "≥90%" },
        { name: "Relevance", status: "pass", val: "85%", thresh: "≥82%" }
      ]
    }
  },

  uncertified: {
    state: "uncertified",
    version: "v2.10.0",
    project: "Verdikt · Discover AI",
    env: "UAT",
    releaseType: "✦ Prompt / UX Update",
    certifiedBy: null,
    date: "2026-01-03",
    time: "10:15 UTC",
    failing: [
      { cat: "Delivery Reliability Checks", name: "Smoke tests", val: "FAIL", thresh: "PASS required", hg: true },
      { cat: "Delivery Reliability Checks", name: "E2E regression", val: "FAIL", thresh: "PASS required" },
      { cat: "Performance", name: "Cold startup", val: "4.2s", thresh: "≤3.0s" },
      { cat: "Delivery Reliability", name: "Crash rate", val: "0.18%", thresh: "≤0.1%" },
      { cat: "AI Eval", name: "Accuracy", val: "71%", thresh: "≥85%" }
    ],
    override: null,
    waiver: { reason: null },
    signals: {
      tests: [
        { name: "Smoke tests", status: "fail", val: "FAIL", thresh: "PASS required", hg: true },
        { name: "E2E regression", status: "fail", val: "FAIL", thresh: "PASS required" }
      ],
      performance: [
        { name: "Cold startup", status: "fail", val: "4.2s", thresh: "≤3.0s" },
        { name: "Screen load", status: "fail", val: "2.1s", thresh: "≤1.5s" },
        { name: "Frame rate", status: "fail", val: "54fps", thresh: "≥58fps" },
        { name: "JS error rate", status: "fail", val: "1.2%", thresh: "≤0.5%" },
        { name: "API p95", status: "fail", val: "412ms", thresh: "≤300ms" },
        { name: "API p99", status: "fail", val: "890ms", thresh: "≤600ms" },
        { name: "Error under load", status: "fail", val: "2.4%", thresh: "≤1.0%" },
        { name: "Stress recovery", status: "fail", val: "55s", thresh: "≤30s" }
      ],
      stability: [
        { name: "Crash rate", status: "fail", val: "0.18%", thresh: "≤0.1%" },
        { name: "ANR rate", status: "fail", val: "0.09%", thresh: "≤0.05%" },
        { name: "API error rate", status: "fail", val: "2.1%", thresh: "≤1.0%" },
        { name: "OOM rate", status: "fail", val: "0.4%", thresh: "≤0.2%" }
      ],
      ai: [
        { name: "Accuracy", status: "fail", val: "71%", thresh: "≥85%" },
        { name: "Safety", status: "pass", val: "89%", thresh: "≥90%" },
        { name: "Tone", status: "pass", val: "85%", thresh: "≥85%" },
        { name: "Hallucination", status: "pass", val: "91%", thresh: "≥90%" },
        { name: "Relevance", status: "fail", val: "68%", thresh: "≥82%" }
      ]
    }
  },

  override: {
    state: "override",
    version: "v2.12.0",
    project: "Verdikt · Discover AI",
    env: "STAGING",
    releaseType: "◐ Model / Prompt Update",
    certifiedBy: "Alex Baird, VP Engineering",
    date: "2026-01-31",
    time: "16:55 UTC",
    failing: [
      { cat: "AI Eval", name: "Accuracy", val: "79%", thresh: "≥85%" },
      { cat: "AI Eval", name: "Relevance", val: "74%", thresh: "≥82%" }
    ],
    override: {
      owner: "Alex Baird",
      title: "VP Engineering",
      reason:
        "Accuracy regression isolated to edge case in legacy profile format. Affects <0.3% of users. Model patch scheduled within 48 hrs. Risk accepted at VP Engineering level.",
      ts: "2026-01-31 16:55 UTC"
    },
    waiver: {
      reason:
        "Model / Prompt Update — AI eval suite covers regression surface. E2E regression not warranted for prompt-only changes.",
      waivedBy: "Alex Baird, VP Engineering"
    },
    signals: {
      tests: [
        { name: "Smoke tests", status: "pass", val: "PASS", thresh: "PASS required", hg: true },
        { name: "E2E regression", status: "waived", val: "WAIVED", thresh: "Waivable for this release type" }
      ],
      performance: [
        { name: "Cold startup", status: "pass", val: "2.8s", thresh: "≤3.0s" },
        { name: "Screen load", status: "pass", val: "1.4s", thresh: "≤1.5s" },
        { name: "Frame rate", status: "pass", val: "59fps", thresh: "≥58fps" },
        { name: "JS error rate", status: "pass", val: "0.4%", thresh: "≤0.5%" },
        { name: "API p95", status: "pass", val: "267ms", thresh: "≤300ms" },
        { name: "API p99", status: "pass", val: "512ms", thresh: "≤600ms" },
        { name: "Error under load", status: "pass", val: "0.8%", thresh: "≤1.0%" },
        { name: "Stress recovery", status: "pass", val: "26s", thresh: "≤30s" }
      ],
      stability: [
        { name: "Crash rate", status: "pass", val: "0.11%", thresh: "≤0.1%" },
        { name: "ANR rate", status: "pass", val: "0.04%", thresh: "≤0.05%" },
        { name: "API error rate", status: "pass", val: "0.9%", thresh: "≤1.0%" },
        { name: "OOM rate", status: "pass", val: "0.18%", thresh: "≤0.2%" }
      ],
      ai: [
        { name: "Accuracy", status: "fail", val: "79%", thresh: "≥85%" },
        { name: "Safety", status: "pass", val: "91%", thresh: "≥90%" },
        { name: "Tone", status: "pass", val: "88%", thresh: "≥85%" },
        { name: "Hallucination", status: "pass", val: "93%", thresh: "≥90%" },
        { name: "Relevance", status: "fail", val: "74%", thresh: "≥82%" }
      ]
    }
  }
};

export const CATS = [
  { id: "tests", label: "Delivery Reliability Checks", icon: "✦", color: "#0891b2" },
  { id: "performance", label: "Delivery Performance", icon: "◎", color: "#3b82f6" },
  { id: "stability", label: "Delivery Reliability", icon: "◈", color: "#059669" },
  { id: "ai", label: "AI Eval Quality", icon: "◐", color: "#db2777" }
];

export const STATE_META = {
  certified: {
    label: "CERTIFIED",
    icon: "⊕",
    stampClass: "stamp-certified",
    heroBg: "rec-hero-bg-certified",
    btnActive: "active-certified"
  },
  uncertified: {
    label: "UNCERTIFIED",
    icon: "⊗",
    stampClass: "stamp-uncertified",
    heroBg: "rec-hero-bg-uncertified",
    btnActive: "active-uncertified"
  },
  override: {
    label: "CERTIFIED\nWITH OVERRIDE",
    icon: "◈",
    stampClass: "stamp-override",
    heroBg: "rec-hero-bg-override",
    btnActive: "active-override"
  }
};

export const DEMO_KEYS = ["certified", "uncertified", "override"];
