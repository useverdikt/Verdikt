"use strict";

/**
 * Deployment fact vs governance verdict.
 * environment reflects what is live; status reflects what was approved.
 */

const { run, queryOne } = require("../database");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");
const { refreshMonitoringWindowForProd } = require("./vcsMonitor");
const { deliverSlackBypassMerge } = require("./slackNotifier");
const { computeAndPersistRecommendation } = require("./recommendationEngine");

const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

function isProdEnvironment(env) {
  return String(env || "").toLowerCase() === "prod";
}

function isCertLikeStatus(status) {
  return CERT_LIKE.has(String(status || "").toUpperCase());
}

/**
 * Promote release environment on VCS merge. Sets shipped_without_certification once when
 * merge lands on main/master while status is not cert-like (frozen at merge time).
 */
async function promoteReleaseOnMerge(release, { workspaceId, prNumber, baseBranch, newEnv, isMainBranch }) {
  const relStatus = String(release.status || "").toUpperCase();
  const now = nowIso();
  const becomingProd = isMainBranch && isProdEnvironment(newEnv);
  const bypassAtMerge = becomingProd && !isCertLikeStatus(relStatus);

  await run(
    `UPDATE releases
     SET environment = $1,
         updated_at = $2,
         shipped_without_certification = CASE
           WHEN $3 = 1 AND shipped_without_certification = 0 THEN 1
           ELSE shipped_without_certification
         END,
         shipped_without_certification_at = CASE
           WHEN $4 = 1 AND shipped_without_certification_at IS NULL THEN $5
           ELSE shipped_without_certification_at
         END
     WHERE id = $6`,
    [newEnv, now, bypassAtMerge ? 1 : 0, bypassAtMerge ? 1 : 0, now, release.id]
  );

  const fresh = (await queryOne("SELECT * FROM releases WHERE id = $1", [release.id])) || release;

  if (becomingProd && !isCertLikeStatus(relStatus)) {
    try {
      await computeAndPersistRecommendation(fresh);
    } catch (err) {
      console.error("[recommendation_engine] prod promotion refresh failed:", release.id, err?.message);
    }
  }

  await writeAudit({
    workspaceId,
    releaseId: release.id,
    eventType: "RELEASE_ENV_PROMOTED",
    actorType: "SYSTEM",
    actorName: "github_merge",
    details: {
      pr_number: prNumber,
      base_branch: baseBranch,
      from_environment: release.environment,
      to_environment: newEnv,
      release_status: relStatus,
      merged: true,
      shipped_without_certification: bypassAtMerge
    }
  });

  if (bypassAtMerge) {
    await writeAudit({
      workspaceId,
      releaseId: release.id,
      eventType: "RELEASE_SHIPPED_WITHOUT_CERTIFICATION",
      actorType: "SYSTEM",
      actorName: "github_merge",
      details: {
        pr_number: prNumber,
        base_branch: baseBranch,
        release_status: relStatus,
        environment: newEnv,
        shipped_without_certification_at: fresh.shipped_without_certification_at || now,
        message: "Code merged to main while governance status was not cert-like."
      }
    });

    // Idempotent refresh: window anchors to prod merge time, not pre-merge cert time.
    await refreshMonitoringWindowForProd(fresh, 120);

    void deliverSlackBypassMerge(fresh, relStatus).catch((err) =>
      console.error("[slack_notifier] bypass merge alert failed:", release.id, err?.message)
    );
  } else if (becomingProd) {
    await refreshMonitoringWindowForProd(fresh, 120);
  }

  return {
    promoted: true,
    shipped_without_certification: bypassAtMerge,
    release: fresh
  };
}

async function countShippedWithoutCertification(workspaceId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM releases WHERE workspace_id = $1 AND shipped_without_certification = 1`,
    [workspaceId]
  );
  return Number(row?.c ?? 0);
}

module.exports = {
  CERT_LIKE,
  isProdEnvironment,
  isCertLikeStatus,
  promoteReleaseOnMerge,
  countShippedWithoutCertification
};
