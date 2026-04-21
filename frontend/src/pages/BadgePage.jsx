import React, { useEffect, useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verdiktMarkInnerPaths, verdictStateToMarkVariant } from "../brand/verdiktMarkSvg.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";
import { DEMOS, CATS, STATE_META, DEMO_KEYS } from "./badgeDemoData.js";
import "./BadgePage.css";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function workspaceSlug() {
  const fromLs = typeof window !== "undefined" ? localStorage.getItem("vdk3_workspace_slug") : "";
  const slug = String(fromLs || "verdikt").trim().toLowerCase();
  return slug || "verdikt";
}

function makeBadgeSVG(state, size = "normal") {
  const configs = {
    certified: { left: "#1a1f2e", right: "#059669", label: "CERTIFIED", dot: "#34d399" },
    uncertified: { left: "#1a1f2e", right: "#7f1d1d", label: "UNCERTIFIED", dot: "#f87171" },
    override: { left: "#1a1f2e", right: "#78350f", label: "CERT. W/ OVERRIDE", dot: "#fbbf24" }
  };
  const c = configs[state];
  const h = size === "large" ? 26 : 20;
  const fs = size === "large" ? 9 : 7;
  const lw = 52;
  const rw = state === "override" ? 110 : state === "uncertified" ? 72 : 66;
  const totalW = lw + rw;
  const ly = h / 2 + fs * 0.35;

  const gid = `bg-${state}-${size}`;
  const markVariant = verdictStateToMarkVariant(state);
  const innerMark = verdiktMarkInnerPaths(markVariant);
  const pad = 3;
  const markScale = (h - pad * 2) / 80;
  const markPx = 80 * markScale;
  const my = (h - markPx) / 2;
  const textVerdiktX = (pad + markPx + lw) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" viewBox="0 0 ${totalW} ${h}" role="img" aria-label="Verdikt: ${c.label}">
  <title>Verdikt: ${c.label}</title>
  <defs>
    <linearGradient id="${gid}-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".02"/>
      <stop offset=".5" stop-color="#000" stop-opacity=".04"/>
      <stop offset="1" stop-color="#000" stop-opacity=".1"/>
    </linearGradient>
  </defs>
  <clipPath id="${gid}-c"><rect width="${totalW}" height="${h}" rx="${h / 2}"/></clipPath>
  <g clip-path="url(#${gid}-c)">
    <rect width="${lw}" height="${h}" fill="${c.left}"/>
    <rect x="${lw}" width="${rw}" height="${h}" fill="${c.right}"/>
    <rect width="${totalW}" height="${h}" fill="url(#${gid}-g)"/>
  </g>
  <g clip-path="url(#${gid}-c)" fill="#fff" text-anchor="middle" font-family="'JetBrains Mono','Courier New',monospace" font-size="${fs}">
    <g transform="translate(${pad},${my}) scale(${markScale})">${innerMark}</g>
    <text x="${textVerdiktX}" y="${ly}" letter-spacing="0.08em">verdikt</text>
    <text x="${lw + rw / 2}" y="${ly}" letter-spacing="0.06em">${c.label}</text>
  </g>
</svg>`;
}

function SignalRows({ sigs }) {
  const useTwoCols = sigs.length > 2;
  return (
    <div className={useTwoCols ? "sig-rows" : ""}>
      {sigs.map((sig) => {
        const valColor = sig.status === "pass" ? "#059669" : sig.status === "fail" ? "#dc2626" : "#d97706";
        const dotClass = sig.status === "pass" ? "dot-pass" : sig.status === "fail" ? "dot-fail" : "dot-waived";
        const rowClass = useTwoCols ? "sig-row" : "sig-row-single";
        return (
          <div key={`${sig.name}-${sig.val}-${sig.thresh}`} className={rowClass}>
            <div className="sig-name">
              {sig.name}
              {sig.hg ? (
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: "var(--mono)",
                    color: "#dc2626",
                    background: "#fef2f2",
                    padding: "1px 5px",
                    borderRadius: 3,
                    fontWeight: 600,
                    marginLeft: 4
                  }}
                >
                  HARD GATE
                </span>
              ) : null}
            </div>
            <div className="sig-val">
              <div className={`sig-dot ${dotClass}`} />
              <span style={{ color: valColor }}>{sig.val}</span>
              <span className="sig-thresh">{sig.thresh}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SignalGrid({ demo }) {
  return (
    <div className="sig-cats">
      {CATS.map((cat) => {
        const sigs = demo.signals[cat.id];
        if (!sigs) return null;
        const allPass = sigs.every((s) => s.status === "pass" || s.status === "waived");
        const hasFail = sigs.some((s) => s.status === "fail");
        const statusColor = hasFail ? "#dc2626" : allPass ? "#059669" : "#d97706";
        const statusLabel = hasFail ? "FAILING" : allPass ? "PASSING" : "WAIVED";
        return (
          <div key={cat.id} className="sig-cat">
            <div className="sig-cat-header">
              <div className="sig-cat-left">
                <span className="sig-cat-icon" style={{ color: cat.color }}>
                  {cat.icon}
                </span>
                <span className="sig-cat-name">{cat.label}</span>
              </div>
              <div className="sig-cat-status" style={{ color: statusColor }}>
                <div className="sig-dot" style={{ background: statusColor }} />
                {statusLabel}
              </div>
            </div>
            <SignalRows sigs={sigs} />
          </div>
        );
      })}
    </div>
  );
}

function RecordCard({ demoKey }) {
  const d = DEMOS[demoKey];
  const m = STATE_META[demoKey];
  const wsSlug = workspaceSlug();

  const stampLines = m.label.split("\n");

  return (
    <div className="record-page">
      <div className="rec-header">
        <div className="rec-header-left">
          <div className="verdikt-mark">
            <span className="verdikt-mark-svg" aria-hidden>
              <VerdiktMark size={28} variant={verdictStateToMarkVariant(demoKey)} />
            </span>
            <div className="verdikt-mark-name">Verdikt</div>
          </div>
          <div className="rec-header-divider" />
          <div className="rec-header-type">Certification Record</div>
        </div>
        <div className="rec-header-url">useverdikt.com/cert/{wsSlug}/{esc(d.version)}</div>
      </div>

      <div className={`rec-hero ${m.heroBg}`}>
        <div className="rec-hero-inner">
          <div>
            <div className="rec-meta-project">{esc(d.project)}</div>
            <div className="rec-version">{esc(d.version)}</div>
            <div className="rec-info-row">
              <div className="rec-info-item">
                {esc(d.date)} · {esc(d.time)}
              </div>
              <div className="rec-info-item">
                <span className="rec-release-type">{esc(d.releaseType)}</span>
              </div>
              <div className="rec-info-item">{esc(d.env)}</div>
              {d.certifiedBy ? (
                <div className="rec-info-item">Signed by {esc(d.certifiedBy)}</div>
              ) : (
                <div className="rec-info-item" style={{ color: "#dc2626" }}>
                  No sign-off recorded
                </div>
              )}
            </div>
          </div>
          <div className="stamp-wrap">
            <div className={`stamp ${m.stampClass}`}>
              <div className="stamp-icon">{m.icon}</div>
              <div className="stamp-text">
                {stampLines.map((line, i) => (
                  <React.Fragment key={i}>
                    {i > 0 ? <br /> : null}
                    {line}
                  </React.Fragment>
                ))}
              </div>
              <div className="stamp-date">{esc(d.date)}</div>
            </div>
          </div>
        </div>
      </div>

      {d.failing.length > 0 ? (
        <div style={{ paddingTop: 24 }}>
          <div className="failing-callout">
            <div className="failing-callout-title">SIGNALS BELOW THRESHOLD ({d.failing.length})</div>
            <div className="failing-list">
              {d.failing.map((f, idx) => (
                <div key={idx} className="failing-row">
                  <div className="failing-sig">
                    {esc(f.cat)} · {esc(f.name)}
                    {f.hg ? (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: "var(--mono)",
                          color: "#dc2626",
                          background: "#fef2f2",
                          padding: "1px 4px",
                          borderRadius: 3
                        }}
                      >
                        HARD GATE
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="failing-val">{esc(f.val)}</span>
                    <span className="failing-thresh">vs {esc(f.thresh)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {d.override ? (
        <div className="override-record">
          <div className="override-record-title">CERTIFIED WITH OVERRIDE — PERMANENT RECORD</div>
          <div className="override-fields">
            <div>
              <div className="override-field-label">Override owner</div>
              <div className="override-field-value">
                {esc(d.override.owner)}
                <br />
                <span style={{ color: "var(--mid)", fontSize: 12 }}>{esc(d.override.title)}</span>
              </div>
            </div>
            <div>
              <div className="override-field-label">Recorded</div>
              <div className="override-field-value" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                {esc(d.override.ts)}
              </div>
            </div>
          </div>
          <div className="override-justification">
            <div className="override-field-label" style={{ marginBottom: 6 }}>
              Justification & risk acceptance
            </div>
            <div className="override-just-text">&quot;{esc(d.override.reason)}&quot;</div>
          </div>
          <div className="override-immutable">⊠ This record is permanent. It cannot be edited or deleted.</div>
        </div>
      ) : null}

      <div className="sig-section">
        <div className="sig-section-title">
          Signal detail — all {Object.values(d.signals).flat().length} signals evaluated
        </div>
        {d.waiver?.reason ? (
          <div
            style={{
              background: "var(--amberBg)",
              border: "1px solid var(--amberBorder)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 12,
              fontSize: 12,
              color: "var(--amber)",
              lineHeight: 1.6
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", display: "block", marginBottom: 4 }}>
              E2E REGRESSION WAIVED — {esc((d.waiver.waivedBy || "").toUpperCase())}
            </span>
            {esc(d.waiver.reason)}
          </div>
        ) : null}
        <SignalGrid demo={d} />
      </div>

      <div className="rec-footer">
        <div className="rec-footer-immutable">⊠ This certification record is permanent and immutable</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            className="no-print"
            onClick={() => window.print()}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "5px 14px",
              borderRadius: 6,
              border: "1px solid var(--accent)",
              background: "rgba(124,58,237,0.06)",
              color: "var(--accent)",
              cursor: "pointer",
              letterSpacing: "0.05em"
            }}
          >
            ⬇ Download PDF
          </button>
          <Link className="rec-footer-link" to="/releases">
            ← Dashboard
          </Link>
          <Link className="rec-footer-link" to="/">
            useverdikt.com
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function BadgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoKey, setDemoKey] = useState("certified");
  const [copyLabel, setCopyLabel] = useState("Copy");

  useEffect(() => {
    const s = searchParams.get("state");
    if (s && DEMO_KEYS.includes(s)) setDemoKey(s);
  }, [searchParams]);

  useEffect(() => {
    document.title = "Verdikt — Public Certification Record";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  const d = DEMOS[demoKey];
  const wsSlug = workspaceSlug();
  const embedMarkdown = useMemo(() => {
    const v = encodeURIComponent(String(d.version));
    return `[![Verdikt](https://useverdikt.com/badge/${wsSlug}/${v})](https://useverdikt.com/cert/${wsSlug}/${v})`;
  }, [d.version, wsSlug]);

  const copyEmbed = () => {
    navigator.clipboard?.writeText(embedMarkdown).catch(() => {});
    setCopyLabel("✓ Copied");
    setTimeout(() => setCopyLabel("Copy"), 2000);
  };

  return (
    <div className="badge-public-shell">
      <div className="demo-chrome">
        <div className="demo-label">Demo layouts — not live workspace data</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="demo-states">
            {DEMO_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className={`demo-state-btn ${demoKey === k ? STATE_META[k].btnActive : ""}`}
                onClick={() => setSearchParams({ state: k }, { replace: true })}
              >
                {k === "certified" ? "CERTIFIED" : k === "uncertified" ? "UNCERTIFIED" : "CERTIFIED WITH OVERRIDE"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid rgba(34,197,94,0.35)",
              background: "rgba(34,197,94,0.08)",
              color: "#4ade80",
              cursor: "pointer",
              letterSpacing: "0.05em"
            }}
          >
            ⬇ Download PDF
          </button>
        </div>
      </div>

      <RecordCard demoKey={demoKey} />

      <p className="badge-honesty">
        Illustrative certification <strong>layouts</strong> for embedding and sales — not an anonymous public API to your tenant data.
        Authoritative verdicts and audit history are in the signed-in workspace. Share this demo: add{" "}
        <code className="badge-code">?state=certified</code>, <code className="badge-code">uncertified</code>, or{" "}
        <code className="badge-code">override</code> to the URL.
      </p>

      <div className="badge-section">
        <div className="badge-section-title">Embeddable badges — drop into any PR, doc, or release note</div>
        <div className="badge-demos">
          <div className="badge-group">
            <div className="badge-group-label">SVG badges</div>
            <div className="badge-svg-wrap">
              {DEMO_KEYS.map((s) => (
                <div key={s} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {s.replace("_", " ")}
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: makeBadgeSVG(s) }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="embed-block">
          <div className="embed-block-header">
            <span>Embed snippet — Markdown / HTML</span>
            <button type="button" className="embed-copy" onClick={copyEmbed}>
              {copyLabel}
            </button>
          </div>
          <div className="embed-code">
            <span style={{ color: "#475569" }}>&lt;!-- Markdown --&gt;</span>
            <br />
            <span className="attr">[![Verdikt]</span>
            <span className="str">(https://useverdikt.com/badge/{wsSlug}/{encodeURIComponent(String(d.version))})</span>
            <span className="attr">]</span>
            <span className="str">(https://useverdikt.com/cert/{wsSlug}/{encodeURIComponent(String(d.version))})</span>
            <br />
            <br />
            <span style={{ color: "#475569" }}>&lt;!-- HTML --&gt;</span>
            <br />
            <span style={{ color: "#c084fc" }}>&lt;a</span> <span className="attr">href</span>=
            <span className="str">&quot;https://useverdikt.com/cert/{wsSlug}/{encodeURIComponent(String(d.version))}&quot;</span>
            <span style={{ color: "#c084fc" }}>&gt;</span>
            <br />
            {"  "}
            <span style={{ color: "#c084fc" }}>&lt;img</span> <span className="attr">src</span>=
            <span className="str">&quot;https://useverdikt.com/badge/{wsSlug}/{encodeURIComponent(String(d.version))}&quot;</span>
            <br />
            {"       "}
            <span className="attr">alt</span>=<span className="str">&quot;Verdikt certification&quot;</span>
            <span style={{ color: "#c084fc" }}> /&gt;</span>
            <br />
            <span style={{ color: "#c084fc" }}>&lt;/a&gt;</span>
          </div>
        </div>
      </div>
    </div>
  );
}
