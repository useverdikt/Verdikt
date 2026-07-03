"use strict";

/** Acknowledge a GitHub webhook handler failure with HTTP 200 to avoid redelivery storms. */
function ackGitHubWebhookFailure(req, res, err) {
  console.error(`[${req.requestId}] github webhook handler error:`, err?.message || err);
  return res.status(200).json({ ok: false, error: "handler_failed" });
}

module.exports = { ackGitHubWebhookFailure };
