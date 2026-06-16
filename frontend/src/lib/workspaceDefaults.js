import shared from "../../../shared/config.json";

export const DEFAULT_THRESHOLDS = {
  ...shared.defaultThresholds,
  manual_qa_showstopper: "P0"
};

export const DEFAULT_AUDIT = [
  {
    id: 8,
    ts: "2026-02-28 09:01",
    event: "Release candidate created",
    release: "v2.14.0",
    actor: "UAT Pipeline",
    detail:
      "Prompt / UX update. Smoke: PASS. E2E regression required and passed. All signals collected from UAT build tag build/2847."
  },
  {
    id: 7,
    ts: "2026-02-14 11:32",
    event: "Release shipped",
    release: "v2.13.0",
    actor: "Jordan Blake",
    detail:
      "Model patch — regression waived. Isolated handler fix, no flow changes. All other signals passed. PROD deploy unblocked."
  },
  {
    id: 6,
    ts: "2026-02-14 10:45",
    event: "Regression waived",
    release: "v2.13.0",
    actor: "Jordan Blake, QE Lead",
    detail: "E2E regression not required for this bug fix. Reason on permanent record."
  },
  {
    id: 5,
    ts: "2026-01-31 16:55",
    event: "Override approved",
    release: "v2.12.0",
    actor: "Alex Baird, VP Engineering",
    detail:
      "AI accuracy 79% below 85% threshold. Model update — regression waived. Override documented and signed."
  },
  {
    id: 4,
    ts: "2026-01-31 15:22",
    event: "Verdict: UNCERTIFIED",
    release: "v2.12.0",
    actor: "Verdikt",
    detail: "2 signals below threshold: accuracy 79% (needs ≥85%), relevance 74% (needs ≥82%). Smoke passed."
  },
  {
    id: 3,
    ts: "2026-01-03 10:15",
    event: "Verdict: UNCERTIFIED",
    release: "v2.10.0",
    actor: "Verdikt",
    detail: "Hard gate failure: smoke FAIL. Startup 4.2s > 3.0s. Crash rate 0.18% > 0.1%."
  },
  {
    id: 2,
    ts: "2026-01-03 09:55",
    event: "Release candidate created",
    release: "v2.10.0",
    actor: "UAT Pipeline",
    detail: "Prompt / UX update. Signals collected from UAT build tag build/2801. E2E regression required."
  }
];
