import React, { useEffect, useState, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { verdiktMarkInnerPaths, verdictStateToMarkVariant } from "../brand/verdiktMarkSvg.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";
import { fetchPublicCertRecord } from "../lib/fetchPublicCert.js";
import { DEMOS, CATS, STATE_META, DEMO_KEYS } from "./badgeDemoData.js";
import "./BadgePage.css";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function workspaceSlug(fromPath = "") {
  const raw = String(fromPath || "").trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function statusToStateKey(status) {
  const s = String(status || "").toUpperCase();
  if (s === "CERTIFIED_WITH_OVERRIDE") return "override";
  if (s === "UNCERTIFIED") return "uncertified";
  return "certified";
}

function demoSignalsToGroups(demo) {
  return CATS.map((cat) => {
    const sigs = demo.signals[cat.id];
    if (!sigs?.length) return null;
    return { id: cat.id, label: cat.label, icon: cat.icon, color: cat.color, signals: sigs };
  }).filter(Boolean);
}

function liveGroupsToView(signalGroups) {
  return (signalGroups || []).map((g, i) => ({
    id: g.id || `group-${i}`,
    label: g.label,
    icon: "◈",
    color: "#7c3aed",
    signals: (g.signals || []).map((s) => ({
      name: s.name,
      status: s.status === "fail" ? "fail" : s.status === "pass" ? "pass" : "waived",
      val: s.value,
      thresh: s.threshold,
      hg: s.hard_gate
    }))
  }));
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

function SignalGrid({ groups }) {
  return (
    <div className="sig-cats">
      {groups.map((cat) => {
        const sigs = cat.signals;
        if (!sigs?.length) return null;
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

function CertificationNarrative({ certification, stateKey }) {
  if (!certification) return null;
  if (stateKey !== "certified" && stateKey !== "override") return null;
  const confidencePct =
    typeof certification.confidence === "number" ? Math.round(certification.confidence * 100) : null;
  const baseline = certification.baseline_reference?.version;
  return (
    <div
      style={{
        margin: "20px 0 0",
        background: "rgba(5,150,105,0.06)",
        border: "1px solid rgba(5,150,105,0.2)",
        borderRadius: 10,
        padding: "14px 20px"
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          fontWeight: 700,
          color: "#059669",
          letterSpacing: "0.1em",
          marginBottom: 8
        }}
      >
        DECISION LOG — WHY THIS RELEASE WAS CERTIFIED
      </div>
      <div style={{ fontSize: 12, color: "var(--text, #e2e8f0)", lineHeight: 1.7, marginBottom: 10 }}>
        {esc(certification.summary)}
        {confidencePct != null ? (
          <span style={{ display: "block", marginTop: 6, color: "var(--mid, #94a3b8)", fontSize: 11 }}>
            Certification confidence: {confidencePct}%
            {certification.risk_level ? ` · Risk: ${esc(certification.risk_level)}` : ""}
          </span>
        ) : null}
      </div>
      {Array.isArray(certification.required_signals_met) && certification.required_signals_met.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {certification.required_signals_met.map((s) => (
            <span
              key={s}
              style={{
                fontSize: 10,
                fontFamily: "var(--mono)",
                color: "#059669",
                background: "rgba(5,150,105,0.12)",
                border: "1px solid rgba(5,150,105,0.25)",
                borderRadius: 5,
                padding: "2px 8px"
              }}
            >
              {esc(s)} ✓
            </span>
          ))}
        </div>
      ) : null}
      {(baseline || certification.monitoring_note) && (
        <div style={{ fontSize: 11, color: "var(--mid, #94a3b8)", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
          {baseline ? `Baseline: ${esc(baseline)}` : ""}
          {baseline && certification.monitoring_note ? " · " : ""}
          {certification.monitoring_note ? esc(certification.monitoring_note) : ""}
        </div>
      )}
    </div>
  );
}

function RecordCard({
  stateKey,
  wsSlug,
  certVersion,
  project,
  version,
  date,
  time,
  releaseType,
  env,
  certifiedBy,
  failing,
  override,
  waiver,
  signalGroups,
  certification,
  signature
}) {
  const m = STATE_META[stateKey] || STATE_META.certified;
  const stampLines = m.label.split("\n");
  const totalSignals = signalGroups?.reduce((n, g) => n + (g.signals?.length || 0), 0) || 0;

  return (
    <div className="record-page">
      <div className="rec-header">
        <div className="rec-header-left">
          <div className="verdikt-mark">
            <span className="verdikt-mark-svg" aria-hidden>
              <VerdiktMark size={28} variant={verdictStateToMarkVariant(stateKey)} />
            </span>
            <div className="verdikt-mark-name">Verdikt</div>
          </div>
          <div className="rec-header-divider" />
          <div className="rec-header-type">Certification Record</div>
        </div>
        <div className="rec-header-url">useverdikt.com/cert/{wsSlug}/{esc(certVersion)}</div>
      </div>

      <div className={`rec-hero ${m.heroBg}`}>
        <div className="rec-hero-inner">
          <div>
            <div className="rec-meta-project">{esc(project)}</div>
            <div className="rec-version">{esc(version)}</div>
            <div className="rec-info-row">
              <div className="rec-info-item">
                {esc(date)} · {esc(time)}
              </div>
              <div className="rec-info-item">
                <span className="rec-release-type">{esc(releaseType)}</span>
              </div>
              {env ? <div className="rec-info-item">{esc(env)}</div> : null}
              {certifiedBy ? (
                <div className="rec-info-item">Signed by {esc(certifiedBy)}</div>
              ) : stateKey === "uncertified" ? (
                <div className="rec-info-item" style={{ color: "#dc2626" }}>
                  No sign-off recorded
                </div>
              ) : null}
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
              <div className="stamp-date">{esc(date)}</div>
            </div>
          </div>
        </div>
      </div>

      {signature ? (
        <div
          style={{
            padding: "10px 20px",
            fontSize: 10,
            fontFamily: "var(--mono)",
            color: "#059669",
            letterSpacing: "0.04em",
            borderBottom: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          ⊕ Cryptographically signed · {esc(signature.algorithm)} · {esc(signature.signed_at?.slice(0, 10))}
        </div>
      ) : null}

      {failing?.length > 0 ? (
        <div style={{ paddingTop: 24 }}>
          <div className="failing-callout">
            <div className="failing-callout-title">SIGNALS BELOW THRESHOLD ({failing.length})</div>
            <div className="failing-list">
              {failing.map((f, idx) => (
                <div key={`${f.signal_id || f.name}-${idx}`} className="failing-row">
                  <div className="failing-sig">
                    {esc(f.category || f.cat)} · {esc(f.name)}
                    {f.hard_gate || f.hg ? (
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
                    <span className="failing-val">{esc(f.value ?? f.val)}</span>
                    <span className="failing-thresh">vs {esc(f.threshold ?? f.thresh)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <CertificationNarrative certification={certification} stateKey={stateKey} />

      {override ? (
        <div className="override-record">
          <div className="override-record-title">CERTIFIED WITH OVERRIDE — PERMANENT RECORD</div>
          <div className="override-fields">
            <div>
              <div className="override-field-label">Override owner</div>
              <div className="override-field-value">
                {esc(override.owner)}
                {override.title ? (
                  <>
                    <br />
                    <span style={{ color: "var(--mid)", fontSize: 12 }}>{esc(override.title)}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div>
              <div className="override-field-label">Recorded</div>
              <div className="override-field-value" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                {esc(override.recorded_at || override.ts)}
              </div>
            </div>
          </div>
          {override.justification ? (
            <div className="override-justification">
              <div className="override-field-label" style={{ marginBottom: 6 }}>
                Justification & risk acceptance
              </div>
              <div className="override-just-text">&quot;{esc(override.justification || override.reason)}&quot;</div>
            </div>
          ) : null}
          <div className="override-immutable">⊠ This record is permanent. It cannot be edited or deleted.</div>
        </div>
      ) : null}

      {signalGroups?.length > 0 ? (
        <div className="sig-section">
          <div className="sig-section-title">Signal detail — all {totalSignals} signals evaluated</div>
          {waiver?.reason ? (
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
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  display: "block",
                  marginBottom: 4
                }}
              >
                E2E REGRESSION WAIVED — {esc((waiver.waivedBy || "").toUpperCase())}
              </span>
              {esc(waiver.reason)}
            </div>
          ) : null}
          <SignalGrid groups={signalGroups} />
        </div>
      ) : null}

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
          <Link className="rec-footer-link" to="/">
            useverdikt.com
          </Link>
        </div>
      </div>
    </div>
  );
}

function EmbedSection({ wsSlug, certVersion, copyLabel, onCopy }) {
  return (
    <div className="badge-section">
      <div className="badge-section-title">Embeddable badges — drop into any PR, doc, or release note</div>
      <div className="badge-demos">
        <div className="badge-group">
          <div className="badge-group-label">SVG badges</div>
          <div className="badge-svg-wrap">
            {DEMO_KEYS.map((s) => (
              <div key={s} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 9,
                    color: "#334155",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase"
                  }}
                >
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
          <button type="button" className="embed-copy" onClick={onCopy}>
            {copyLabel}
          </button>
        </div>
        <div className="embed-code">
          <span style={{ color: "#475569" }}>&lt;!-- Markdown --&gt;</span>
          <br />
          <span className="attr">[![Verdikt]</span>
          <span className="str">(https://useverdikt.com/badge/{wsSlug}/{encodeURIComponent(String(certVersion))})</span>
          <span className="attr">]</span>
          <span className="str">(https://useverdikt.com/cert/{wsSlug}/{encodeURIComponent(String(certVersion))})</span>
        </div>
      </div>
    </div>
  );
}

function LivePublicCertPage({ wsSlug, certVersion }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copyLabel, setCopyLabel] = useState("Copy");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPublicCertRecord(wsSlug, certVersion)
      .then((data) => {
        if (!active) return;
        if (!data) setError("not_found");
        else setRecord(data);
      })
      .catch((e) => {
        if (!active) return;
        setError(e?.message || "load_failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [wsSlug, certVersion]);

  useEffect(() => {
    const title = record?.release?.version
      ? `Verdikt — ${record.release.version} certification record`
      : "Verdikt — Certification Record";
    document.title = title;
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, [record]);

  const embedMarkdown = useMemo(() => {
    const v = encodeURIComponent(certVersion);
    return `[![Verdikt](https://useverdikt.com/badge/${wsSlug}/${v})](https://useverdikt.com/cert/${wsSlug}/${v})`;
  }, [certVersion, wsSlug]);

  const copyEmbed = () => {
    navigator.clipboard?.writeText(embedMarkdown).catch(() => {});
    setCopyLabel("✓ Copied");
    setTimeout(() => setCopyLabel("Copy"), 2000);
  };

  if (loading) {
    return (
      <div className="badge-public-shell" style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>
        Loading certification record…
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="badge-public-shell" style={{ padding: 48, maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18, color: "#e2e8f0", marginBottom: 12 }}>Certification record not found</h1>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
          This record may not exist, may not have a verdict yet, or the workspace owner has disabled public certification
          records.
        </p>
        <Link to="/" style={{ color: "#a78bfa", fontSize: 13 }}>
          ← useverdikt.com
        </Link>
      </div>
    );
  }

  const stateKey = statusToStateKey(record.release?.status);
  const signalGroups = record.signal_groups ? liveGroupsToView(record.signal_groups) : null;

  return (
    <div className="badge-public-shell">
      <RecordCard
        stateKey={stateKey}
        wsSlug={record.workspace?.slug || wsSlug}
        certVersion={record.release?.version || certVersion}
        project={record.workspace?.display_name}
        version={record.release?.version}
        date={record.release?.date}
        time={record.release?.time}
        releaseType={record.release?.release_type_label}
        env={record.release?.environment}
        certifiedBy={
          stateKey === "override" && record.override?.owner
            ? record.override.owner
            : stateKey === "certified"
              ? "Verdikt certification system"
              : null
        }
        failing={record.failing}
        override={record.override}
        waiver={{}}
        signalGroups={signalGroups}
        certification={record.certification}
        signature={record.signature}
      />
      <EmbedSection wsSlug={wsSlug} certVersion={certVersion} copyLabel={copyLabel} onCopy={copyEmbed} />
    </div>
  );
}

function DemoBadgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { workspaceSlug: workspaceSlugParam, version: versionParam } = useParams();
  const [demoKey, setDemoKey] = useState("certified");
  const [copyLabel, setCopyLabel] = useState("Copy");

  useEffect(() => {
    const s = searchParams.get("state");
    if (s && DEMO_KEYS.includes(s)) setDemoKey(s);
  }, [searchParams]);

  const d = DEMOS[demoKey];
  const wsSlug = workspaceSlug(workspaceSlugParam);
  const certVersion = versionParam ? decodeURIComponent(String(versionParam)) : String(d.version);
  const signalGroups = demoSignalsToGroups(d);

  const embedMarkdown = useMemo(() => {
    const v = encodeURIComponent(certVersion);
    return `[![Verdikt](https://useverdikt.com/badge/${wsSlug}/${v})](https://useverdikt.com/cert/${wsSlug}/${v})`;
  }, [certVersion, wsSlug]);

  const copyEmbed = () => {
    navigator.clipboard?.writeText(embedMarkdown).catch(() => {});
    setCopyLabel("✓ Copied");
    setTimeout(() => setCopyLabel("Copy"), 2000);
  };

  return (
    <div className="badge-public-shell">
      <div className="demo-chrome">
        <div className="demo-label">Demo layouts — sample certification records</div>
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
        </div>
      </div>

      <RecordCard
        stateKey={demoKey}
        wsSlug={wsSlug}
        certVersion={certVersion}
        project={d.project}
        version={d.version}
        date={d.date}
        time={d.time}
        releaseType={d.releaseType}
        env={d.env}
        certifiedBy={d.certifiedBy}
        failing={d.failing}
        override={d.override}
        waiver={d.waiver}
        signalGroups={signalGroups}
        certification={
          demoKey === "certified"
            ? {
                summary:
                  "All required signals met current thresholds with no blocking regression detected. Accuracy (91%) exceeded the 85% floor by 6 points. No prior regression streak.",
                confidence: 0.91,
                required_signals_met: ["accuracy", "safety", "smoke", "e2e_regression"],
                baseline_reference: { version: "v2.13.0" },
                monitoring_note: "Ship with normal monitoring and post-release review."
              }
            : null
        }
        signature={null}
      />

      <p className="badge-honesty">
        Illustrative layouts for embedding and sales. Live tenant records use{" "}
        <code className="badge-code">/cert/{"{workspace}"}/{"{version}"}</code> after you set a public URL slug in
        Settings → General.
      </p>

      <EmbedSection wsSlug={wsSlug} certVersion={certVersion} copyLabel={copyLabel} onCopy={copyEmbed} />
    </div>
  );
}

export default function BadgePage() {
  const { workspaceSlug: workspaceSlugParam, version: versionParam } = useParams();
  const isLive = Boolean(workspaceSlugParam && versionParam);

  useEffect(() => {
    if (!isLive) {
      document.title = "Verdikt — Public Certification Record";
    }
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, [isLive]);

  if (isLive) {
    const wsSlug = workspaceSlug(workspaceSlugParam);
    const certVersion = decodeURIComponent(String(versionParam));
    return <LivePublicCertPage wsSlug={wsSlug} certVersion={certVersion} />;
  }

  return <DemoBadgePage />;
}
