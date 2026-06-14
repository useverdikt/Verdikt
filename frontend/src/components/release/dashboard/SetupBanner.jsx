export default function SetupBanner({ setupChecklist }) {
  if (!setupChecklist || setupChecklist.loading || setupChecklist.complete) return null;

  return (
    <div
      style={{
        margin: "0 0 16px",
        background: "#090d14",
        border: "1px solid #18243a",
        borderRadius: 8,
        padding: "12px 14px"
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "#3b82f6",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 8
        }}
      >
        First certification setup
      </div>
      <div style={{ fontSize: 12, color: "#6e87a2", marginBottom: 10, lineHeight: 1.5 }}>
        Complete these steps before your first <code style={{ color: "#c4d4e8" }}>verdikt:rc</code> PR so signals
        arrive instead of staying stuck in COLLECTING.
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
                fontSize: 12,
                color: item.done ? "#6e87a2" : "#c4d4e8",
                display: "flex",
                gap: 8,
                alignItems: "center"
              }}
            >
              <span style={{ color: item.done ? "#22c55e" : "#f59e0b" }}>{item.done ? "✓" : "·"}</span>
              {item.label}
            </div>
            {!item.done && item.hint ? (
              <div style={{ fontSize: 11, color: "#6e87a2", marginTop: 4, paddingLeft: 20, lineHeight: 1.45 }}>
                {item.hint}
              </div>
            ) : null}
          </div>
          {!item.done ? (
            <a
              href={item.to}
              style={{
                fontSize: 11,
                color: "#3b82f6",
                textDecoration: "none",
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: "nowrap"
              }}
            >
              Open →
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
