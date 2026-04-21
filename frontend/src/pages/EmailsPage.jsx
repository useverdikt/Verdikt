import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { EMAIL_PREVIEWS } from "./emailPreviewTemplates.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";
import "./EmailsPage.css";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function EmailsPreviewPanel({ embedded = false }) {
  const [currentId, setCurrentId] = useState(EMAIL_PREVIEWS[0]?.id || "override-request");
  const [copyLabel, setCopyLabel] = useState("Copy HTML");

  useEffect(() => {
    document.title = "Verdikt — Email notifications";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  const current = useMemo(() => EMAIL_PREVIEWS.find((e) => e.id === currentId) || EMAIL_PREVIEWS[0], [currentId]);

  const bodyHtml = useMemo(() => (current ? current.body() : ""), [current]);

  const copyHTML = () => {
    if (!current) return;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body>${current.body()}</body></html>`;
    navigator.clipboard?.writeText(html).catch(() => {});
    setCopyLabel("✓ Copied");
    setTimeout(() => setCopyLabel("Copy HTML"), 2000);
  };

  const content = (
    <div className="emails-preview-root" style={{ display: "flex", flexDirection: "column", minHeight: embedded ? "auto" : "100vh" }}>
      <div className="emails-topbar">
        {!embedded ? (
          <Link to="/settings?section=emails" style={{ color: "#22c55e", textDecoration: "none", fontWeight: 600 }}>
            ← Back to settings
          </Link>
        ) : null}
        <span>Preview only — templates ship as HTML</span>
      </div>

      <div className="chrome" style={{ flex: 1 }}>
        <div className="chrome-header">
          <div className="chrome-logo">
            <span className="chrome-logo-mark" aria-hidden>
              <VerdiktMark size={28} variant="onDark" />
            </span>
            <div>
              <div className="chrome-logo-name">Verdikt</div>
              <div className="chrome-tag">Email notifications</div>
            </div>
          </div>
          <div className="chrome-label">6 notification artefacts</div>
        </div>

        <div className="switcher">
          {EMAIL_PREVIEWS.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`switcher-btn ${currentId === e.id ? "active" : ""}`}
              onClick={() => setCurrentId(e.id)}
            >
              <div className="switcher-dot" style={{ background: e.dot }} />
              <div className="switcher-btn-label">{e.label}</div>
              <div className="switcher-btn-desc">{e.desc}</div>
            </button>
          ))}
        </div>

        <div className="email-frame-wrap">
          <div className="email-frame-header">
            <div className="email-frame-meta">
              <div className="email-frame-field">
                <span className="email-frame-field-label">To</span>
                <span className="email-frame-field-value">{esc(current?.to)}</span>
              </div>
              <div className="email-frame-field">
                <span className="email-frame-field-label">From</span>
                <span className="email-frame-field-value">{esc(current?.from)}</span>
              </div>
              <div className="email-frame-field">
                <span className="email-frame-field-label">Re</span>
                <span className="email-frame-field-value email-frame-subject">{esc(current?.subject)}</span>
              </div>
            </div>
            <div className="email-frame-actions">
              <button type="button" className="frame-action-btn" onClick={copyHTML}>
                {copyLabel}
              </button>
            </div>
          </div>
          <div className="email-body-wrap">
            <div className="email-shell" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </div>
        </div>
      </div>
    </div>
  );
  return content;
}

export default function EmailsPage() {
  return <EmailsPreviewPanel embedded={false} />;
}
