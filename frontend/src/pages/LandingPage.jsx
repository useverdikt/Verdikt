import React, { useEffect, useRef, memo } from "react";
import { Link } from "react-router-dom";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";
import "./landing/LandingPage.css";

const CONTACT_EMAIL = "hello@useverdikt.com";

const SignInLink = memo(function SignInLink() {
  return (
    <Link to="/login" aria-label="Open sign in page" className="nav-signin">
      Sign in
    </Link>
  );
});

export default memo(function LandingPage() {
  const navRef = useRef(null);
  const rootRef = useRef(null);
  const terminalBodyRef = useRef(null);
  const cursorRef = useRef(null);

  // document title
  useEffect(() => {
    const prev = document.title;
    document.title = "Verdikt — Ship AI Agents with Evidence, Not Hope";
    return () => { document.title = prev; };
  }, []);

  // smooth anchor scroll (matches static verdikt landing HTML)
  useEffect(() => {
    const prev = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "smooth";
    return () => { document.documentElement.style.scrollBehavior = prev || ""; };
  }, []);

  // SEO meta tags
  useEffect(() => {
    const metas = [
      { name: "description", content: "Ship AI agents with evidence, not hope. Verdikt is the trust layer between AI agents and production: gate releases, track bypasses, and learn from production outcomes." },
      { property: "og:title", content: "Verdikt — Ship AI Agents with Evidence, Not Hope" },
      { property: "og:description", content: "Gate AI-agent releases, track bypasses, and calibrate thresholds from production outcomes." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Verdikt — Ship AI Agents with Evidence, Not Hope" },
      { name: "twitter:description", content: "Gate AI-agent releases, track bypasses, and calibrate thresholds from production outcomes." },
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
    return () => { added.forEach(({ el, created }) => { if (created && el.parentNode) el.parentNode.removeChild(el); }); };
  }, []);

  // nav scroll effect
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // scroll reveal
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = root.querySelectorAll(".reveal");
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px 60px 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // terminal animation — same logic as static HTML (terminal hidden ≤900px via CSS only)
  useEffect(() => {
    const terminalBody = terminalBodyRef.current;
    const cursor = cursorRef.current;
    if (!terminalBody || !cursor) return;

    let cancelled = false;
    let currentTimer = null;

    const lines = [
      { text: "$ verdikt evaluate --release v2.14.0 --env production", cls: "t-prompt" },
      { text: "" },
      { text: "  fetching workspace thresholds...", cls: "t-dim", delay: 400 },
      { text: "  running signal evaluation...", cls: "t-dim", delay: 200 },
      { text: "" },
      { text: "  signal              value     threshold    status", cls: "t-dim" },
      { text: "  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", cls: "t-sep" },
      { text: "  accuracy            91.2%     \u2265 85%        PASS  \u2713", cls: "t-pass", delay: 300 },
      { text: "  relevance           88.4%     \u2265 82%        PASS  \u2713", cls: "t-pass", delay: 250 },
      { text: "  hallucination       12.1%     \u2264 10%        FAIL  \u2717", cls: "t-fail", delay: 300 },
      { text: "  latency p95         842ms     \u2264 800ms      WARN  \u26a0", cls: "t-warn", delay: 250 },
      { text: "  safety              99.1%     \u2265 95%        PASS  \u2713", cls: "t-pass", delay: 200 },
      { text: "" },
      { text: "  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", cls: "t-sep" },
      { text: "" },
      { text: "  verdict      UNCERTIFIED", cls: "t-verdict", delay: 500 },
      { text: "  confidence   73%  MEDIUM", cls: "t-confidence", delay: 200 },
      { text: "" },
      { text: "  1 signal failed threshold.", cls: "t-dim", delay: 100 },
      { text: "  1 signal approaching limit \u2014 early warning issued.", cls: "t-dim", delay: 100 },
      { text: "" },
      { text: "  \u2192 address hallucination rate before promoting.", cls: "t-action", delay: 300 },
      { text: "  \u2192 monitor latency \u2014 currently 5% above threshold.", cls: "t-action", delay: 150 },
    ];

    let lineIndex = 0;

    function addLine(line) {
      if (cancelled) return;
      const span = document.createElement("span");
      span.className = "t-line " + (line.cls || "t-dim");
      span.textContent = line.text;
      terminalBody.insertBefore(span, cursor);
    }

    function animateLines() {
      if (cancelled) return;
      if (lineIndex >= lines.length) {
        currentTimer = setTimeout(() => {
          if (cancelled) return;
          const existing = terminalBody.querySelectorAll(".t-line");
          existing.forEach((el) => el.remove());
          lineIndex = 0;
          animateLines();
        }, 6000);
        return;
      }
      const line = lines[lineIndex];
      const delay = line.delay || 120;
      currentTimer = setTimeout(() => {
        if (cancelled) return;
        addLine(line);
        lineIndex++;
        animateLines();
      }, delay);
    }

    function stopAnimation() {
      cancelled = true;
      if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = null;
      }
      terminalBody.querySelectorAll(".t-line").forEach((el) => el.remove());
      lineIndex = 0;
    }

    cancelled = false;
    currentTimer = setTimeout(animateLines, 800);
    return () => {
      stopAnimation();
    };
  }, []);

  return (
    <div className="vdk-landing" ref={rootRef}>

      {/* ── NAV ── */}
      <nav ref={navRef} id="nav">
        <Link to="/" className="logo" aria-label="Verdikt home">
          <span className="logo-mark" aria-hidden>
            <VerdiktMark size={32} variant="onDark" />
          </span>
          <span className="logo-name">Verdikt</span>
        </Link>
        <div className="nav-links">
          <a href="#diagnostic">The question</a>
          <a href="#how">How it works</a>
          <a href="#truth">Production truth</a>
          <a href="#record">The record</a>
          <a href="https://docs.useverdikt.com">Docs</a>
        </div>
        <SignInLink />
        <Link to="/request-access" className="nav-cta">Get early access →</Link>
      </nav>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              The trust layer between AI agents and production
            </div>
            <h1>
              Ship AI agents with evidence,<br />
              <em>not hope.</em>
            </h1>
            <p className="hero-body">
              Verdikt evaluates agent releases, records the signals behind every decision, and tells
              you when human oversight is required.
            </p>
            <p className="hero-tagline">Know when to trust your agents before they reach production.</p>
            <div className="hero-actions">
              <Link to="/request-access" className="btn-primary">
                Get early access
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
            <div className="hero-note">
              Works alongside <strong>Braintrust</strong>, <strong>LangSmith</strong>, any CI pipeline.<br />
              MCP tools for <strong>Cursor</strong> and <strong>Claude Code</strong> — published as <strong>@useverdikt/mcp</strong>.<br />
              HTTP API for GitHub Actions.<br />
              No changes to your eval stack.
            </div>
          </div>

          <div className="terminal" id="terminal" aria-label="Live evaluation example" role="img">
            <div className="terminal-bar">
              <div className="tbar-dot" />
              <div className="tbar-dot" />
              <div className="tbar-dot" />
              <div className="terminal-title">verdikt · evaluation</div>
            </div>
            <div className="terminal-body" id="terminal-body" ref={terminalBodyRef}>
              <span className="t-cursor" id="cursor" ref={cursorRef} />
            </div>
          </div>
        </div>
      </section>

      {/* ── DIAGNOSTIC ── */}
      <section className="diagnostic" id="diagnostic">
        <div className="diagnostic-inner">
          <div className="section-rule reveal">The question</div>
          <p className="diagnostic-prompt reveal reveal-delay-1">
            If production degrades tomorrow, can you immediately answer:
          </p>
          <ul className="diagnostic-questions" aria-label="Diagnostic questions">
            <li className="reveal reveal-delay-1">
              <span className="q-num">01</span>
              <span className="q-text">What were the eval scores the moment it shipped?</span>
            </li>
            <li className="reveal reveal-delay-2">
              <span className="q-num">02</span>
              <span className="q-text">What was the confidence level — and which signals drove it?</span>
            </li>
            <li className="reveal reveal-delay-2">
              <span className="q-num">03</span>
              <span className="q-text">Were any signals below threshold when the team approved anyway?</span>
            </li>
            <li className="reveal reveal-delay-3">
              <span className="q-num">04</span>
              <span className="q-text">Who accepted the risk, and what justification did they file?</span>
            </li>
            <li className="reveal reveal-delay-3">
              <span className="q-num">05</span>
              <span className="q-text">Did the system&apos;s prediction match what actually happened in production?</span>
            </li>
          </ul>
          <p className="diagnostic-verdict reveal reveal-delay-4">
            If the answer to any of these is <em>&quot;I&apos;d have to check&quot;</em> — that&apos;s the gap.<br />
            <strong>Verdikt closes it.</strong>
          </p>
        </div>
      </section>

      {/* ── HOW ── */}
      <section className="how" id="how">
        <div className="how-inner">
          <div className="section-rule reveal">How it works</div>
          <h2 className="reveal reveal-delay-1">
            Four steps.<br /><em>One closed loop.</em>
          </h2>
          <p className="section-body reveal reveal-delay-2">
            Every release moves through the same four stages — ingest, evaluate, verdict, validate.
          </p>
          <div className="pipeline reveal reveal-delay-3">
            <div className="pipeline-step">
              <div className="step-num">01</div>
              <div className="step-tag signals">Signals</div>
              <div className="step-title">Ingest</div>
              <div className="step-body">
                Add <strong>verdikt:rc</strong> to the PR, or push signals via API, MCP, or CSV.
              </div>
            </div>
            <div className="pipeline-step">
              <div className="step-num">02</div>
              <div className="step-tag evaluate">Evaluate</div>
              <div className="step-title">Evaluate</div>
              <div className="step-body">
                Weighed against your thresholds — missing metrics flagged, not skipped.
              </div>
            </div>
            <div className="pipeline-step">
              <div className="step-num">03</div>
              <div className="step-tag verdict">Verdict</div>
              <div className="step-title">Decide</div>
              <div className="step-body">
                Collect signals, then <strong>CERTIFIED</strong>, <strong>UNCERTIFIED</strong>, or{" "}
                <strong>CERTIFIED WITH OVERRIDE</strong>. Certified records are signed.
              </div>
            </div>
            <div className="pipeline-step">
              <div className="step-num">04</div>
              <div className="step-tag align">Align</div>
              <div className="step-title">Validate</div>
              <div className="step-body">
                Post-deploy: scored <strong>CORRECT</strong>, <strong>MISS</strong>, or <strong>CAUTIOUS</strong> —
                then fed into threshold suggestions for the next release.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUTH LOOP ── */}
      <section className="truth" id="truth">
        <div className="truth-inner">
          <div className="section-rule reveal">Production truth</div>
          <div className="truth-layout">
            <div className="truth-copy reveal reveal-delay-1">
              <h2>
                The gate does not<br /><em>trust itself either.</em>
              </h2>
              <p className="section-body">
                Branch protection can be bypassed. Verdikt records what actually reaches production — not
                just what cleared the gate — so a bypass never disappears from the record.
              </p>
            </div>
            <div className="truth-grid reveal reveal-delay-2">
              <div className="truth-card bypass">
                <div className="truth-card-kicker">Bypass tracking</div>
                <h3>Production is the source of truth.</h3>
                <p>
                  If code ships without certification, Verdikt freezes that fact at merge time and marks the
                  release as live risk — even if someone certifies it later.
                </p>
              </div>
              <div className="truth-card calibration">
                <div className="truth-card-kicker">Calibration loop</div>
                <h3>Outcomes tune the next gate.</h3>
                <p>
                  Post-deploy results are classified as correct, miss, or cautious and converted into
                  suggested threshold changes. Humans review by default — calibration does not silently
                  auto-apply.
                </p>
              </div>
              <div className="truth-card agents">
                <div className="truth-card-kicker">Agent-native</div>
                <h3>Agents get an action, not a paragraph.</h3>
                <p>
                  MCP and HTTP gates return <strong>merge</strong>, <strong>collecting</strong>,{" "}
                  <strong>self_heal</strong>, or <strong>escalate</strong>, with agent sessions and audit
                  events tied back to the release record.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── RECORD ── */}
      <section className="record" id="record">
        <div className="record-inner">
          <div className="section-rule reveal">The record</div>
          <div className="record-layout">
            <div className="record-copy reveal reveal-delay-1">
              <h2>Verdikt recommends.<br /><em>Humans decide.</em><br />Every call gets a record.</h2>
              <p className="section-body">
                Override and bypass are different paths. Certifying with override despite failing signals
                requires a human justification and a signed record. Merging without certification freezes
                that bypass at merge time — no override required, but the live risk stays on the record.
              </p>
              <div className="record-detail">
                <strong>What the record contains:</strong> release ID, verdict at time of decision,
                every signal value and threshold, confidence score, override justification when filed,
                approver identity, and timestamp — frozen at decision time on an append-only audit trail.
                Production outcome appended after deploy.
              </div>
            </div>
            <div className="cert-card reveal reveal-delay-2">
              <div className="cert-card-header">
                <div className="cert-badge">
                  <div className="cert-badge-dot" />
                  CERTIFIED WITH OVERRIDE
                </div>
                <div className="cert-release">v2.11.0-rc1</div>
              </div>
              <div className="cert-body">
                <div className="cert-field">
                  <div className="cert-label">Failed signals at time of override</div>
                  <div>
                    <div className="cert-signal">
                      <span className="sig-name">hallucination_rate</span>
                      <span className="sig-values">14.2% <span className="sig-thresh">threshold ≤ 10%</span></span>
                    </div>
                    <div className="cert-signal">
                      <span className="sig-name">latency_p95</span>
                      <span className="sig-values">1,240ms <span className="sig-thresh">threshold ≤ 800ms</span></span>
                    </div>
                  </div>
                </div>
                <div className="cert-field">
                  <div className="cert-label">Confidence at override</div>
                  <div className="cert-confidence">
                    <span className="conf-score">68%</span>
                    <span className="conf-band">MEDIUM</span>
                  </div>
                </div>
                <div className="cert-field">
                  <div className="cert-label">Justification filed</div>
                  <div className="cert-justification">
                    Hallucination spike is contained to the new summarisation prompt.
                    Latency regression is infra-side and will resolve within the hour.
                    Safety and accuracy signals remain nominal. Accepting and monitoring.
                  </div>
                </div>
                <div className="cert-field">
                  <div className="cert-label">Approver</div>
                  <div className="cert-value">Kenneth Braun · VP Engineering</div>
                </div>
                <div className="cert-stamp-row">
                  <div className="cert-stamp">
                    <div className="cert-stamp-dot" />
                    CERTIFIED WITH OVERRIDE
                  </div>
                  <div className="cert-immutable">record sealed · cannot be edited</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-section" id="cta">
        <div className="cta-inner">
          <div className="cta-eyebrow reveal">Early access</div>
          <h2 className="reveal reveal-delay-1">
            First agent. First verdict. First record.<br />
            <em>The loop starts with your first deploy.</em>
          </h2>
          <p className="cta-sub reveal reveal-delay-2">
            Closed beta — onboarding design partner teams in small batches.
            Connect Verdikt to GitHub and your eval stack. Define thresholds.
            Your agents handle the rest. Humans only when it genuinely matters.
          </p>
          <Link to="/request-access" className="cta-btn reveal reveal-delay-3">
            Get early access
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <p className="cta-note reveal reveal-delay-4">
            Questions about deployment?{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} aria-label="Contact Verdikt by email">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer>
        <div className="footer-inner">
          <Link to="/" className="logo" aria-label="Verdikt home">
            <span className="logo-mark" aria-hidden>
              <VerdiktMark size={32} variant="onDark" />
            </span>
            <span className="logo-name">Verdikt</span>
          </Link>
          <div className="footer-links">
            <a href="#diagnostic" aria-label="Jump to the question section">The question</a>
            <a href="#how" aria-label="Jump to how it works">How it works</a>
            <a href="#truth" aria-label="Jump to production truth">Production truth</a>
            <a href="#record" aria-label="Jump to the record section">The record</a>
            <a href="https://docs.useverdikt.com" aria-label="Verdikt documentation">Docs</a>
            <a href={`mailto:${CONTACT_EMAIL}`} aria-label="Email Verdikt">{CONTACT_EMAIL}</a>
          </div>
          <div className="footer-copy">© 2026 Verdikt · Evidence, not hope</div>
        </div>
      </footer>

    </div>
  );
});
