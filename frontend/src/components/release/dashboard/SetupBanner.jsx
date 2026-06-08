export default function SetupBanner({ setupChecklist }) {
  if (!setupChecklist || setupChecklist.complete) return null;
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
        Setup checklist
      </div>
      {setupChecklist.items.map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 6
          }}
        >
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
          {!item.done && (
            <a
              href={item.to}
              style={{
                fontSize: 11,
                color: "#3b82f6",
                textDecoration: "none",
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              Open →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
