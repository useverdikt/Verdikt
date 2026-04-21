"use strict";

/**
 * overrideAnalytics.js
 * Computes and caches override pattern analytics for a workspace.
 */

const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

async function computeOverrideAnalytics(workspaceId) {
  const overrides = await queryAll(
    `
    SELECT oh.release_id, oh.approver_name, oh.approver_role, oh.approver_type,
           oh.justification, oh.metadata_json, oh.created_at,
           r.version, r.release_type, r.environment, r.status
    FROM override_history oh
    LEFT JOIN releases r ON r.id = oh.release_id
    WHERE r.workspace_id = ?
    ORDER BY oh.created_at DESC
  `,
    [workspaceId]
  );

  const total = overrides.length;

  const totalRow = await queryOne("SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ?", [workspaceId]);
  const totalReleases = Number(totalRow?.c ?? 0);
  const overrideRatePct = totalReleases > 0 ? Math.round((total / totalReleases) * 1000) / 10 : 0;

  const approverCounts = {};
  for (const ov of overrides) {
    const k = ov.approver_name || "unknown";
    if (!approverCounts[k]) approverCounts[k] = { name: k, role: ov.approver_role, count: 0 };
    approverCounts[k].count++;
  }
  const topApprovers = Object.values(approverCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const signalFailCounts = {};
  for (const row of overrides) {
    const sigAudit = await queryOne(
      `SELECT details_json FROM audit_events
      WHERE release_id = ? AND event_type = 'SIGNALS_INGESTED'
      ORDER BY id DESC LIMIT 1`,
      [row.release_id]
    );
    if (!sigAudit?.details_json) continue;
    try {
      const d = JSON.parse(sigAudit.details_json);
      const failed = d.failed_signals || d.threshold_failed_signals || [];
      for (const f of failed) {
        const sid = f.signal_id || f;
        signalFailCounts[sid] = (signalFailCounts[sid] || 0) + 1;
      }
    } catch (_) {}
  }
  const topSignals = Object.entries(signalFailCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([signal_id, count]) => ({ signal_id, count }));

  const riskDistribution = { STRONG: 0, ACCEPTABLE: 0, WEAK: 0 };
  for (const ov of overrides) {
    const grade = gradeJustification(ov.justification);
    riskDistribution[grade] = (riskDistribution[grade] || 0) + 1;
  }

  const trend = computeMonthlyTrend(overrides, 6);

  const byType = {};
  for (const ov of overrides) {
    const t = ov.release_type || "unknown";
    byType[t] = (byType[t] || 0) + 1;
  }

  const avgRepeatDays = computeAvgRepeatDays(workspaceId, overrides);

  const result = {
    workspace_id: workspaceId,
    computed_at: nowIso(),
    total_overrides: total,
    total_releases: totalReleases,
    override_rate_pct: overrideRatePct,
    top_approvers: topApprovers,
    top_signals: topSignals,
    risk_distribution: riskDistribution,
    trend,
    by_release_type: byType,
    avg_repeat_days: avgRepeatDays,
    recent: overrides.slice(0, 10).map((ov) => ({
      release_id: ov.release_id,
      version: ov.version,
      release_type: ov.release_type,
      approver: ov.approver_name,
      approver_role: ov.approver_role,
      created_at: ov.created_at,
      justification_grade: gradeJustification(ov.justification)
    }))
  };

  await run(
    `
    INSERT INTO override_analytics_cache
      (workspace_id, computed_at, total_overrides, override_rate_pct, top_approvers, top_signals, risk_distribution, trend_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      computed_at       = excluded.computed_at,
      total_overrides   = excluded.total_overrides,
      override_rate_pct = excluded.override_rate_pct,
      top_approvers     = excluded.top_approvers,
      top_signals       = excluded.top_signals,
      risk_distribution = excluded.risk_distribution,
      trend_json        = excluded.trend_json
  `,
    [
      workspaceId,
      result.computed_at,
      total,
      overrideRatePct,
      JSON.stringify(topApprovers),
      JSON.stringify(topSignals),
      JSON.stringify(riskDistribution),
      JSON.stringify(trend)
    ]
  );

  return result;
}

function gradeJustification(text) {
  if (!text) return "WEAK";
  const t = text.toLowerCase().trim();
  const len = t.length;
  const hasImpact = /user.?impact|no.?impact|low.?risk|isolated|affect|customer|session/.test(t);
  const hasMitigation = /monitor|revert|rollback|hotfix|fix|patch|committed|plan|next.?release|feature.?flag/.test(t);
  const hasEvidence = /v\d|\d+\s*%|signal|sentry|datadog|test|e2e|regression|ticket|issue|pr\s*#|\d{3,}/.test(t);
  const score = (hasImpact ? 1 : 0) + (hasMitigation ? 1 : 0) + (hasEvidence ? 1 : 0);
  if (len < 40 || score === 0) return "WEAK";
  if (score <= 1 || len < 100) return "ACCEPTABLE";
  return "STRONG";
}

function computeMonthlyTrend(overrides, months) {
  const trend = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const count = overrides.filter((ov) => {
      const created = new Date(ov.created_at);
      return created.getFullYear() === d.getFullYear() && created.getMonth() === d.getMonth();
    }).length;
    trend.push({ month: label, count });
  }
  return trend;
}

function computeAvgRepeatDays(_workspaceId, overrides) {
  if (overrides.length < 2) return null;
  const diffs = [];
  for (let i = 0; i < overrides.length - 1; i++) {
    const a = Date.parse(overrides[i].created_at);
    const b = Date.parse(overrides[i + 1].created_at);
    if (!isNaN(a) && !isNaN(b)) diffs.push(Math.abs(a - b) / (1000 * 60 * 60 * 24));
  }
  if (!diffs.length) return null;
  return Math.round((diffs.reduce((x, y) => x + y, 0) / diffs.length) * 10) / 10;
}

module.exports = { computeOverrideAnalytics, gradeJustification };
