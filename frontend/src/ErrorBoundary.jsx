import React from "react";

/**
 * Catches render errors in child tree so one broken view does not blank the entire SPA shell.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#060810",
            color: "#c4d4e8",
            padding: 32,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            maxWidth: 560,
            margin: "0 auto"
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: "#6e87a2", marginBottom: 16, lineHeight: 1.5 }}>
            Try refreshing the page. If this keeps happening, contact support with the details below.
          </p>
          <pre
            style={{
              fontSize: 12,
              color: "#f87171",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#090d14",
              padding: 16,
              borderRadius: 8,
              border: "1px solid #18243a"
            }}
          >
            {String(error?.message || error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              padding: "10px 18px",
              background: "#0d1520",
              color: "#c4d4e8",
              border: "1px solid #18243a",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.04em"
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
