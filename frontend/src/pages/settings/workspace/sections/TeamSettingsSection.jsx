import React, { useState } from "react";
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
      derivedNo.push("Create releases / submit signals");
      derivedNo.push("Manage workspace settings");
    } else {
      derivedYes.push("Create releases / submit signals");
      derivedYes.push("Manage workspace settings");
    }
    if (cfg.canOverride) derivedYes.push("Approve overrides");
    else derivedNo.push("Approve overrides");
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
  membersLoading,
  currentUserEmail,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  roleLabels,
  rolePolicy,
  toast,
  onSendInvite,
  onUpdateRole,
  onRemoveMember,
  onRevokeInvite
}) {
  const [inviteBusy, setInviteBusy] = useState(false);

  return (
    <div className={`section${section === "team" ? " active" : ""}`} id="panel-team">
      <div className="section-header">
        <div className="section-eyebrow">Governance</div>
        <h1 className="section-h1">
          Team &amp; <em>Roles</em>
        </h1>
        <p className="section-desc">
          Invite colleagues to this workspace. Everyone shares the same releases, GitHub connection, thresholds, and escalation inbox.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">Members</div>
            <div className="sblock-desc">
              {members.filter((m) => m.status === "active").length} members ·{" "}
              {members.filter((m) => m.status === "pending").length} pending invites
            </div>
          </div>
        </div>
        <div className="sblock-body">
          {membersLoading ? (
            <p className="muted">Loading members…</p>
          ) : members.length === 0 ? (
            <p className="muted">No members yet.</p>
          ) : (
            members.map((m, i) => (
              <div key={`${m.email}-${m.status}-${i}`} className="member-row">
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
                {m.status === "active" ? (
                  <select
                    className="member-role"
                    value={m.role}
                    onChange={(e) => {
                      void onUpdateRole(m.user_id, e.target.value, m.name).catch((err) =>
                        toast(err?.message || "Could not update role")
                      );
                    }}
                  >
                    {Object.entries(roleLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="member-role" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)" }}>
                    {roleLabels[m.role] || m.role}
                  </div>
                )}
                {m.status === "active" && m.email !== currentUserEmail ? (
                  <button
                    type="button"
                    className="btn-remove"
                    title="Remove member"
                    onClick={() => {
                      if (!window.confirm(`Remove ${m.name} from this workspace?`)) return;
                      void onRemoveMember(m.user_id, m.name).catch((err) => toast(err?.message || "Could not remove member"));
                    }}
                  >
                    ✕
                  </button>
                ) : m.status === "pending" ? (
                  <button
                    type="button"
                    className="btn-remove"
                    title="Revoke invite"
                    onClick={() => {
                      void onRevokeInvite(m.invite_id, m.email).catch((err) => toast(err?.message || "Could not revoke invite"));
                    }}
                  >
                    ✕
                  </button>
                ) : (
                  <div style={{ width: 26 }} />
                )}
              </div>
            ))
          )}
        </div>
        <div className="sblock-footer" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
          <div className="footer-note">Invite a colleague</div>
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
              disabled={!inviteEmail.trim() || inviteBusy}
              onClick={() => {
                const email = inviteEmail.trim();
                if (!email || !email.includes("@")) {
                  toast("Enter a valid email address");
                  return;
                }
                setInviteBusy(true);
                void onSendInvite(email, inviteRole)
                  .then(() => setInviteEmail(""))
                  .catch((err) => toast(err?.message || "Could not send invite"))
                  .finally(() => setInviteBusy(false));
              }}
            >
              {inviteBusy ? "Sending…" : "Send invite"}
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
        <div className="sblock-body">
          <div className="role-cards">
            <RoleCards rolePolicy={rolePolicy} />
          </div>
        </div>
      </div>
    </div>
  );
}
