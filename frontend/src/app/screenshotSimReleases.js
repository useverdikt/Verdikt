/**
 * Demo releases shaped to match product screenshots (release history + expanded row).
 * Loaded when localStorage has no `vdk3_releases` (local mode).
 */

/** Seeded backend login; workspace sync forces the screenshot gallery list (marketing / QA). */
export const SCREENSHOT_GALLERY_DEMO_EMAIL = "screenshots@verdikt.local";

const now = () => new Date().toISOString();

/** Full perf/stability baseline so categories evaluate deterministically */
function baseNonAi() {
  return {
    smoke: { rate: 100, severity: "none" },
    e2e_regression: { rate: 97, severity: "P4" },
    startup: 2.4,
    screenload: 1.1,
    fps: 61,
    jserrors: 0.2,
    p99latency: 445,
    errorunderload: 0.4,
    recovery: 18,
    crashrate: 0.08,
    anrrate: 0.03,
    errorrate: 0.6,
    oomrate: 0.1
  };
}

export const SCREENSHOT_SIM_RELEASES = [
  /* 1 — Prod · collecting (2 category “received”: tests + partial AI) */
  {
    id: "rc-sim-2.17.0",
    version: "v2.17.0 · Model update · GPT-4o-mini prompt v3",
    date: "2026-04-15",
    created_at: now(),
    status: "collecting",
    releaseType: "model_update",
    environment: "production",
    signals: {
      ...baseNonAi(),
      p95latency: 218,
      accuracy: 91.2,
      safety: 99.1
    }
  },

  /* 2 — Staging · UNCERTIFIED */
  {
    id: "rc-sim-2.16.2",
    version: "v2.16.2 · Prompt refactor · hallucination mitigation",
    date: "2026-04-15",
    created_at: "2026-04-15T11:46:00.000Z",
    status: "blocked",
    releaseType: "prompt_update",
    environment: "staging",
    intelligence: {
      verdict: {
        confidence_pct: 41,
        reasoning: [
          "2 required signals failed threshold. Hallucination rate materially above floor.",
          "Relevance regression correlates with v2.15.x failure pattern.",
          "Latency approaching breach — early warning issued.",
          "Signal reliability: hallucination B+, relevance A. Failures are not noise."
        ]
      }
    },
    signals: {
      ...baseNonAi(),
      p95latency: 834,
      accuracy: 88.4,
      safety: 97.8,
      tone: 88,
      hallucination: 14.2,
      relevance: 73.1
    }
  },

  /* 3 — Prod · WITH OVERRIDE · post-deploy CORRECT */
  {
    id: "rc-sim-2.16.0",
    version: "v2.16.0 · Model / Prompt update: accuracy improvement",
    date: "2026-04-13",
    created_at: "2026-04-13T10:00:00.000Z",
    status: "overridden",
    releaseType: "model_update",
    environment: "production",
    alignmentVerdict: "correct",
    overrideBy: "Alex Baird, Release Manager",
    overrideReason:
      "Hallucination only marginally over the floor (0.9%). Regression isolated to a single edge-case; patch scheduled within 48h. Risk accepted at VP Engineering level. ACCURACY_FLOOR breach noted — post-incident review completed 2026-01-19.",
    intelligence: {
      verdict: {
        confidence_pct: 68,
        reasoning: [
          "Hallucination breached threshold — override recorded with mitigation plan.",
          "All other AI signals green; production observation window closed with no incidents."
        ]
      },
      alignment: {
        summary:
          "No revert commits, hotfix branches, or incident PRs in 72hr window. Prediction validated. Confidence adjustment: +2pts."
      }
    },
    signals: {
      ...baseNonAi(),
      p95latency: 291,
      accuracy: 91.2,
      safety: 99.1,
      tone: 92,
      hallucination: 89.1,
      relevance: 83.4
    }
  },

  /* 4 — Prod · CERTIFIED · HIGH · CORRECT */
  {
    id: "rc-sim-2.15.4",
    version: "v2.15.4 · Bug fix · retrieval context window",
    date: "2026-04-11",
    created_at: "2026-04-11T09:00:00.000Z",
    status: "shipped",
    releaseType: "model_patch",
    environment: "production",
    alignmentVerdict: "correct",
    intelligence: {
      verdict: {
        confidence_pct: 91,
        reasoning: [
          "All 5 signals cleared threshold with margin.",
          "Hallucination rate improved vs prior release — trend positive.",
          "No early warnings. No correlated failure patterns matched.",
          "All signal reliability grades A or B. High confidence warranted."
        ]
      },
      alignment: {
        summary: "No incidents in 72hr window. Prediction validated. Confidence baseline holding."
      }
    },
    signals: {
      ...baseNonAi(),
      p95latency: 721,
      accuracy: 93.1,
      safety: 99.4,
      tone: 94,
      hallucination: 93.8,
      relevance: 87.9
    }
  },

  /* 5 — Prod · CERTIFIED · post-deploy MISS (learning loop) */
  {
    id: "rc-sim-2.15.1",
    version: "v2.15.1 · Feature · multi-turn context handling",
    date: "2026-04-11",
    created_at: "2026-04-11T08:30:00.000Z",
    status: "shipped",
    releaseType: "model_update",
    environment: "production",
    alignmentVerdict: "miss",
    intelligence: {
      verdict: {
        confidence_pct: 86,
        reasoning: [
          "All pre-release gates passed at certification time.",
          "Post-deploy: revert detected — production signal contradicted certification optimism."
        ]
      },
      alignment: {
        summary:
          "Revert commit detected 14hrs after deploy. Branch fix/multi-turn-context-regression. System certified; production problem followed. Confidence adjustment: -4pts.",
        teaches: [
          "Accuracy passed at 86.1% — 1.1% above floor. Threshold may be too low.",
          "Threshold advisor now suggests raising accuracy floor to 89%.",
          "Future signals near floor will carry lower confidence scores."
        ]
      }
    },
    signals: {
      ...baseNonAi(),
      p95latency: 292,
      accuracy: 86.1,
      safety: 96.2,
      tone: 90,
      hallucination: 92.5,
      relevance: 82.8
    }
  }
];
