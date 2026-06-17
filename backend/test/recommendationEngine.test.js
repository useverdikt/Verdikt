"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildRecommendation } = require("../src/services/recommendationEngine");

const certifiedRelease = { status: "CERTIFIED", environment: "uat" };

describe("buildRecommendation confidence scoring", () => {
  it("returns HIGH confidence when signals are comfortably above thresholds", () => {
    const rec = buildRecommendation(certifiedRelease, {
      signals: {
        accuracy: 95,
        safety: 96,
        smoke: 100,
        e2e_regression: 100,
        manual_qa_pct: 99
      },
      thresholds: {
        accuracy: { min: 85 },
        safety: { min: 90 },
        smoke: { min: 100 },
        e2e_regression: { min: 90 },
        manual_qa_pct: { min: 90 }
      },
      failedSignals: [],
      missingRequiredSignals: [],
      failureModes: [],
      reliabilityMap: {}
    });
    assert.ok(rec.confidence_score >= 70, `expected HIGH band, got ${rec.confidence_score}`);
    assert.equal(rec.confidence_level, "HIGH");
    assert.equal(rec.recommended_verdict, "CERTIFIED");
  });

  it("does not zero out confidence when binary pass gates meet threshold exactly", () => {
    const rec = buildRecommendation(certifiedRelease, {
      signals: {
        smoke: 100,
        e2e_regression: 100,
        manual_qa_pct: 97,
        accuracy: 91,
        safety: 94,
        tone: 90,
        hallucination: 96,
        relevance: 85
      },
      thresholds: {
        smoke: { min: 100 },
        e2e_regression: { min: 95 },
        manual_qa_pct: { min: 95 },
        accuracy: { min: 85 },
        safety: { min: 90 },
        tone: { min: 85 },
        hallucination: { min: 90 },
        relevance: { min: 82 }
      },
      failedSignals: [],
      missingRequiredSignals: [],
      failureModes: [],
      reliabilityMap: {
        recovery: { grade: "C", on_time_rate: 0.5 },
        manual_qa_pct: { grade: "D", on_time_rate: 0.4 },
        accuracy: { grade: "C", on_time_rate: 0.55 }
      }
    });
    assert.equal(rec.recommended_verdict, "CERTIFIED_WITH_RISK");
    assert.ok(rec.confidence_score > 0, "should not clamp to 0 for borderline certified release");
    assert.ok(rec.confidence_score >= 38, `certified floor applies, got ${rec.confidence_score}`);
    assert.ok(rec.confidence_score < 70, "borderline signals should not read as HIGH");
  });

  it("UNCERTIFIED with reliable failures can reach LOW confidence", () => {
    const rec = buildRecommendation(
      { status: "UNCERTIFIED", environment: "uat" },
      {
        signals: { accuracy: 60, safety: 70 },
        thresholds: { accuracy: { min: 85 }, safety: { min: 90 } },
        failedSignals: [
          { signal_id: "accuracy", value: 60, rule: "below min 85" },
          { signal_id: "safety", value: 70, rule: "below min 90" }
        ],
        missingRequiredSignals: [],
        failureModes: [],
        reliabilityMap: { accuracy: { grade: "A", on_time_rate: 0.95 }, safety: { grade: "A", on_time_rate: 0.95 } }
      }
    );
    assert.equal(rec.recommended_verdict, "UNCERTIFIED");
    assert.ok(rec.confidence_score < 70);
  });
});
