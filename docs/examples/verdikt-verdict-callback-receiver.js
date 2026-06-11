#!/usr/bin/env node
"use strict";

/**
 * Minimal verdict callback receiver for local agent-loop testing.
 *
 *   node docs/examples/verdikt-verdict-callback-receiver.js
 *   # POST http://127.0.0.1:9099/verdikt-verdict
 *
 * Production: use HTTPS behind your agent runner. Verdikt blocks private URLs
 * when the API runs in production mode — expose via ngrok or deploy to staging.
 */

const http = require("http");

const PORT = Number(process.env.PORT || 9099);
const PATH = process.env.CALLBACK_PATH || "/verdikt-verdict";

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url?.split("?")[0] !== PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }

    console.log("[verdikt-callback]", new Date().toISOString());
    console.log(JSON.stringify(body, null, 2));

    const canMerge = body?.gate?.can_merge === true;
    const action = canMerge ? "merge" : body?.failed_signals?.length ? "self_heal_or_escalate" : "check_gate";
    console.log(`→ suggested: ${action} (status=${body.status}, can_merge=${canMerge})`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, received: body.event || "unknown" }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Verdikt verdict callback receiver: http://127.0.0.1:${PORT}${PATH}`);
  console.log("Use as callback_url when create_release (dev API allows http://127.0.0.1 only if API is non-prod).");
});
