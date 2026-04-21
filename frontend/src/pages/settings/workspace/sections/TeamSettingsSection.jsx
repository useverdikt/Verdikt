import React from "react";
import { ROLES } from "../../settingsData.js";
import { ROLE_CARD_ORDER, ROLE_CARD_PERMS } from "../settingsWorkspaceModel.js";

function RoleCards({ rolePolicy }) {
  return ROLE_CARD_ORDER.filter((id) => rolePolicy[id]).map((id) => {
    const cfg = rolePolicy[id];
    const perms = ROLE_CARD_PERMS[id] || { yes: [], no: [] };
    const badgeBg = `${cfg.color || "#6b7280"}1f`;
    const title = (cfg.label || id).toUpperCase();
    const derivedYes = [];
    const derivedNo = [];
    if (cfg.canAct === false) {
      derivedNo.push("Can certify releases");
      derivedNo.push("Can configure thresholds");
    } else {
      derivedYes.push("Can certify releases");
    }
    if (cfg.canOverride) derivedYes.push("Can approve overrides");
    else derivedNo.push("Can approve overrides");
    const yesList = [...perms.yes, ...derivedYes];
    const noList = [...perms.no, ...derivedNo];
    return (
      <div key={id} className="role-card">
        <div className="role-card-head">
          <span className="role-badge" style={{ background: badgeBg, color: cfg.color || "var(--mid)" }}>
            {title}
          </span>
          {cfg.canAct === false ? (
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9,
                color: "var(--mid)",
                background: "var(--border)",
                padding: "1px 6px",
                borderRadius: 3,
                fontWeight: 700,
                letterSpacing: "0.06em"
              }}
            >
              READ ONLY
            </span>
          ) : null}
        </div>
        <div className="role-perms">
          {yesList.map((p) => (
            <div key={p} className="role-perm yes">
              {p}
            </div>
          ))}
          {noList.map((p) => (
            <div key={p} className="role-perm no">
              {p}
            </div>
          ))}
        </div>
      </div>
    );
  });
}

export default function TeamSettingsSection({
  section,
  members,
  setMembers,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  roleLabels,
  autoPolicyToggle,
  setAutoPolicyToggle,
  rolePolicy,
  toast
}) {
  return (
    <div className={`section${section === "team" ? " active" : ""}`} id="panel-team">
      <div className="section-header">
        <div className="section-eyebrow">Governance</div>
        <h1 className="section-h1">
          Team &amp; <em>Roles</em>
        </h1>
        <p className="section-desc">
          You decide who can approve a release. Every override is permanently on record — named, justified, and timestamped. Who holds override authority is configurable per workspace.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Who can override</div>
            <div className="sblock-desc">Override authority is configurable per org.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="gov-option">
            <div>
              <div className="gov-label">Override submission</div>
              <div className="gov-desc">Minimum role required to submit an override request</div>
            </div>
            <select className="gov-select" onChange={() => toast("Override governance updated")}>
              <option>AI Product Lead</option>
              <option>ML / AI Engineer</option>
            </select>
          </div>
          <div className="gov-option">
            <div>
              <div className="gov-label">Override approval</div>
              <div className="gov-desc">Who must sign off before an overridden release ships</div>
            </div>
            <select className="gov-select" onChange={() => toast("Override governance updated")}>
              <option>AI Product Lead or VP Engineering</option>
            </select>
          </div>
          <div className="gov-option">
            <div>
              <div className="gov-label">Smoke gate override</div>
              <div className="gov-desc">Smoke test failures are permanently UNCERTIFIED — override is not available</div>
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--red)" }} />
              LOCKED — NO OVERRIDE
            </div>
          </div>
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Automated approvers (preview)</div>
            <div className="sblock-desc">Planned capability for policy-based approval paths.</div>
          </div>
          <button type="button" className="btn-ghost accent" onClick={() => toast("Automated approvers are preview-only in this MVP")}>
            Preview only
          </button>
        </div>
        <div className="sblock-body">
          <div className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">Automated policy approval (preview)</div>
              <div className="toggle-desc">Not active in the current MVP.</div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoPolicyToggle}
                onChange={(e) => {
                  setAutoPolicyToggle(e.target.checked);
                  toast(`Automated policy approval preview ${e.target.checked ? "enabled" : "disabled"}`);
                }}
              />
              <div className="toggle-track" />
            </label>
          </div>
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Members</div>
            <div className="sblock-desc">
              {members.filter((m) => m.status === "active").length} members · {members.filter((m) => m.status === "pending").length} pending invites
            </div>
          </div>
        </div>
        <div className="sblock-body">
          {members.map((m, i) => (
            <div key={`${m.email}-${i}`} className="member-row">
              <div className="member-av" style={{ background: m.color }}>
                {m.initials}
              </div>
              <div className="member-info">
                <div className="member-name">{m.name}</div>
                <div className="member-email">{m.email}</div>
              </div>
              <div className="member-status" style={{ color: m.status === "active" ? "var(--green)" : "var(--amber)" }}>
                <div className="status-dot" style={{ background: m.status === "active" ? "var(--green)" : "var(--amber)" }} />
                {m.status === "active" ? "Active" : "Pending invite"}
              </div>
              <select
                className="member-role"
                value={m.role}
                onChange={(e) => {
                  const next = [...members];
                  next[i] = { ...next[i], role: e.target.value };
                  setMembers(next);
                  toast(`${m.name}'s role updated to ${roleLabels[e.target.value]}`);
                }}
              >
                {Object.entries(roleLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {m.email !== "jordan@useverdikt.com" ? (
                <button
                  type="button"
                  className="btn-remove"
                  title="Remove member"
                  onClick={() => {
                    setMembers((prev) => prev.filter((_, j) => j !== i));
                    toast(`${m.name} removed from workspace`);
                  }}
                >
                  ✕
                </button>
              ) : (
                <div style={{ width: 26 }} />
              )}
            </div>
          ))}
        </div>
        <div className="sblock-footer" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
          <div className="footer-note">Invite a new member</div>
          <div className="invite-row">
            <input className="inp" placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <select className="role-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {Object.entries(ROLES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-save"
              disabled={!inviteEmail.trim()}
              onClick={() => {
                const email = inviteEmail.trim();
                if (!email || !email.includes("@")) {
                  toast("Enter a valid email address");
                  return;
                }
                setMembers((prev) => [
                  ...prev,
                  {
                    name: email.split("@")[0],
                    email,
                    role: inviteRole,
                    status: "pending",
                    color: "#6b7280",
                    initials: email.slice(0, 2).toUpperCase()
                  }
                ]);
                setInviteEmail("");
                toast(`Invite sent to ${email}`);
              }}
            >
              Send invite
            </button>
          </div>
        </div>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Role permissions</div>
            <div className="sblock-desc">What each role can do inside Verdikt.</div>
          </div>
        </div>
        <div className="sblock-body" style={{ paddingBottom: 0 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", letterSpacing: "0.1em", marginBottom: 10 }}>EDIT CORE POLICY FLAGS</div>
          <div style={{ fontSize: 11, color: "var(--mid)", marginBottom: 10 }}>Advanced role-policy editing is hidden in MVP mode.</div>
          <div style={{ display: "none" }} />
        </div>
        <div className="sblock-body">
          <div className="role-cards">
            <RoleCards rolePolicy={rolePolicy} />
          </div>
        </div>
      </div>
    </div>
  );
}
