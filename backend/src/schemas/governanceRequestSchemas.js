"use strict";

const { z } = require("zod");

const stringRecord = z.record(z.string(), z.unknown());
const finiteNumberOrNull = z.union([z.number().finite(), z.null()]);
const booleanOrBit = z.union([z.boolean(), z.literal(0), z.literal(1)]);
const finiteNumberish = z.union([
  z.number().finite(),
  z.string().refine(
    (value) => value.trim() !== "" && Number.isFinite(Number(value)),
    "must be a finite number"
  )
]);

const signalIngestBodySchema = z
  .object({
    source: z.string().optional(),
    signals: stringRecord,
    idempotency_key: z.string().optional()
  })
  .passthrough();

const thresholdRuleSchema = z
  .object({
    min: finiteNumberOrNull.optional(),
    max: finiteNumberOrNull.optional(),
    required_for_certification: booleanOrBit.optional()
  })
  .passthrough();

const thresholdsBodySchema = z
  .object({
    thresholds: z.record(z.string().min(1), thresholdRuleSchema)
  })
  .passthrough();

const policyBodySchema = z
  .object({
    require_ai_eval: z.boolean().optional(),
    ai_missing_policy: z.enum(["block_uncertified", "allow_without_ai"]).optional(),
    gate_mode: z.enum(["strict", "default"]).optional(),
    escalation_notify_email: z.union([z.string(), z.null()]).optional(),
    escalation_sla_hours: finiteNumberish.optional(),
    public_cert_records: z.boolean().optional(),
    show_signal_detail: z.boolean().optional(),
    show_override_justification: z.boolean().optional(),
    slack_webhook_url: z.union([z.string(), z.null()]).optional(),
    calibration_mode: z.enum(["auto_apply", "suggest_only"]).optional(),
    public_slug: z.union([z.string(), z.null()]).optional(),
    public_display_name: z.union([z.string(), z.null()]).optional()
  })
  .passthrough();

const overrideBodySchema = z
  .object({
    approver_type: z.literal("PERSON").optional(),
    justification: z.string().optional(),
    metadata: stringRecord.optional()
  })
  .passthrough();

module.exports = {
  overrideBodySchema,
  policyBodySchema,
  signalIngestBodySchema,
  thresholdsBodySchema
};
