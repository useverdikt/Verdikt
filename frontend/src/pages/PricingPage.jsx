import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";
import { BoldMarkdownText } from "../lib/safeRichText.jsx";
import { PLANS, COMPARISON_ROWS, FAQS } from "./pricingData.js";

const C = {
  bg:           "#060810",
  surface:      "#090d14",
  raise:        "#0d1520",
  border:       "#18243a",
  borderL:      "#243050",
  accent:       "#22c55e",
  accentL:      "#4ade80",
  accentD:      "#16a34a",
  accentDim:    "rgba(34,197,94,0.08)",
  accentBorder: "rgba(34,197,94,0.25)",
  green:        "#22c55e",
  greenDim:     "rgba(34,197,94,0.08)",
  greenBorder:  "rgba(34,197,94,0.2)",
  amber:        "#f59e0b",
  text:         "#c4d4e8",
  mid:          "#6e87a2",
  dim:          "#384d60",
  mono:         "'JetBrains Mono', 'Courier New', monospace",
  serif:        "'Cormorant Garamond', Georgia, serif",
  sans:         "'DM Sans', system-ui, sans-serif"
};

function PlanPrice({ plan, billing }) {
  const price = billing === "annual" ? plan.annualPrice : plan.monthlyPrice;
  if (price === null) {
    return (
      <div style={{ fontFamily: C.serif, fontSize: 28, fontStyle: "italic", color: C.text, letterSpacing: "-0.02em" }}>
        Let&apos;s talk
      </div>
    );
  }
  if (price === 0) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
          <span style={{ fontFamily: C.serif, fontSize: 42, color: C.text, letterSpacing: "-0.03em", lineHeight: 1 }}>Free</span>
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.dim, letterSpacing: "0.04em" }}>Free forever</div>
      </>
    );
  }
  const annualTotal = price * 12;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
        <span style={{ fontFamily: C.mono, fontSize: 16, color: C.mid, marginRight: 2 }}>£</span>
        <span style={{ fontFamily: C.serif, fontSize: 42, color: C.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{price}</span>
        <span style={{ fontFamily: C.mono, fontSize: 12, color: C.dim, marginLeft: 2 }}>/mo</span>
      </div>
      <div style={{ fontFamily: C.mono, fontSize: 11, color: C.dim, letterSpacing: "0.04em" }}>
        {billing === "annual" ? `Billed annually · £${annualTotal}/year` : "Billed monthly"}
      </div>
      {billing === "annual" ? (
        <div
          style={{
            fontFamily: C.mono,
            fontSize: 10,
            color: C.green,
            background: C.greenDim,
            border: `1px solid ${C.greenBorder}`,
            borderRadius: 4,
            padding: "2px 8px",
            display: "inline-block",
            marginTop: 4
          }}
        >
          20% saved vs monthly
        </div>
      ) : null}
    </>
  );
}

function ComparisonCell({ val, teamCol }) {
  if (val === true) {
    return (
      <td style={{ padding: "10px 12px", textAlign: "center", color: C.text }}>
        <span style={{ color: C.green }}>✓</span>
      </td>
    );
  }
  if (val === false) {
    return (
      <td style={{ padding: "10px 12px", textAlign: "center", color: C.dim }}>
        ·
      </td>
    );
  }
  return (
    <td
      style={{
        padding: "10px 12px",
        textAlign: "center",
        fontFamily: C.mono,
        fontSize: 12,
        color: teamCol ? C.accentL : C.text
      }}
    >
      {val}
    </td>
  );
}

export default function PricingPage() {
  const [billing, setBilling] = useState("monthly");
  const [navScrolled, setNavScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState(() => new Set());

  useEffect(() => {
    document.title = "Verdikt — Pricing";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleFaq = (i) => {
    setOpenFaq((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: C.sans, lineHeight: 1.6, minHeight: "100vh" }}>
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 40px",
          background: navScrolled ? "rgba(7,8,9,0.92)" : "transparent",
          borderBottom: navScrolled ? `1px solid ${C.border}` : "1px solid transparent",
          backdropFilter: navScrolled ? "blur(12px)" : "none",
          transition: "background 0.3s, border-color 0.3s"
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: "inherit" }}>
          <span style={{ lineHeight: 0, display: "flex" }}>
            <VerdiktMark size={28} variant="onDark" />
          </span>
          <div style={{ fontFamily: C.serif, fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>Verdikt</div>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          <Link to="/" style={{ fontSize: 13, color: C.mid, textDecoration: "none" }}>
            Product
          </Link>
          <span style={{ fontSize: 13, color: C.mid, cursor: "default" }}>Docs</span>
          <span style={{ fontSize: 13, color: C.accentL }}>Pricing</span>
          <span style={{ fontSize: 13, color: C.mid, cursor: "default" }}>Blog</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link to="/login" style={{ fontSize: 13, color: C.mid, textDecoration: "none" }}>
            Sign in
          </Link>
          <Link
            to="/request-access"
            style={{
              background: C.accent,
              color: "#fff",
              border: "none",
              borderRadius: 7,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: C.sans
            }}
          >
            Join waitlist
          </Link>
        </div>
      </nav>

      <section
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "100px 24px 60px",
          position: "relative",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(124,58,237,0.07) 0%, transparent 70%)"
          }}
        />
        <div
          style={{
            fontFamily: C.mono,
            fontSize: 10,
            color: C.accentL,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            marginBottom: 20
          }}
        >
          Pricing
        </div>
        <h1
          style={{
            fontFamily: C.serif,
            fontSize: "clamp(2rem, 6vw, 4.75rem)",
            lineHeight: 1,
            letterSpacing: "-0.03em",
            marginBottom: 18,
            maxWidth: 800,
            position: "relative",
            zIndex: 1
          }}
        >
          Simple pricing.
          <br />
          <em style={{ fontStyle: "italic", color: C.accentL }}>Serious AI infrastructure.</em>
        </h1>
        <p
          style={{
            fontSize: 17,
            color: C.mid,
            maxWidth: 520,
            lineHeight: 1.75,
            fontWeight: 300,
            marginBottom: 36,
            position: "relative",
            zIndex: 1
          }}
        >
          Verdikt is the Release Intelligence System for release decisions. Priced per workspace, not per seat. Every member of
          your AI product team can view the release decision record, eval scores, and override history —{" "}
          <strong style={{ color: C.text, fontWeight: 500 }}>without friction, without a per-head conversation.</strong>
        </p>
        <div
          style={{
            display: "inline-flex",
            background: C.raise,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 72,
            position: "relative",
            zIndex: 1
          }}
        >
          <button
            type="button"
            onClick={() => setBilling("monthly")}
            style={{
              padding: "9px 22px",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              fontFamily: C.sans,
              background: billing === "monthly" ? C.accent : "transparent",
              color: billing === "monthly" ? "#fff" : C.mid
            }}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBilling("annual")}
            style={{
              padding: "9px 22px",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              fontFamily: C.sans,
              background: billing === "annual" ? C.accent : "transparent",
              color: billing === "annual" ? "#fff" : C.mid
            }}
          >
            Annual{" "}
            <span
              style={{
                fontFamily: C.mono,
                fontSize: 10,
                color: C.green,
                background: C.greenDim,
                border: `1px solid ${C.greenBorder}`,
                borderRadius: 4,
                padding: "2px 8px",
                marginLeft: 6,
                letterSpacing: "0.04em"
              }}
            >
              Save 20%
            </span>
          </button>
        </div>
      </section>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 40px 100px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            marginBottom: 80,
            alignItems: "start"
          }}
        >
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              style={{
                background: C.surface,
                border: `1px solid ${plan.featured ? "rgba(124,58,237,0.25)" : C.border}`,
                borderRadius: 14,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                boxShadow: plan.featured ? "0 0 0 1px rgba(124,58,237,0.25), 0 24px 60px rgba(124,58,237,0.12)" : "none",
                position: "relative"
              }}
            >
              {plan.featured ? (
                <div
                  style={{
                    background: C.accent,
                    fontFamily: C.mono,
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: "0.18em",
                    color: "#fff",
                    padding: 6,
                    textAlign: "center"
                  }}
                >
                  MOST POPULAR
                </div>
              ) : null}
              <div style={{ padding: plan.featured ? "22px 26px 22px" : "28px 26px 22px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: C.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: plan.tierColor, marginBottom: 10 }}>
                  {plan.tier}
                </div>
                <div style={{ fontFamily: C.serif, fontSize: 24, color: C.text, letterSpacing: "-0.02em", marginBottom: 6 }}>{plan.name}</div>
                <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.6, fontWeight: 300 }}>{plan.desc}</div>
              </div>
              <div style={{ padding: "22px 26px", borderBottom: `1px solid ${C.border}` }}>
                <PlanPrice plan={plan} billing={billing} />
              </div>
              <div style={{ padding: "22px 26px", flex: 1 }}>
                {plan.features.map((group) => (
                  <div key={group.group} style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontFamily: C.mono,
                        fontSize: 9,
                        color: C.dim,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        marginBottom: 8,
                        paddingBottom: 6,
                        borderBottom: `1px solid ${C.border}`
                      }}
                    >
                      {group.group}
                    </div>
                    {group.items.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "5px 0",
                          fontSize: 13,
                          lineHeight: 1.4,
                          color: item.included ? C.text : C.dim
                        }}
                      >
                        <span style={{ color: item.included ? C.green : C.dim, flexShrink: 0 }}>{item.included ? "✓" : "·"}</span>
                        <span>
                          {item.label}
                          {item.note ? (
                            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.dim, marginLeft: 6 }}>({item.note})</span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ padding: "0 26px 26px" }}>
                {plan.ctaHref ? (
                  <a
                    href={plan.ctaHref}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "center",
                      textDecoration: "none",
                      fontFamily: C.sans,
                      border:
                        plan.ctaVariant === "contact"
                          ? `1px solid rgba(124,58,237,0.25)`
                          : plan.ctaVariant === "outline"
                            ? `1px solid ${C.border}`
                            : "none",
                      background:
                        plan.ctaVariant === "primary"
                          ? C.accent
                          : plan.ctaVariant === "contact"
                            ? C.raise
                            : "transparent",
                      color: plan.ctaVariant === "primary" ? "#fff" : plan.ctaVariant === "contact" ? C.accentL : C.mid
                    }}
                  >
                    {plan.ctaLabel}
                  </a>
                ) : (
                  <Link
                    to={plan.ctaTo || "/request-access"}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "center",
                      textDecoration: "none",
                      fontFamily: C.sans,
                      border: plan.ctaVariant === "outline" ? `1px solid ${C.border}` : "none",
                      background: plan.ctaVariant === "primary" ? C.accent : "transparent",
                      color: plan.ctaVariant === "primary" ? "#fff" : C.mid
                    }}
                  >
                    {plan.ctaLabel}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            background: C.raise,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 64
          }}
        >
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.accentL, letterSpacing: "0.14em", marginBottom: 8 }}>A note on overrides</div>
          <div style={{ fontFamily: C.serif, fontSize: 18, color: C.text, marginBottom: 12 }}>
            <em>Overrides are unlimited on every plan.</em>
          </div>
          <p style={{ fontSize: 13, color: C.mid, lineHeight: 1.75, fontWeight: 300, maxWidth: 720 }}>
            The value of an override is the record it creates — the named owner, the written justification, the permanent timestamp. Limiting
            overrides would incentivise teams to find ways around the system rather than through it. Verdikt&apos;s governance model only works
            if every below-threshold decision goes on record. That&apos;s unconditional.
          </p>
        </div>

        <div style={{ marginBottom: 64 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: "clamp(1.5rem, 3vw, 2rem)", marginBottom: 8, textAlign: "center" }}>Compare plans</h2>
          <p style={{ textAlign: "center", color: C.mid, fontSize: 14, marginBottom: 28 }}>Everything in the table below. No footnotes, no hidden limits.</p>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: "left", padding: "12px 10px", width: "35%", color: C.mid, fontWeight: 500 }} />
                  <th style={{ padding: "12px 10px", color: C.mid, fontWeight: 500 }}>Starter</th>
                  <th style={{ padding: "12px 10px", color: C.accentL, fontWeight: 600, background: "rgba(124,58,237,0.06)" }}>Team</th>
                  <th style={{ padding: "12px 10px", color: C.mid, fontWeight: 500 }}>Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, idx) =>
                  row.section ? (
                    <tr key={`s-${row.section}`} style={{ background: C.raise }}>
                      <td colSpan={4} style={{ padding: "10px 12px", fontFamily: C.mono, fontSize: 10, letterSpacing: "0.12em", color: C.accentL }}>
                        {row.section}
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.label || idx} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "10px 12px", color: C.text }}>{row.label}</td>
                      <ComparisonCell val={row.starter} />
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "center",
                          background: "rgba(124,58,237,0.06)",
                          fontFamily: C.mono,
                          fontSize: 12,
                          color: row.team === true ? C.green : row.team === false ? C.dim : C.accentL
                        }}
                      >
                        {row.team === true ? "✓" : row.team === false ? "·" : row.team}
                      </td>
                      <ComparisonCell val={row.enterprise} />
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginBottom: 64 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: "clamp(1.5rem, 3vw, 2rem)", marginBottom: 24, textAlign: "center" }}>Questions</h2>
          <div>
            {FAQS.map((faq, i) => {
              const open = openFaq.has(i);
              const panelId = `pricing-faq-panel-${i}`;
              return (
                <div
                  key={faq.q}
                  style={{
                    borderBottom: `1px solid ${C.border}`
                  }}
                >
                  <button
                    type="button"
                    id={`pricing-faq-trigger-${i}`}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggleFaq(i)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      padding: "16px 0",
                      fontSize: 15,
                      fontWeight: 500,
                      color: C.text,
                      cursor: "pointer",
                      border: "none",
                      background: "transparent",
                      fontFamily: "inherit",
                      textAlign: "left"
                    }}
                  >
                    {faq.q}
                    <span
                      style={{ color: C.mid, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </button>
                  {open ? (
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={`pricing-faq-trigger-${i}`}
                      style={{
                        paddingBottom: 16,
                        fontSize: 14,
                        color: C.mid,
                        lineHeight: 1.7,
                        fontWeight: 300
                      }}
                    >
                      <BoldMarkdownText
                        text={faq.aText}
                        style={{ fontWeight: 300 }}
                        strongStyle={{ fontWeight: 600, color: C.text }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "56px 24px",
          marginBottom: 56,
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
          background: "linear-gradient(180deg, rgba(124,58,237,0.04) 0%, transparent 100%)"
        }}
      >
        <h2 style={{ fontFamily: C.serif, fontSize: "clamp(1.35rem, 2.5vw, 1.75rem)", marginBottom: 12 }}>
          Need enterprise controls later?
          <br />
          <em style={{ color: C.accentL, fontStyle: "italic" }}>Talk to us when you scale.</em>
        </h2>
        <p style={{ color: C.mid, fontSize: 14, maxWidth: 560, margin: "0 auto 28px", lineHeight: 1.75 }}>
          MVP focus is fast time-to-certification for AI product teams. Enterprise controls (SSO, private records, custom retention, custom
          connectors) are available as you scale.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginBottom: 24, fontSize: 12, color: C.mid }}>
          {["SAML/SSO", "Custom retention policy", "Private certification records", "Dedicated support", "Custom signal sources", "Audit log export API"].map(
            (x) => (
              <span key={x} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accentL }} />
                {x}
              </span>
            )
          )}
        </div>
        <a
          href="mailto:hello@useverdikt.com"
          style={{
            display: "inline-block",
            padding: "12px 24px",
            borderRadius: 8,
            background: C.accent,
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
            fontSize: 14
          }}
        >
          Talk to us →
        </a>
      </div>

      <footer
        style={{
          padding: "24px 40px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          borderTop: `1px solid ${C.border}`,
          fontSize: 12,
          color: C.dim,
          fontFamily: C.mono
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: "inherit" }}>
          <span style={{ lineHeight: 0, display: "flex", width: 22, height: 22, flexShrink: 0 }}>
            <VerdiktMark size={22} variant="onDark" />
          </span>
          <span style={{ fontFamily: C.serif, fontWeight: 600, letterSpacing: "-0.02em" }}>Verdikt</span>
        </Link>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <Link to="/" style={{ color: C.mid, textDecoration: "none" }}>
            Product
          </Link>
          <span style={{ color: C.dim }}>Docs</span>
          <span style={{ color: C.dim }}>Privacy</span>
          <span style={{ color: C.dim }}>Terms</span>
          <a href="mailto:hello@useverdikt.com" style={{ color: C.mid, textDecoration: "none" }}>
            hello@useverdikt.com
          </a>
        </div>
        <div>© 2026 Verdikt</div>
      </footer>
    </div>
  );
}
