import React from "react";
import { Link } from "react-router-dom";
import { VerdiktMark } from "../../../components/brand/VerdiktMark.jsx";
import { SECTION_LABELS } from "../settingsData.js";
import { SettingsNavIcons } from "./SettingsNavIcons.jsx";

export default function SettingsWorkspaceShell({
  contentRef,
  logout,
  orgName,
  projectName,
  section,
  setSection,
  sidebarUser,
  children
}) {
  return (
    <div className="shell">
      <div className="app-rail">
        <Link to="/releases" className="rail-logo" title="Verdikt" style={{ textDecoration: "none" }}>
          <VerdiktMark size={32} variant="onDark" />
        </Link>
        <Link to="/releases" className="rail-btn" title="Releases" aria-label="Releases">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <div className="tooltip">Releases</div>
        </Link>
        <Link to="/trends" className="rail-btn" title="Intelligence" aria-label="Intelligence">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <div className="tooltip">Trends</div>
        </Link>
        <Link to="/audit" className="rail-btn" title="Audit" aria-label="Audit">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 12h12M2 8h9M2 4h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <div className="tooltip">Audit trail</div>
        </Link>
        <div className="rail-spacer" />
        <div className="rail-divider" />
        <button type="button" className="rail-btn active" title="Settings" aria-label="Settings" aria-current="page">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <div className="tooltip">Settings</div>
        </button>
        <div className="rail-divider" />
        <button type="button" className="rail-btn" title="Sign out" aria-label="Sign out" onClick={logout}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 2h4v12h-4M7 5l-3 3 3 3M4 8h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="tooltip">Sign out</div>
        </button>
      </div>

      <div className="settings-sidebar">
        <div className="ss-head">
          <div className="ss-title">Settings</div>
          <div className="ss-ws">{orgName}</div>
        </div>
        <div className="readiness">
          <div className="readiness-head">Governance readiness</div>
          <div className="readiness-item">
            <span>Eval source connected</span>
            <div className="ri-dot empty" id="ready-eval" />
          </div>
          <div className="readiness-item">
            <span>Thresholds configured</span>
            <div className="ri-dot empty" id="ready-thresh" />
          </div>
          <div className="readiness-item">
            <span>Release trigger active</span>
            <div className="ri-dot empty" id="ready-trigger" />
          </div>
          <div className="readiness-item">
            <span>Override policy set</span>
            <div className="ri-dot empty" id="ready-policy" />
          </div>
        </div>
        <nav className="ss-nav">
          <div className="ss-nav-group">
            <div className="nav-group-label">Workspace</div>
            {["general", "team", "thresholds"].map((id) => (
              <button key={id} type="button" className={`nav-item${section === id ? " active" : ""}`} onClick={() => setSection(id)}>
                {SettingsNavIcons[id]}
                {SECTION_LABELS[id]}
              </button>
            ))}
          </div>
          <div className="ss-nav-group">
            <div className="nav-group-label">Integration</div>
            {["api", "trigger", "notifications"].map((id) => (
              <button key={id} type="button" className={`nav-item${section === id ? " active" : ""}`} onClick={() => setSection(id)}>
                {SettingsNavIcons[id]}
                {id === "notifications" ? (
                  <>
                    Notifications<span className="nav-badge">1</span>
                  </>
                ) : (
                  SECTION_LABELS[id]
                )}
              </button>
            ))}
            <button type="button" className={`nav-item${section === "governance" ? " active" : ""}`} onClick={() => setSection("governance")}>
              {SettingsNavIcons.governance}
              Governance
            </button>
            <button type="button" className={`nav-item${section === "emails" ? " active" : ""}`} onClick={() => setSection("emails")}>
              {SettingsNavIcons.emails}
              Email previews
            </button>
          </div>
          <div className="ss-nav-group">
            <div className="nav-group-label">Account</div>
            <button type="button" className={`nav-item${section === "billing" ? " active" : ""}`} onClick={() => setSection("billing")}>
              {SettingsNavIcons.billing}
              Plan &amp; Billing
            </button>
            <button type="button" className={`nav-item nav-danger${section === "danger" ? " active" : ""}`} onClick={() => setSection("danger")}>
              {SettingsNavIcons.danger}
              Danger Zone
            </button>
          </div>
        </nav>
        <div className="ss-footer">
          <div className="user-row">
            <div className="user-av" style={{ background: "#0891b2" }}>
              {sidebarUser.initials}
            </div>
            <div>
              <div className="user-name">{sidebarUser.name}</div>
              <div className="user-email">{sidebarUser.email}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div className="breadcrumb">
            <Link to="/releases">{orgName}</Link>
            <span className="breadcrumb-sep">›</span>
            <Link to="/releases">{projectName}</Link>
            <span className="breadcrumb-sep">›</span>
            <span className="breadcrumb-current">{SECTION_LABELS[section]}</span>
          </div>
          <div className="topbar-right">
            <button type="button" className="topbar-action" onClick={() => window.open("https://useverdikt.com", "_blank", "noopener,noreferrer")}>
              Docs ↗
            </button>
          </div>
        </div>

        <div className="content" ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
