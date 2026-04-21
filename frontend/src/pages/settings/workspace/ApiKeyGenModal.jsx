import React from "react";

/**
 * Two-step overlay: name API key → reveal & copy full secret, then append to local key list.
 */
export default function ApiKeyGenModal({ keyGen, setKeyGen, setApiKeys, toast }) {
  if (!keyGen.open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000d8",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
    >
      <div
        style={{
          background: "#0e1016",
          border: "1px solid #1a1f2e",
          borderRadius: 16,
          padding: "32px 36px",
          width: "100%",
          maxWidth: 480,
          position: "relative"
        }}
      >
        <button
          type="button"
          style={{
            position: "absolute",
            top: 16,
            right: 18,
            background: "transparent",
            border: "none",
            color: "#4b5280",
            fontSize: 18,
            cursor: "pointer",
            lineHeight: 1
          }}
          onClick={() => setKeyGen((k) => ({ ...k, open: false }))}
        >
          ✕
        </button>
        {keyGen.step === "name" ? (
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--accentL)", letterSpacing: "0.12em", marginBottom: 8 }}>
              NEW API KEY
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>Name this key</h3>
            <div className="field" style={{ marginBottom: 20 }}>
              <label className="field-label">Key name</label>
              <input
                className="inp"
                placeholder="e.g. Staging pipeline"
                style={{ marginTop: 6 }}
                value={keyGen.name}
                onChange={(e) => setKeyGen((k) => ({ ...k, name: e.target.value }))}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={() => setKeyGen((k) => ({ ...k, open: false }))}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!keyGen.name.trim()}
                onClick={() => {
                  const full = `vdk_live_${Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
                  setKeyGen((k) => ({ ...k, step: "reveal", full, copyLabel: "Copy" }));
                }}
              >
                Generate key →
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--green)", letterSpacing: "0.12em", marginBottom: 8 }}>KEY GENERATED</div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>Copy your key now</h3>
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid rgba(16,185,129,0.25)",
                borderRadius: 8,
                padding: "14px 16px",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 12
              }}
            >
              <code style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--green)", flex: 1, wordBreak: "break-all" }}>{keyGen.full}</code>
              <button
                type="button"
                className="btn-secondary"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  navigator.clipboard?.writeText(keyGen.full);
                  setKeyGen((k) => ({ ...k, copyLabel: "✓ Copied" }));
                }}
              >
                {keyGen.copyLabel}
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const masked = keyGen.full.slice(0, 12) + "••••••••••••••••••••";
                  setApiKeys((prev) => [
                    {
                      name: keyGen.name.trim(),
                      key: masked,
                      created: new Date().toISOString().slice(0, 10),
                      lastUsed: "Never"
                    },
                    ...prev
                  ]);
                  setKeyGen({ open: false, step: "name", name: "", full: "", copyLabel: "Copy" });
                  toast(`API key "${keyGen.name.trim()}" created and saved`);
                }}
              >
                I&apos;ve saved this key — done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
