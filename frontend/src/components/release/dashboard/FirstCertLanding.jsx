import { useState } from "react";
import { Link } from "react-router-dom";
import { C } from "../../../theme/tokens.js";
import {
  COLLECTING_EXPLAINER,
  DEFAULT_TRIGGER_LABEL,
  FIRST_CERT_EYEBROW,
  FIRST_CERT_INTRO,
  FIRST_CERT_TITLE,
  WAITING_FOR_FIRST_PR_TITLE,
  shaTaggingSnippet,
  waitingForFirstPrBody
} from "../../../lib/firstCertCopy.js";

function CopyBlock({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginTop: 10
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div
          style={{
            fontFamily: C.mono,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: C.muted
          }}
        >
          {label}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
          style={{
            fontFamily: C.mono,
            fontSize: 11,
            color: C.accent,
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer"
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: C.mono,
          fontSize: 12,
          color: C.text,
          lineHeight: 1.5
        }}
      >
        {value}
      </pre>
    </div>
  );
}

function ChecklistItems({ items }) {
  return items.map((item) => (
    <div
      key={item.id}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: item.done ? C.muted : C.text, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: item.done ? C.green : C.amber }}>{item.done ? "✓" : "·"}</span>
          {item.label}
        </div>
        {!item.done && item.hint ? (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4, paddingLeft: 20, lineHeight: 1.5 }}>{item.hint}</div>
        ) : null}
      </div>
      {!item.done && (item.link?.url || item.to) ? (
        item.link?.url ? (
          <a
            href={item.link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: C.accent, textDecoration: "none", fontFamily: C.mono, whiteSpace: "nowrap" }}
          >
            {item.link.label} →
          </a>
        ) : (
          <Link
            to={item.to}
            style={{ fontSize: 12, color: C.accent, textDecoration: "none", fontFamily: C.mono, whiteSpace: "nowrap" }}
          >
            Open →
          </Link>
        )
      ) : null}
    </div>
  ));
}

export default function FirstCertLanding({ setupChecklist, waitingForFirstPr = false, onNewRelease }) {
  if (!setupChecklist || setupChecklist.loading) return null;
  const label = setupChecklist.triggerLabel || DEFAULT_TRIGGER_LABEL;

  return (
    <div
      style={{
        margin: "0 0 16px",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "22px 22px 20px"
      }}
    >
      <div
        style={{
          fontFamily: C.mono,
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.accent,
          marginBottom: 8
        }}
      >
        {FIRST_CERT_EYEBROW}
      </div>
      <h2 style={{ margin: 0, fontFamily: C.serif, fontSize: 26, fontWeight: 600, color: C.text, lineHeight: 1.15 }}>
        {waitingForFirstPr ? WAITING_FOR_FIRST_PR_TITLE : FIRST_CERT_TITLE}
      </h2>
      <p style={{ margin: "10px 0 0", color: C.muted, fontSize: 14, lineHeight: 1.6, maxWidth: 640 }}>
        {waitingForFirstPr ? waitingForFirstPrBody(label) : FIRST_CERT_INTRO}
      </p>
      <p style={{ margin: "8px 0 16px", color: C.muted, fontSize: 13, lineHeight: 1.55, maxWidth: 640 }}>{COLLECTING_EXPLAINER}</p>

      <ChecklistItems items={setupChecklist.items || []} />

      <CopyBlock label="PR label" value={label} />
      <CopyBlock label="SHA tagging (GitHub Actions)" value={shaTaggingSnippet()} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16, alignItems: "center" }}>
        <Link
          to="/settings?section=trigger"
          style={{
            fontFamily: C.mono,
            fontSize: 12,
            color: C.bg,
            background: C.accent,
            textDecoration: "none",
            borderRadius: 8,
            padding: "8px 14px"
          }}
        >
          Open GitHub trigger
        </Link>
        <Link
          to="/thresholds"
          style={{
            fontFamily: C.mono,
            fontSize: 12,
            color: C.accent,
            background: "transparent",
            textDecoration: "none",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "8px 14px"
          }}
        >
          Adopt threshold pack
        </Link>
        {onNewRelease ? (
          <button
            type="button"
            onClick={onNewRelease}
            style={{
              fontFamily: C.mono,
              fontSize: 12,
              color: C.muted,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "8px 4px"
            }}
          >
            Start a manual cert instead
          </button>
        ) : null}
      </div>
    </div>
  );
}
