"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatSchemaIssues,
  parseRequestBody
} = require("../src/lib/requestValidation");
const {
  overrideBodySchema,
  policyBodySchema,
  signalIngestBodySchema,
  thresholdsBodySchema
} = require("../src/schemas/governanceRequestSchemas");

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

describe("request body validation", () => {
  it("returns parsed data for a valid signal ingest body", () => {
    const req = {
      body: {
        source: "ci",
        signals: { accuracy: 91.5 },
        idempotency_key: "ingest-1"
      }
    };
    const res = mockResponse();

    const result = parseRequestBody(signalIngestBodySchema, req, res);

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, req.body);
    assert.equal(res.statusCode, null);
  });

  it("rejects array payload maps with the canonical API error contract", () => {
    const req = {
      requestId: "request-123",
      body: { signals: [91, 92] }
    };
    const res = mockResponse();

    const result = parseRequestBody(signalIngestBodySchema, req, res, {
      message: "signals object is required"
    });

    assert.equal(result.ok, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bad_request");
    assert.equal(res.body.message, "signals object is required");
    assert.equal(res.body.request_id, "request-123");
    assert.ok(res.body.details.issues.some((issue) => issue.path === "signals"));
  });

  it("rejects malformed threshold rules before database writes", () => {
    const result = thresholdsBodySchema.safeParse({
      thresholds: {
        accuracy: {
          min: "90",
          required_for_certification: "yes"
        }
      }
    });

    assert.equal(result.success, false);
    assert.deepEqual(
      formatSchemaIssues(result.error).map((issue) => issue.path).sort(),
      ["thresholds.accuracy.min", "thresholds.accuracy.required_for_certification"]
    );
  });

  it("rejects invalid policy enums instead of silently retaining old values", () => {
    const result = policyBodySchema.safeParse({
      gate_mode: "sometimes",
      calibration_mode: "automatic"
    });

    assert.equal(result.success, false);
    assert.deepEqual(
      formatSchemaIssues(result.error).map((issue) => issue.path).sort(),
      ["calibration_mode", "gate_mode"]
    );
  });

  it("prevents request bodies from spoofing override actor type", () => {
    const invalid = overrideBodySchema.safeParse({
      approver_type: "SYSTEM",
      justification: "Approved by a human",
      metadata: {}
    });
    const valid = overrideBodySchema.safeParse({
      approver_type: "PERSON",
      justification: "Approved by a human",
      metadata: {}
    });

    assert.equal(invalid.success, false);
    assert.equal(valid.success, true);
  });
});
