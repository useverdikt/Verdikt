"use strict";

/**
 * slackNotifier.js
 *
 * Delivers verdict notifications to a workspace-configured Slack webhook URL.
 * Called from postVerdictEffects after every finalised verdict.
 *
 * Uses the Block Kit layout for readability: status header + signal summary +
 * link to the certification record. Requires `slack_webhook_url` to be set in
 * workspace_policies (column added in migration 022).
 *
 * Safe to call unconditionally — returns immediately when no URL is configured.
 */

const { getWorkspacePolicy } = require("./workspaceConfig");
const { validateOutboundWebhookUrl } = require("../lib/outboundUrl");
const { nowIso } = require("../lib/time");

const STATUS_EMOJI = {
  CERTIFIED: ":white_check_mark:",
  CERTIFIED_WITH_OVERRIDE: ":warning:",
  UNCERTIFIED: ":x:",
  COLLECTING: ":hourglass_flowing_sand:"
};

const STATUS_COLOR = {
  CERTIFIED: "#059669",
  CERTIFIED_WITH_OVERRIDE: "#d97706",
  UNCERTIFIED: "#dc2626",
  COLLECTING: "#6366f1"
};

/**
 * Build a Slack Block Kit message payload for a verdict.
 *
 * @param {object} release  – release row
 * @param {Array}  failedSignals
 * @param {object|null} certificationContext
 * @returns {object} Block Kit payload
 */
function buildSlackPayload(release, failedSignals = [], certificationContext = null) {
  const status = String(release.status || "").toUpperCase();
  const emoji = STATUS_EMOJI[status] || ":white_circle:";
  const color = STATUS_COLOR[status] || "#6b7280";
  const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  const isCert = certLike.has(status);

  const headerText = `${emoji} *${release.version}* — ${status.replace(/_/g, " ")}`;
  const contextLines = [
    `*Type:* ${release.release_type || "unknown"}`,
    release.environment ? `*Env:* ${release.environment}` : null,
    release.pr_number ? `*PR:* #${release.pr_number}` : null,
    `*Time:* ${(release.verdict_issued_at || nowIso()).slice(0, 16).replace("T", " ")} UTC`
  ].filter(Boolean).join("  ·  ");

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: headerText }
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: contextLines }]
    }
  ];

  if (isCert && certificationContext?.summary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Why it passed:* ${certificationContext.summary}`
      }
    });
    if (Array.isArray(certificationContext.required_signals_met) && certificationContext.required_signals_met.length) {
      const chips = certificationContext.required_signals_met.map((s) => `\`${s}\``).join("  ");
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `Required signals met: ${chips}` }]
      });
    }
  }

  if (!isCert && failedSignals.length > 0) {
    const failList = failedSignals
      .slice(0, 5)
      .map((f) => `• \`${f.signal_id}\``)
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Blocking signals:*\n${failList}${failedSignals.length > 5 ? `\n_…and ${failedSignals.length - 5} more_` : ""}`
      }
    });
  }

  blocks.push({ type: "divider" });

  return {
    attachments: [
      {
        color,
        blocks
      }
    ]
  };
}

/**
 * Deliver a verdict notification to the workspace's Slack webhook.
 * Resolves silently if no URL is configured or delivery fails.
 *
 * @param {object} release
 * @param {Array}  failedSignals
 * @param {object|null} certificationContext
 */
async function deliverSlackVerdict(release, failedSignals = [], certificationContext = null) {
  try {
    const policy = await getWorkspacePolicy(release.workspace_id);
    const rawUrl = policy?.slack_webhook_url;
    if (!rawUrl) return;

    let safeUrl;
    try {
      safeUrl = await validateOutboundWebhookUrl(rawUrl);
    } catch {
      console.error("[slack_notifier] invalid webhook URL for workspace:", release.workspace_id);
      return;
    }

    const payload = buildSlackPayload(release, failedSignals, certificationContext);
    const body = JSON.stringify(payload);

    const res = await fetch(safeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8_000)
    });

    if (!res.ok) {
      console.error("[slack_notifier] non-2xx response:", release.id, res.status);
    }
  } catch (err) {
    console.error("[slack_notifier] delivery failed:", release.id, err?.message);
  }
}

module.exports = { deliverSlackVerdict, buildSlackPayload };
