import React from "react";

export default function SidebarFooter({
  currentUser,
  roles: _roles,
  canAct: _canAct,
  pendingRelease: _pendingRelease,
  formatReleaseDisplayName: _formatReleaseDisplayName,
  setCurrentUser: _setCurrentUser,
  setLocalStore: _setLocalStore,
  onLogout,
  onSync,
  syncing
}) {
  if (!currentUser) return null;

  const initials = (currentUser.name || "DU")
    .split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div style={{
      padding: "14px 12px",
      borderTop: "1px solid #18243a",
      flexShrink: 0,
    }}>
      {/* Sync row (subtle, above footer) */}
      {onSync && (
        <button
          type="button"
          onClick={() => onSync({ manual: true })}
          disabled={syncing}
          style={{
            display: "block", width: "100%",
            padding: "7px 0", marginBottom: 10,
            background: "#0d1520", border: "1px solid #18243a",
            borderRadius: 6, color: syncing ? "#384d60" : "#384d60",
            fontSize: 10, cursor: syncing ? "default" : "pointer",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.03em",
          }}
        >
          {syncing ? "⟳ Syncing…" : "↻ Sync workspace"}
        </button>
      )}

      {/* User row — matches .user-row in verdikt-dashboard.html */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Avatar */}
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "#111a28", border: "1px solid #243050",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, color: "#6e87a2",
          flexShrink: 0,
        }}>
          {initials}
        </div>

        {/* Name + email */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 12.5, fontWeight: 500, color: "#c4d4e8",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {currentUser.name || "User"}
          </div>
          <div style={{
            fontSize: 11, color: "#384d60",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {currentUser.email || ""}
          </div>
        </div>

        {/* Sign out */}
        <button
          type="button"
          onClick={onLogout}
          title="Sign out"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#384d60", flexShrink: 0, padding: 4,
            display: "flex", alignItems: "center",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M9 9l3-2.5L9 4" stroke="currentColor" strokeWidth="1.2"
              strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 6.5H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
