"use strict";

/**
 * Rank 11 — systematic route auth audit.
 *
 * Static scan of Express route registrations: every authenticated mutating
 * control-plane route must include requireHumanSession. Agent/data-plane
 * mutations are allowlisted explicitly so new routes cannot silently skip the guard.
 */

const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadRouteTable, routeKey, extractRoutesFromSource } = require("./helpers/parseRouteTable");

const ROUTES_ROOT = path.join(__dirname, "..", "src", "routes");
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Authenticated mutations agents / integrations may call (data plane + auth bootstrap).
 * Add entries deliberately when introducing a new agent-safe mutator.
 */
const AGENT_ALLOWED_AUTHENTICATED_MUTATIONS = new Set([
  // Signal ingest / cert data plane
  "POST /api/releases/:releaseId/signals",
  "POST /api/releases/:releaseId/signals/integrations",
  "POST /api/releases/:releaseId/sources/pull",
  "POST /api/releases/:releaseId/production-signals",
  "POST /api/releases/:releaseId/intelligence/outcome",
  "POST /api/releases/:releaseId/escalate",
  "POST /api/releases/:releaseId/sse-token",
  "POST /api/releases/:releaseId/recommendation/compute",
  "POST /api/releases/:releaseId/vcs-monitor/scan",
  "POST /api/workspaces/:workspaceId/releases",
  // Readiness dry-run (no credential mutation)
  "POST /api/workspaces/:workspaceId/integration-readiness/probe",
  // Invite accept is a human session bootstrap (JWT), not governance mutation
  "POST /api/auth/accept-invite"
]);

/**
 * Explicit control-plane paths that must always carry requireHumanSession.
 * Guards against accidental allowlist expansion of high-risk mutators.
 */
const CONTROL_PLANE_MUST_REQUIRE_HUMAN = [
  "POST /api/releases/:releaseId/override",
  "POST /api/releases/:releaseId/intelligence/decision",
  "POST /api/releases/:releaseId/collection-deadline/extend",
  "POST /api/releases/:releaseId/production-signals/align",
  "PUT /api/releases/:releaseId/production-signals/incident",
  "POST /api/workspaces/:workspaceId/thresholds",
  "POST /api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/apply",
  "POST /api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/dismiss",
  "POST /api/workspaces/:workspaceId/thresholds/simulate",
  "POST /api/workspaces/:workspaceId/policies",
  "PUT /api/workspaces/:workspaceId/outbound-webhook",
  "DELETE /api/workspaces/:workspaceId/outbound-webhook",
  "PUT /api/workspaces/:workspaceId/signal-integrations/:sourceId",
  "DELETE /api/workspaces/:workspaceId/signal-integrations/:sourceId",
  "POST /api/workspaces/:workspaceId/signal-csv-imports",
  "DELETE /api/workspaces/:workspaceId/signal-csv-imports",
  "POST /api/workspaces/:workspaceId/signal-schema/validate",
  "POST /api/workspaces/:workspaceId/integration-requests",
  "PUT /api/workspaces/:workspaceId/vcs-integration",
  "DELETE /api/workspaces/:workspaceId/vcs-integration",
  "PUT /api/workspaces/:workspaceId/github-label-trigger",
  "DELETE /api/workspaces/:workspaceId/github-label-trigger",
  "POST /api/workspaces/:workspaceId/github-app/connect",
  "PUT /api/workspaces/:workspaceId/github-app/repos",
  "POST /api/workspaces/:workspaceId/api-keys",
  "DELETE /api/workspaces/:workspaceId/api-keys/:keyId",
  "POST /api/workspaces/:workspaceId/members/invite",
  "PATCH /api/workspaces/:workspaceId/members/:userId",
  "DELETE /api/workspaces/:workspaceId/members/:userId",
  "DELETE /api/workspaces/:workspaceId/members/invites/:inviteId",
  "POST /api/workspaces/:workspaceId/escalations/:escalationId/acknowledge",
  "POST /api/workspaces/:workspaceId/escalations/:escalationId/acknowledge-and-override",
  "POST /api/workspaces/:workspaceId/signal-definitions",
  "POST /api/workspaces/:workspaceId/signal-definitions/adopt",
  "DELETE /api/workspaces/:workspaceId/signal-definitions/:signalId",
  "POST /api/workspaces/:workspaceId/correlations/compute",
  "POST /api/workspaces/:workspaceId/signal-reliability/compute",
  "POST /api/workspaces/:workspaceId/recommendations/backfill"
];

describe("route auth audit (static)", () => {
  const routes = loadRouteTable(ROUTES_ROOT);
  const byKey = new Map(routes.map((r) => [routeKey(r), r]));

  it("loads a non-empty route table from src/routes", () => {
    assert.ok(routes.length > 40, `expected many routes, got ${routes.length}`);
  });

  it("parses multi-line middleware stacks (collection-deadline/extend)", () => {
    const sample = `
app.post(
  "/api/releases/:releaseId/collection-deadline/extend",
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  async (req, res, next) => {}
);
`;
    const parsed = extractRoutesFromSource(sample, "sample.js");
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].hasAuth, true);
    assert.equal(parsed[0].hasHumanSession, true);
  });

  it("every CONTROL_PLANE_MUST_REQUIRE_HUMAN route exists and has requireHumanSession", () => {
    const missing = [];
    const unguarded = [];
    for (const key of CONTROL_PLANE_MUST_REQUIRE_HUMAN) {
      const route = byKey.get(key);
      if (!route) {
        missing.push(key);
        continue;
      }
      if (!route.hasAuth || !route.hasHumanSession) {
        unguarded.push(`${key} (file=${route.file}, mw=${route.middlewareText})`);
      }
    }
    assert.deepEqual(missing, [], `control-plane routes missing from table:\n${missing.join("\n")}`);
    assert.deepEqual(unguarded, [], `control-plane routes missing requireHumanSession:\n${unguarded.join("\n")}`);
  });

  it("authenticated mutating routes are either human-gated or explicitly agent-allowlisted", () => {
    const offenders = [];
    const staleAllowlist = [];

    for (const key of AGENT_ALLOWED_AUTHENTICATED_MUTATIONS) {
      if (!byKey.has(key)) staleAllowlist.push(key);
    }
    assert.deepEqual(
      staleAllowlist,
      [],
      `stale AGENT_ALLOWED entries (route not found):\n${staleAllowlist.join("\n")}`
    );

    for (const route of routes) {
      if (!MUTATING.has(route.method) || !route.hasAuth) continue;
      const key = routeKey(route);
      if (route.hasHumanSession) continue;
      if (AGENT_ALLOWED_AUTHENTICATED_MUTATIONS.has(key)) continue;
      offenders.push(`${key} (${route.file}) mw=${route.middlewareText}`);
    }

    assert.deepEqual(
      offenders,
      [],
      `authenticated mutations missing requireHumanSession (add guard or allowlist):\n${offenders.join("\n")}`
    );
  });

  it("agent allowlist does not include CONTROL_PLANE_MUST_REQUIRE_HUMAN paths", () => {
    const overlap = CONTROL_PLANE_MUST_REQUIRE_HUMAN.filter((k) =>
      AGENT_ALLOWED_AUTHENTICATED_MUTATIONS.has(k)
    );
    assert.deepEqual(overlap, [], `allowlist must not include control-plane paths:\n${overlap.join("\n")}`);
  });
});
