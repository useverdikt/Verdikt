import React, { useEffect, useRef, memo } from "react";
import { Link } from "react-router-dom";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";
import "./landing/LandingPage.css";

const CONTACT_EMAIL = "hello@useverdikt.com";
const DOCS_INTRO = "https://docs.useverdikt.com/introduction";
const PAGE_TITLE = "Verdikt and the EU AI Act";
const PAGE_DESCRIPTION =
  "How Verdikt's audit trail, overrides, and incident tracking map to Articles 12, 14, and 73.";

const ROWS = [
  {
    article: "Article 12 — Record-keeping",
    law: "High-risk systems must automatically log events over their lifetime, so risks and incidents can be traced back after the fact.",
    verdikt:
      "Every verdict, signal, threshold, and override is written to an append-only, hash-chained audit trail — frozen at the moment of decision, never editable after.",
  },
  {
    article: "Article 14 — Human oversight",
    law: "A human must be able to intervene in, and be accountable for, high-risk system decisions.",
    verdikt:
      "Every override requires a named approver and a written justification. Bypassed releases are flagged permanently, never silently absorbed.",
  },
  {
    article: "Article 73 — Serious incident reporting",
    law: "Providers must be able to identify and report serious incidents within strict deadlines — as fast as 2 days for the most serious cases.",
    verdikt:
      "Post-deploy monitoring compares what was certified against what actually happened in production, and flags incidents against the release that caused them.",
  },
];

export default memo(function EuAiActPage() {
  const navRef = useRef(null);

  useEffect(() => {
    const prev = document.title;
    document.title = `${PAGE_TITLE} — Verdikt`;
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    const metas = [
      { name: "description", content: PAGE_DESCRIPTION },
      { property: "og:title", content: `${PAGE_TITLE} — Verdikt` },
      { property: "og:description", content: PAGE_DESCRIPTION },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: `${PAGE_TITLE} — Verdikt` },
      { name: "twitter:description", content: PAGE_DESCRIPTION },
    ];
    const added = metas.map((attrs) => {
      const selector = attrs.name ? `meta[name="${attrs.name}"]` : `meta[property="${attrs.property}"]`;
      let el = document.head.querySelector(selector);
      const created = !el;
      if (created) {
        el = document.createElement("meta");
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        document.head.appendChild(el);
      }
      return { el, created };
    });
    return () => {
      added.forEach(({ el, created }) => {
        if (created && el.parentNode) el.parentNode.removeChild(el);
      });
    };
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="vdk-landing">
      <nav ref={navRef} id="nav">
        <Link to="/" className="logo" aria-label="Verdikt home">
          <span className="logo-mark" aria-hidden>
            <VerdiktMark size={32} variant="onDark" />
          </span>
          <span className="logo-name">Verdikt</span>
        </Link>
        <div className="nav-links">
          <Link to="/">Product</Link>
          <a href="https://docs.useverdikt.com">Docs</a>
          <span aria-current="page">EU AI Act</span>
        </div>
        <Link to="/login" aria-label="Open sign in page" className="nav-signin">
          Sign in
        </Link>
        <Link to="/request-access" className="nav-cta">
          Get early access →
        </Link>
      </nav>

      <article className="eu-act">
        <p className="eu-act-kicker">EU AI Act · Articles 12, 14, and 73</p>
        <h1>Verdikt and the EU AI Act</h1>
        <p className="eu-act-lead">
          Verdikt&apos;s audit trail and override system map to key EU AI Act obligations for high-risk AI
          systems.
        </p>
        <p>
          High-risk obligations under Articles 8–17, 26, 27, and 73 became applicable on{" "}
          <strong>2 August 2026</strong>. Three of those requirements map closely to things Verdikt already
          does.
        </p>
        <p>
          This page shows the mapping. It is not legal advice, and using Verdikt does not by itself make a
          system compliant — see{" "}
          <a href="#what-this-page-is-not">What this page is not</a> below.
        </p>

        <h2>The mapping</h2>
        <div className="eu-act-table-wrap">
          <table>
            <caption className="sr-only">EU AI Act requirements mapped to Verdikt features</caption>
            <thead>
              <tr>
                <th scope="col">Requirement</th>
                <th scope="col">What the law asks for</th>
                <th scope="col">What Verdikt does today</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.article}>
                  <th scope="row">{row.article}</th>
                  <td>{row.law}</td>
                  <td>{row.verdikt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>What this actually looks like</h2>
        <p>
          <strong>Article 12, in practice:</strong> open any certified release in Verdikt and you can see
          exactly what was known at the moment it shipped — every signal, every threshold, every value —
          frozen and unchangeable, even if your thresholds change later.
        </p>
        <p>
          <strong>Article 14, in practice:</strong> if a release ships despite failing signals, Verdikt
          requires a name, a role, and a reason before it certifies. That record cannot be edited, not even
          by an administrator.
        </p>
        <p>
          <strong>Article 73, in practice:</strong> Verdikt watches what happens after a release ships and
          links production incidents back to the specific release and the specific decision that shipped it
          — the starting point for any incident report.
        </p>

        <h2 id="what-this-page-is-not">What this page is not</h2>
        <div className="eu-act-disclaimer">
          <p>
            Verdikt covers <em>parts</em> of Article 12 and Article 14, and supports the evidence trail
            behind Article 73 reporting. It does not cover the full scope of any of these articles, and it
            does not cover risk management, technical documentation, data governance, or the other
            obligations under the Act.
          </p>
          <p>
            This page describes a mapping, not a compliance guarantee. Whether your specific system is in
            scope, and what your specific obligations are, is a legal question — talk to your own counsel.
          </p>
        </div>

        <p className="eu-act-cta">
          <strong>See how it works:</strong>{" "}
          <Link to="/request-access">request access</Link> or read the{" "}
          <a href={DOCS_INTRO}>product overview</a>.
        </p>
      </article>

      <footer>
        <div className="footer-inner">
          <Link to="/" className="logo" aria-label="Verdikt home">
            <span className="logo-mark" aria-hidden>
              <VerdiktMark size={32} variant="onDark" />
            </span>
            <span className="logo-name">Verdikt</span>
          </Link>
          <div className="footer-links">
            <Link to="/">Product</Link>
            <span aria-current="page">EU AI Act</span>
            <a href="https://docs.useverdikt.com" aria-label="Verdikt documentation">
              Docs
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`} aria-label="Email Verdikt">
              {CONTACT_EMAIL}
            </a>
          </div>
          <div className="footer-copy">© 2026 Verdikt · Evidence, not hope</div>
        </div>
      </footer>
    </div>
  );
});
