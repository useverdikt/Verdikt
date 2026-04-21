"use strict";

/**
 * Logs one line per HTTP response (after `res.finish`). Disable with `LOG_REQUESTS=0`.
 * Set `LOG_JSON=1` for single-line JSON (log aggregators / structured logging).
 */
function setupRequestLogging(app) {
  if (process.env.LOG_REQUESTS === "0") return;

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const rid = req.requestId || "";
      const method = req.method || "";
      const path = req.path || req.url || "";
      const status = res.statusCode;
      if (process.env.LOG_JSON === "1") {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            requestId: rid,
            method,
            path,
            status,
            ms
          })
        );
      } else {
        console.log(`[${rid}] ${method} ${path} ${status} ${ms}ms`);
      }
    });
    next();
  });
}

module.exports = { setupRequestLogging };
