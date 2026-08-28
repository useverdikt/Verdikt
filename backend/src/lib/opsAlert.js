"use strict";

const { log } = require("./observability");
const { sendResendToMany } = require("../services/email");

function parseOpsNotifyEmails() {
  return String(process.env.OPS_NOTIFY_EMAIL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Always logs. Emails OPS_NOTIFY_EMAIL when Resend is configured.
 * @returns {Promise<{ ok: true } | { skipped: true, reason: string } | { ok: false, error: string }>}
 */
async function notifyOps({ event, subject, text, fields = {} }) {
  log("error", event, fields);
  const to = parseOpsNotifyEmails();
  if (!to.length) {
    log("warn", "ops_alert_skipped", { reason: "no_ops_notify_email", event });
    return { skipped: true, reason: "no_ops_notify_email" };
  }
  const html = `<p>${escapeHtml(subject)}</p><pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
  const result = await sendResendToMany({ to, subject, text, html });
  if (result.skipped) {
    log("warn", "ops_alert_skipped", { reason: result.reason || "email_skipped", event });
    return result;
  }
  if (!result.ok) {
    log("error", "ops_alert_email_failed", { event, error: result.error });
  }
  return result;
}

module.exports = { notifyOps, parseOpsNotifyEmails };
