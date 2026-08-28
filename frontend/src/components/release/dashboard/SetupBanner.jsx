import { Link } from "react-router-dom";
import { C } from "../../../theme/tokens.js";
import { COLLECTING_EXPLAINER, DEFAULT_TRIGGER_LABEL } from "../../../lib/firstCertCopy.js";

export default function SetupBanner({ setupChecklist }) {
  if (!setupChecklist || setupChecklist.loading || setupChecklist.complete) return null;
  const label = setupChecklist.triggerLabel || DEFAULT_TRIGGER_LABEL;

  return (
    <div
      style={{
        margin: "0 0 16px",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "14px 16px"
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: C.accent,
          fontFamily: C.mono,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 8
        }}
      >
        First certification setup
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Finish these steps so a <code style={{ color: C.text }}>{label}</code> PR collects signals. {COLLECTING_EXPLAINER}
      </div>
      {setupChecklist.items.map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 8
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                color: item.done ? C.muted : C.text,
                display: "flex",
                gap: 8,
                alignItems: "center"
              }}
            >
              <span style={{ color: item.done ? C.green : C.amber }}>{item.done ? "✓" : "·"}</span>
              {item.label}
            </div>
            {!item.done && item.hint ? (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, paddingLeft: 20, lineHeight: 1.45 }}>
                {item.hint}
              </div>
            ) : null}
          </div>
          {!item.done && (item.link?.url || item.to) ? (
            item.link?.url ? (
              <a
                href={item.link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12,
                  color: C.accent,
                  textDecoration: "none",
                  fontFamily: C.mono,
                  whiteSpace: "nowrap"
                }}
              >
                {item.link.label} →
              </a>
            ) : (
              <Link
                to={item.to}
                style={{
                  fontSize: 12,
                  color: C.accent,
                  textDecoration: "none",
                  fontFamily: C.mono,
                  whiteSpace: "nowrap"
                }}
              >
                Open →
              </Link>
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}
