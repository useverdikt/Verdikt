import React from "react";
import { C } from "../../../theme/tokens.js";

/**
 * Infrastructure prerequisites checklist (local demo state). Not currently routed in AppContentSwitch;
 * kept for a future nav item or deep link.
 */
export default function InfraViewPanel({ infraItems, onToggleField }) {
  const infraDone = infraItems.filter((i) => i.status === "done").length;
  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 800,
            color: C.text,
            letterSpacing: "-0.03em"
          }}
        >
          Prerequisites
        </h2>
        <p style={{ margin: "6px 0 0", color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
          Three infrastructure changes must be completed before Verdikt signals are trustworthy. Until
          these are done, the verdict engine is ingesting unreliable data.
        </p>
      </div>
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Infrastructure readiness</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {infraDone} of {infraItems.length} prerequisites complete
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {infraItems.map((i) => (
            <div
              key={i.id}
              style={{
                width: 28,
                height: 6,
                borderRadius: 3,
                background: i.status === "done" ? C.green : C.border
              }}
            />
          ))}
        </div>
      </div>
      {infraItems.map((item) => (
        <div
          key={item.id}
          style={{
            background: C.surface,
            border: `1px solid ${item.status === "done" ? `${C.green}40` : C.border}`,
            borderRadius: 12,
            overflow: "hidden"
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 12
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: item.status === "done" ? C.green : C.red,
                flexShrink: 0,
                boxShadow: item.status === "done" ? `0 0 8px ${C.green}66` : ""
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{item.label}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: C.mono,
                    color: C.red,
                    background: C.redDim,
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontWeight: 700
                  }}
                >
                  {item.priority}
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, marginTop: 2 }}>
                {item.linkedTo}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onToggleField(item.id, "status", item.status === "done" ? "pending" : "done")
              }
              style={{
                background: item.status === "done" ? C.greenDim : C.accentDim,
                color: item.status === "done" ? C.green : C.accentBright,
                border: `1px solid ${item.status === "done" ? C.green : C.accent}30`,
                borderRadius: 7,
                padding: "6px 14px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: C.mono,
                flexShrink: 0
              }}
            >
              {item.status === "done" ? "✓ Done" : "Mark done"}
            </button>
          </div>
          <div style={{ padding: "14px 20px" }}>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, margin: "0 0 12px" }}>
              {item.description}
            </p>
            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: C.muted,
                  fontWeight: 700,
                  marginBottom: 5,
                  letterSpacing: "0.08em",
                  fontFamily: C.mono
                }}
              >
                ASSIGNED OWNER
              </label>
              <input
                value={item.owner}
                onChange={(e) => onToggleField(item.id, "owner", e.target.value)}
                placeholder="e.g. Artem Loenko"
                style={{
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 7,
                  padding: "7px 12px",
                  color: C.text,
                  fontSize: 13,
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box"
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
