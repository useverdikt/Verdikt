"use strict";

/**
 * Deployment fact vs governance verdict.
 * environment reflects what is live; status reflects what was approved.
 */

const { queryOne, transaction } = require("../database");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");
const { refreshMonitoringWindowForProd } = require("./vcsMonitor");
const { deliverSlackBypassMerge } = require("./slackNotifier");
const { computeAndPersistRecommendation } = require("./recommendationEngine");
const { CERT_LIKE, isProdEnvironment, isCertLikeStatus } = require("../lib/releaseStatus");

/**
 * Promote release environment on VCS merge. Sets shipped_without_certification once when
 * merge lands on main/master while status is not cert-like (frozen at merge time).
 */
async function promoteReleaseOnMerge(release, { workspaceId, prNumber, baseBranch, newEnv, isMainBranch }) {
  const now = nowIso();
  const becomingProd = isMainBranch && isProdEnvironment(newEnv);

  // Promotion is one-way and happens once per merge: a redelivered merge event
  // for a release already in newEnv must not re-audit, re-flag a bypass from a
  // later status (e.g. revoked after a certified merge), or reset the window.
  const promotion = await transaction(async (tx) => {
    const locked = await tx.queryOne(
      "SELECT status, environment FROM releases WHERE id = $1 FOR UPDATE",
      [release.id]
    );
    if (!locked || locked.environment === newEnv) return null;

    const relStatus = String(locked.status || "").toUpperCase();
    const bypassAtMerge = becomingProd && !isCertLikeStatus(relStatus);
    const fresh = await tx.queryOne(
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
       WHERE id = $6
       RETURNING *`,
      [newEnv, now, bypassAtMerge ? 1 : 0, bypassAtMerge ? 1 : 0, now, release.id]
    );

    await writeAudit({
      workspaceId,
      releaseId: release.id,
      eventType: "RELEASE_ENV_PROMOTED",
      actorType: "SYSTEM",
      actorName: "github_merge",
      details: {
        pr_number: prNumber,
        base_branch: baseBranch,
        from_environment: locked.environment,
        to_environment: newEnv,
        release_status: relStatus,
        merged: true,
        shipped_without_certification: bypassAtMerge
      },
      tx
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
        },
        tx
      });
    }
    return { fresh, relStatus, bypassAtMerge };
  });

  if (!promotion) {
    const current = (await queryOne("SELECT * FROM releases WHERE id = $1", [release.id])) || release;
    return { promoted: false, already_promoted: true, shipped_without_certification: false, release: current };
  }

  const { fresh, relStatus, bypassAtMerge } = promotion;

  if (bypassAtMerge) {
    try {
      await computeAndPersistRecommendation(fresh);
    } catch (err) {
      console.error("[recommendation_engine] prod promotion refresh failed:", release.id, err?.message);
    }

    // Window anchors to prod merge time, not pre-merge cert time.
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
