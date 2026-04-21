import React from "react";
import { formatCertTiersShort } from "../../lib/projectEnv.js";
import { C } from "../../theme/tokens.js";
import { VerdiktMark } from "../brand/VerdiktMark.jsx";
import SidebarFooter from "./SidebarFooter.jsx";

/* ─── Exact SVG icons from verdikt-dashboard.html ───────────────────────── */
function NavIcon({ id }) {
  const map = {
    release: (
      <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
        <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    ),
    trend: (
      <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
    thresholds: (
      <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
        <path d="M7 1L9.5 5.5H13L9.75 8.5L11 13L7 10.5L3 13L4.25 8.5L1 5.5H4.5L7 1Z"
          stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    ),
    audit: (
      <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
        <path d="M2 10h10M2 7h7M2 4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
    intelligence: (
      <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
    settings: (
      <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
        <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13"
          stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  };
  return map[id] ?? null;
}

/* ─── Chevron for workspace selector ────────────────────────────────────── */
function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ color: "#384d60", flexShrink: 0, marginLeft: 8 }}>
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.2"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ─── Single nav button ──────────────────────────────────────────────────── */
function NavBtn({ id, label, active, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`vdk-nav-item${active ? " vdk-nav-active" : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px",
        borderRadius: 6,
        fontSize: 13,
        color: active ? "#c4d4e8" : "#6e87a2",
        background: active ? "#111a28" : "transparent",
        border: active ? "1px solid #18243a" : "1px solid transparent",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        marginBottom: 1,
        fontFamily: C.sans,
        fontWeight: active ? 500 : 400,
        transition: "background .15s, color .15s",
      }}
    >
      <span
        className="vdk-nav-icon"
        style={{
          width: 14, height: 14, flexShrink: 0,
          opacity: active ? 1 : 0.45,
          transition: "opacity .15s",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <NavIcon id={id} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          marginLeft: "auto",
          fontFamily: C.mono,
          fontSize: 9,
          fontWeight: 500,
          padding: "2px 6px",
          borderRadius: 3,
          background: "rgba(239,68,68,.10)",
          color: "#ef4444",
        }}>{badge}</span>
      )}
    </button>
  );
}

/* ─── Section label ─────────────────────────────────────────────────────── */
function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: C.mono,
      fontSize: 9,
      fontWeight: 500,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "#384d60",
      padding: "14px 6px 8px",
    }}>
      {children}
    </div>
  );
}

/* ─── Release candidate list — REMOVED (not in HTML reference) ────────────── */
// eslint-disable-next-line no-unused-vars
function ReleaseCandidateSection_unused({
  sidebarReleaseGroups,
  collapsedSidebarDayKeys,
  setCollapsedSidebarDayKeys,
  selectedId,
  setSelectedId,
  formatReleaseDisplayName,
  showReevalConfirm,
  setShowReevalConfirm,
  reEvaluating,
  handleConfirmReevaluation,
  setShowStartCert,
  currentUser,
  canAct,
}) {
  return (
    <>
      {/* Release list */}
      <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
        <div style={{
          fontFamily: C.mono, fontSize: 9, fontWeight: 500,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: "#384d60", padding: "10px 10px 6px",
        }}>
          Release Candidates
        </div>
        {sidebarReleaseGroups.map((group) => {
          const collapsed = collapsedSidebarDayKeys.has(group.dayKey);
          const hasSelectionHere = group.releases.some((r) => r.id === selectedId);
          const dayListId = `sb-day-${String(group.dayKey).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
          return (
            <div key={group.dayKey}>
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-controls={dayListId}
                className="vdk-sb-day-header"
                onClick={() =>
                  setCollapsedSidebarDayKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.dayKey)) next.delete(group.dayKey);
                    else next.add(group.dayKey);
                    return next;
                  })
                }
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "5px 10px",
                  border: "none", background: "transparent", cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{
                  fontSize: 11, fontFamily: C.mono,
                  color: hasSelectionHere ? "#c4d4e8" : "#6e87a2",
                  fontWeight: 500,
                }}>
                  {group.label}
                </span>
                <span style={{
                  fontSize: 9, fontFamily: C.mono,
                  color: hasSelectionHere ? "#22c55e" : "#384d60",
                  background: hasSelectionHere ? "rgba(34,197,94,.10)" : "#0d1520",
                  border: `1px solid ${hasSelectionHere ? "rgba(34,197,94,.26)" : "#18243a"}`,
                  padding: "1px 6px", borderRadius: 10,
                }}>
                  {hasSelectionHere ? "active" : group.releases.length}
                </span>
              </button>
              {!collapsed && (
                <div id={dayListId} role="group" aria-label={`${group.label} releases`}>
                  {group.releases.map((r) => {
                    const active = r.id === selectedId;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        aria-current={active ? "true" : undefined}
                        className={`vdk-sb-release${active ? " vdk-sb-release-active" : ""}`}
                        style={{
                          width: "100%", border: "none",
                          background: active ? "rgba(59,130,246,.12)" : "transparent",
                          color: active ? "#c4d4e8" : "#6e87a2",
                          fontFamily: C.mono, fontSize: 11,
                          textAlign: "left", padding: "5px 22px",
                          cursor: "pointer", lineHeight: 1.4,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {formatReleaseDisplayName(r.version)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      {canAct(currentUser) && (
        <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${C.border}` }}>
          {showReevalConfirm ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, color: "#f59e0b", textAlign: "center", fontFamily: C.mono, letterSpacing: "0.03em" }}>
                Force verdict on current signals?
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button
                  type="button"
                  onClick={handleConfirmReevaluation}
                  disabled={reEvaluating}
                  className="vdk-sb-btn"
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 6,
                    border: "1px solid rgba(245,158,11,.26)",
                    background: "rgba(245,158,11,.10)",
                    color: reEvaluating ? "#384d60" : "#f59e0b",
                    fontSize: 11, fontWeight: 600, cursor: reEvaluating ? "not-allowed" : "pointer",
                    fontFamily: C.mono, opacity: reEvaluating ? 0.7 : 1,
                  }}
                >
                  {reEvaluating ? "Running…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReevalConfirm(false)}
                  disabled={reEvaluating}
                  className="vdk-sb-btn"
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 6,
                    border: `1px solid #243050`, background: "#0d1520",
                    color: reEvaluating ? "#384d60" : "#6e87a2",
                    fontSize: 11, cursor: reEvaluating ? "not-allowed" : "pointer",
                    fontFamily: C.mono, opacity: reEvaluating ? 0.7 : 1,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowReevalConfirm(true)}
              disabled={reEvaluating}
              className="vdk-sb-btn"
              style={{
                width: "100%", padding: "8px 0", borderRadius: 6,
                border: "1px solid #243050", background: "#0d1520",
                color: reEvaluating ? "#384d60" : "#6e87a2",
                fontSize: 11, fontWeight: 600,
                cursor: reEvaluating ? "not-allowed" : "pointer",
                fontFamily: C.mono, letterSpacing: "0.03em",
                opacity: reEvaluating ? 0.72 : 1,
              }}
            >
              {reEvaluating ? "↺ Running verdict…" : "↺ Run verdict now"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowStartCert(true)}
            className="vdk-sb-btn vdk-sb-btn-primary"
            style={{
              width: "100%", padding: "8px 0", borderRadius: 6,
              border: "none", background: "#c4d4e8", color: "#060810",
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              fontFamily: C.mono, letterSpacing: "0.04em",
            }}
          >
            + New release
          </button>
        </div>
      )}
    </>
  );
}

/* ─── Main Sidebar ───────────────────────────────────────────────────────── */
export default function Sidebar({
  isMobile,
  project,
  nav,
  releaseSidebarCounts,
  sidebarReleaseGroups: _sidebarReleaseGroups,
  collapsedSidebarDayKeys: _collapsedSidebarDayKeys,
  setCollapsedSidebarDayKeys: _setCollapsedSidebarDayKeys,
  selectedId: _selectedId,
  setSelectedId: _setSelectedId,
  formatReleaseDisplayName,
  currentUser,
  canAct,
  showReevalConfirm: _showReevalConfirm,
  setShowReevalConfirm: _setShowReevalConfirm,
  reEvaluating: _reEvaluating,
  handleConfirmReevaluation: _handleConfirmReevaluation,
  setShowStartCert: _setShowStartCert,
  onNavigate,
  roles,
  pendingRelease,
  setCurrentUser,
  setLocalStore,
  onLogout,
  hasBackend: _hasBackendUnused,
  workspaceSyncing,
  refreshWorkspaceFromServer,
  sidebarRecById: _sidebarRecById,
  releaseTypes: _releaseTypesUnused,
  formatSidebarReleaseAge: _formatSidebarReleaseAge,
  sidebarStatusLabel: _sidebarStatusLabel,
  releaseRiskScore: _releaseRiskScore,
  thresholds: _thresholdsUnused,
}) {
  const nBlocked = releaseSidebarCounts?.nBlocked ?? 0;
  const planLabel = (() => {
    const multi = formatCertTiersShort(project?.certEnvs);
    if (multi) return `${multi} · workspace`;
    if (project?.env) return `${String(project.env).toUpperCase()} · workspace`;
    return "Pro · workspace";
  })();

  return (
    <aside
      style={{
        width: isMobile ? "100%" : 220,
        minWidth: isMobile ? "100%" : 220,
        flexShrink: 0,
        background: "#090d14",
        borderRight: "1px solid #18243a",
        borderBottom: isMobile ? "1px solid #18243a" : "none",
        display: "flex",
        flexDirection: "column",
        height: isMobile ? "auto" : "100vh",
        maxHeight: isMobile ? "45vh" : "none",
        overflowY: "auto",
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* ── Logo ── */}
      <div style={{
        padding: "0 18px",
        height: 56,
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderBottom: "1px solid #18243a",
        flexShrink: 0,
      }}>
        <span style={{ lineHeight: 0, flexShrink: 0, display: "flex" }}>
          <VerdiktMark size={28} variant="onDark" />
        </span>
        <span style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 15, fontWeight: 600,
          color: "#c4d4e8", letterSpacing: "-0.02em",
        }}>
          Verdikt
        </span>
      </div>

      {/* ── Workspace selector ── */}
      <div style={{
        margin: "14px 12px",
        padding: "10px 12px",
        borderRadius: 7,
        background: "#0d1520",
        border: "1px solid #18243a",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12.5, fontWeight: 500, color: "#c4d4e8",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {project?.name || "Workspace"}
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, fontWeight: 500, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "#384d60", marginTop: 2,
          }}>
            {planLabel}
          </div>
        </div>
        <Chevron />
      </div>

      {/* ── Navigation ── */}
      <nav style={{ padding: "8px 12px", flex: 1, overflowY: "auto" }}>
        <SectionLabel>Workspace</SectionLabel>
        <NavBtn id="release" label="Releases" active={nav === "release"}
          badge={nBlocked > 0 ? nBlocked : null}
          onClick={() => onNavigate("release")} />
        <NavBtn id="intelligence" label="Intelligence Hub" active={nav === "intelligence"}
          onClick={() => onNavigate("intelligence")} />
        <NavBtn id="audit" label="Audit Trail" active={nav === "audit"}
          onClick={() => onNavigate("audit")} />
        <NavBtn id="thresholds" label="Thresholds" active={nav === "thresholds"}
          onClick={() => onNavigate("thresholds")} />
        <NavBtn id="trend" label="Trends" active={nav === "trend"}
          onClick={() => onNavigate("trend")} />

        <SectionLabel>Settings</SectionLabel>
        <NavBtn id="settings" label="Settings" active={nav === "settings"}
          onClick={() => onNavigate("settings")} />
      </nav>

      {/* ── Footer ── */}
      <SidebarFooter
        currentUser={currentUser}
        roles={roles}
        canAct={canAct}
        pendingRelease={pendingRelease}
        formatReleaseDisplayName={formatReleaseDisplayName}
        setCurrentUser={setCurrentUser}
        setLocalStore={setLocalStore}
        onLogout={onLogout}
        onSync={refreshWorkspaceFromServer}
        syncing={workspaceSyncing}
      />
    </aside>
  );
}
