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
        thresholds: {
          accuracy: { min: 85, required: true },
          safety: { min: 90, required: true }
        },
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
    assert.equal(rec.confidence_score, 0);
    assert.equal(rec.confidence_level, "LOW");
  });

  it("single hard-gate failure does not zero confidence when other gates pass", () => {
    const rec = buildRecommendation(
      { status: "UNCERTIFIED", environment: "pre-prod" },
      {
        signals: {
          anrrate: 0.51,
          manual_qa_pct: 97,
          fps: 61,
          accuracy: 88,
          safety: 94,
          tone: 90,
          hallucination: 96,
          relevance: 85,
          smoke: 100,
          e2e_regression: 100
        },
        thresholds: {
          anrrate: { min: 0.05, max: null, required: true },
          manual_qa_pct: { min: 95, required: true },
          fps: { min: 58, required: true },
          accuracy: { min: 85, required: true },
          safety: { min: 90, required: true },
          tone: { min: 85, required: true },
          hallucination: { min: 90, required: true },
          relevance: { min: 82, required: true },
          smoke: { min: 100, required: true },
          e2e_regression: { min: 95, required: true }
        },
        failedSignals: [{ signal_id: "anrrate", value: 0.51, rule: "above max 0.05" }],
        missingRequiredSignals: [],
        failureModes: [],
        reliabilityMap: {
          manual_qa_pct: { grade: "B", on_time_rate: 0.78 },
          accuracy: { grade: "B", on_time_rate: 0.78 }
        }
      }
    );
    assert.equal(rec.recommended_verdict, "UNCERTIFIED");
    assert.ok(rec.confidence_score > 0, "one hard-gate miss should not read as 0%");
    assert.ok(rec.confidence_score >= 40, `expected MEDIUM+ gate health, got ${rec.confidence_score}`);
    assert.ok(rec.at_risk_signals.length > 0, "proximity still surfaces in reasoning");
  });

  it("single non-required failure uses evaluated signal ratio when no hard gates flagged", () => {
    const rec = buildRecommendation(
      { status: "UNCERTIFIED", environment: "pre-prod" },
      {
        signals: { anrrate: 0.51, accuracy: 88, safety: 94 },
        thresholds: {
          anrrate: { min: 0.05, max: null, required: false },
          accuracy: { min: 85, required: false },
          safety: { min: 90, required: false }
        },
        failedSignals: [{ signal_id: "anrrate", value: 0.51, rule: "above max 0.05" }],
        missingRequiredSignals: [],
        failureModes: [],
        reliabilityMap: {}
      }
    );
    assert.ok(rec.confidence_score > 0);
    assert.ok(rec.confidence_score < 100);
  });

  it("all hard gates failed yields 0% gate-health confidence", () => {
    const rec = buildRecommendation(
      { status: "UNCERTIFIED", environment: "uat" },
      {
        signals: { accuracy: 60, safety: 70, tone: 50 },
        thresholds: {
          accuracy: { min: 85, required: true },
          safety: { min: 90, required: true },
          tone: { min: 85, required: true }
        },
        failedSignals: [
          { signal_id: "accuracy", value: 60, rule: "below min 85" },
          { signal_id: "safety", value: 70, rule: "below min 90" },
          { signal_id: "tone", value: 50, rule: "below min 85" }
        ],
        missingRequiredSignals: [],
        failureModes: [],
        reliabilityMap: {}
      }
    );
    assert.equal(rec.confidence_score, 0);
    assert.equal(rec.confidence_level, "LOW");
  });
});
