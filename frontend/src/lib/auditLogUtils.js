/**
 * auditLogUtils.js
 *
 * Pure formatting helpers for workspace audit log events.
 * Extracted from appMainLogic.js — no React, no side-effects.
 */

export const formatAuditTsFromIso = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 16).replace("T", " ");
  return d.toISOString().slice(0, 16).replace("T", " ");
};

export const humanizeAuditEventType = (t) => {
  if (!t) return "";
  return String(t).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const auditDetailsToDetailString = (details) => {
  if (!details || typeof details !== "object") return "";
  if (typeof details.from_status === "string" && typeof details.to_status === "string" && typeof details.summary === "string") {
    return details.summary;
  }
  if (typeof details.note === "string") return details.note;
  if (typeof details.message === "string") return details.message;
  if (typeof details.summary === "string") return details.summary;
  if (typeof details.justification === "string" && details.justification.length < 400) return details.justification;
  try {
    const s = JSON.stringify(details);
    return s.length > 280 ? s.slice(0, 277) + "…" : s;
  } catch {
    return "";
  }
};

export const mapWorkspaceAuditEventsToLog = (events) => {
  if (!Array.isArray(events)) return [];
  return events.map((e, idx) => {
    let details = e.details;
    if ((!details || typeof details !== "object") && typeof e.details_json === "string") {
      try {
        details = JSON.parse(e.details_json || "{}");
      } catch {
        details = {};
      }
    }
    if (!details || typeof details !== "object") details = {};
    const releaseRef = typeof details.release_ref === "string" ? details.release_ref : null;
    const version = typeof details.version === "string" ? details.version : null;
    const rid = e.release_id || null;
    return {
      id: e.id != null ? `srv-${e.id}` : `srv-${idx}-${e.created_at || idx}`,
      ts: formatAuditTsFromIso(e.created_at),
      event: humanizeAuditEventType(e.event_type),
      _rawEventType: e.event_type,
      release: version || releaseRef || (rid ? `Release …${String(rid).slice(-6)}` : "—"),
      backendReleaseId: rid,
      actor: e.actor_name || e.actor_type || "System",
      detail: auditDetailsToDetailString(details)
    };
  });
};
