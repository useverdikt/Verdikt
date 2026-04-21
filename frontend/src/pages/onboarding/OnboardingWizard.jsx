import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSafeApiBase } from "../../lib/apiBase.js";
import { primaryCertEnvFromTiers } from "../../lib/projectEnv.js";
import { createInitialOnboardingState, RTYPES, STEPS, THRESHOLD_PRESETS } from "./onboardingConstants.js";
import { applyAISuggestionsToThresh, calcV } from "./onboardingUtils.js";
import { ChevronBack, ChevronNext, InvitationClosed } from "./wizardChrome.jsx";
import { VerdiktMark } from "../../components/brand/VerdiktMark.jsx";
import WelcomeStep from "./steps/WelcomeStep.jsx";
import WorkspaceStep from "./steps/WorkspaceStep.jsx";
import ReleaseTypesStep from "./steps/ReleaseTypesStep.jsx";
import FirstReleaseStep from "./steps/FirstReleaseStep.jsx";
import CertificationStep from "./steps/CertificationStep.jsx";
import AccountStep from "./steps/AccountStep.jsx";

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [st, setSt] = useState(createInitialOnboardingState);
  const [regError, setRegError] = useState("");
  const [regStatus, setRegStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBtnDone, setAiBtnDone] = useState(false);
  const [suggestBtnDone, setSuggestBtnDone] = useState(false);
  const [registrationGate, setRegistrationGate] = useState("loading");
  const stepContentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const API_BASE = getSafeApiBase();
    fetch(`${API_BASE}/api/public/registration`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRegistrationGate(d.allow_public_registration ? "open" : "closed");
      })
      .catch(() => {
        if (!cancelled) setRegistrationGate("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    stepContentRef.current?.scrollTo?.(0, 0);
  }, [st.step]);

  const pct = Math.round((st.step / (STEPS.length - 1)) * 100);

  const availRT = useMemo(() => RTYPES.filter((r) => st.rtypes.includes(r.id)), [st.rtypes]);

  const verdict = useMemo(() => calcV(st.rel, st.thresh), [st.rel, st.thresh]);

  const canProceed = useMemo(() => {
    const checks = [
      () => true,
      () =>
        st.ws.org.trim().length > 0 &&
        (st.ws.project || "").trim().length > 0 &&
        Array.isArray(st.ws.certEnvs) &&
        st.ws.certEnvs.length > 0,
      () => st.rtypes.length > 0,
      () => st.rel.version.trim().length > 0,
      () => true,
      () => {
        const email = st.email.trim().toLowerCase();
        const emailOk = email.includes("@") && email.length > 3;
        return (
          st.user.name.trim().length > 1 &&
          emailOk &&
          typeof st.password === "string" &&
          st.password.length >= 8 &&
          st.password === st.password2
        );
      }
    ];
    return checks[st.step]?.() ?? false;
  }, [st]);

  const footerHint = useMemo(() => {
    const hints = [
      "Try the demo or set up your workspace",
      "Enter organisation and project name to continue",
      `${st.rtypes.length} release type${st.rtypes.length !== 1 ? "s" : ""} selected`,
      "Set sources & thresholds, then enter signals or load demo data",
      "One more step — identify yourself",
      st.user.name.trim().length > 1
        ? `Entering as ${st.user.name}`
        : "Enter your name and account details to continue"
    ];
    return hints[st.step] || "";
  }, [st]);

  if (registrationGate === "loading") {
    return (
      <div
        className="shell"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg, #0a0d12)",
          color: "var(--dim, #6e87a2)"
        }}
      >
        Loading…
      </div>
    );
  }

  if (registrationGate === "closed" || registrationGate === "error") {
    return <InvitationClosed mode={registrationGate} />;
  }

  function goToStep(i) {
    if (i < st.step) setSt((s) => ({ ...s, step: i }));
  }

  function next() {
    setRegError("");
    if (st.step === 0) {
      setSt((s) => ({ ...s, step: 1 }));
      return;
    }
    if (st.step < STEPS.length - 1) {
      setSt((s) => ({ ...s, step: s.step + 1 }));
      return;
    }
    void finish();
  }

  async function finish() {
    setBusy(true);
    setRegStatus("");
    setRegError("");
    const API_BASE = getSafeApiBase();
    const body = {
      email: st.email.trim().toLowerCase(),
      password: st.password,
      name: st.user.name.trim() || undefined
    };
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegError(typeof data.error === "string" ? data.error : "Registration failed");
        setBusy(false);
        return;
      }
      try {
        const primary = primaryCertEnvFromTiers(st.ws.certEnvs);
        localStorage.setItem(
          "vdk3_project",
          JSON.stringify({
            name: st.ws.project,
            feature: "",
            env: primary.toUpperCase(),
            certEnvs: st.ws.certEnvs.map((e) => e.toUpperCase()),
            prodObservation: st.ws.prodObservation
          })
        );
        localStorage.setItem("vdk3_org", st.ws.org);
      } catch {
        /* non-fatal */
      }
      setRegStatus(typeof data.message === "string" ? data.message : "Continue to sign in.");
      setBusy(false);
      navigate("/login", { replace: true, state: { registeredHint: true } });
    } catch (err) {
      setRegError(`Cannot reach the API. Is the backend running? (${String(err?.message || err)})`);
      setBusy(false);
    }
  }

  function prev() {
    if (st.step > 0) setSt((s) => ({ ...s, step: s.step - 1 }));
  }

  function skip() {
    navigate("/releases");
  }

  function runQuickDemo() {
    setSt((s) => ({
      ...s,
      ws: { ...s.ws, org: "Demo Organisation", project: "Demo Project", certEnvs: ["uat"], prodObservation: false },
      rel: {
        ...s.rel,
        version: "v3.2.0",
        rtype: "model_update",
        sigs: {
          smoke: { rate: 100, severity: "none" },
          e2e_regression: { rate: 97, severity: "P4" },
          startup: 2.4,
          screenload: 1.1,
          fps: 61,
          jserrors: 0.2,
          p95latency: 218,
          p99latency: 445,
          errorunderload: 0.4,
          recovery: 18,
          crashrate: 0.08,
          anrrate: 0.03,
          errorrate: 0.6,
          oomrate: 0.1,
          accuracy: 91,
          safety: 94,
          tone: 90,
          hallucination: 96,
          relevance: 85
        }
      },
      step: 4
    }));
    setAiBtnDone(false);
    setSuggestBtnDone(false);
  }

  function toggleRT(id) {
    setSt((s) => {
      const i = s.rtypes.indexOf(id);
      const rtypes = i >= 0 ? s.rtypes.filter((x) => x !== id) : [...s.rtypes, id];
      return { ...s, rtypes };
    });
  }

  function setSig(id, v) {
    setSt((s) => ({
      ...s,
      rel: { ...s.rel, sigs: { ...s.rel.sigs, [id]: v } }
    }));
  }

  function setRT(rt) {
    setSt((s) => ({ ...s, rel: { ...s.rel, rtype: rt } }));
  }

  function loadDemo() {
    setSt((s) => ({
      ...s,
      rel: {
        ...s.rel,
        sigs: {
          smoke: { rate: 100, severity: "none" },
          e2e_regression: { rate: 97, severity: "P4" },
          startup: 2.4,
          screenload: 1.1,
          fps: 61,
          jserrors: 0.2,
          p95latency: 218,
          p99latency: 445,
          errorunderload: 0.4,
          recovery: 18,
          crashrate: 0.08,
          anrrate: 0.03,
          errorrate: 0.6,
          oomrate: 0.1,
          accuracy: 91,
          safety: 94,
          tone: 90,
          hallucination: 96,
          relevance: 85
        }
      }
    }));
    setAiBtnDone(false);
    setSuggestBtnDone(false);
  }

  function setThresholdProfile(profileId) {
    if (!THRESHOLD_PRESETS[profileId]) return;
    setSt((s) => ({
      ...s,
      profile: profileId,
      thresh: { ...THRESHOLD_PRESETS[profileId].thresholds }
    }));
    setSuggestBtnDone(false);
    setAiBtnDone(false);
  }

  function resetSuggestedThresholds() {
    setSt((s) => ({
      ...s,
      thresh: { ...THRESHOLD_PRESETS[s.profile].thresholds }
    }));
    setSuggestBtnDone(true);
  }

  function applyAISuggestions() {
    setSt((s) => ({ ...s, thresh: applyAISuggestionsToThresh(s.thresh) }));
    setAiBtnDone(true);
  }

  function toggleOpenCat(catId) {
    setSt((s) => ({
      ...s,
      openCats: { ...s.openCats, [catId]: !s.openCats[catId] }
    }));
  }

  function updateThresh(key, val) {
    setSt((s) => ({ ...s, thresh: { ...s.thresh, [key]: val } }));
  }

  function setSource(sourceId) {
    setSt((s) => ({ ...s, source: sourceId }));
  }

  const nextLabel =
    st.step === 0 ? (
      <>
        Set up my workspace <ChevronNext />
      </>
    ) : st.step < STEPS.length - 1 ? (
      <>
        Continue <ChevronNext />
      </>
    ) : (
      <>
        Enter dashboard <ChevronNext />
      </>
    );

  const nextClass =
    st.step === STEPS.length - 1 && canProceed ? "btn-next green" : "btn-next";

  const stepPanel = (
    <div className="step-panel" key={st.step}>
      {st.step === 0 && (
        <WelcomeStep onQuickDemo={runQuickDemo} onGoToWorkspace={() => setSt((s) => ({ ...s, step: 1 }))} />
      )}
      {st.step === 1 && <WorkspaceStep st={st} setSt={setSt} />}
      {st.step === 2 && <ReleaseTypesStep st={st} toggleRT={toggleRT} />}
      {st.step === 3 && (
        <FirstReleaseStep
          st={st}
          setSt={setSt}
          availRT={availRT}
          loadDemo={loadDemo}
          setSig={setSig}
          setRT={setRT}
          updateThresh={updateThresh}
          toggleOpenCat={toggleOpenCat}
          setThresholdProfile={setThresholdProfile}
          resetSuggestedThresholds={resetSuggestedThresholds}
          applyAISuggestions={applyAISuggestions}
          setSource={setSource}
          aiBtnDone={aiBtnDone}
          suggestBtnDone={suggestBtnDone}
        />
      )}
      {st.step === 4 && <CertificationStep st={st} verdict={verdict} />}
      {st.step === 5 && (
        <AccountStep st={st} setSt={setSt} regError={regError} regStatus={regStatus} />
      )}
    </div>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="sidebar-logo" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="logo-mark">
            <VerdiktMark size={30} variant="onDark" />
          </div>
          <div>
            <div className="logo-name">Verdikt</div>
            <div className="logo-tag">Setup</div>
          </div>
        </Link>
        <nav className="steps-nav" aria-label="Onboarding steps">
          {STEPS.map((s, i) => {
            const done = i < st.step;
            const active = i === st.step;
            const content = (
              <>
                <div className={`step-node ${done ? "done" : ""} ${active ? "active" : ""}`}>
                  {done ? (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path
                        d="M2 5.5l2.5 2.5 4.5-4.5"
                        stroke="#fff"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                  {active ? (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <circle cx="5.5" cy="5.5" r="2.5" fill="#fff" />
                    </svg>
                  ) : null}
                  {!done && !active ? <span className="step-num">{i + 1}</span> : null}
                </div>
                <div className="step-connector" />
                <div className="step-info">
                  <div className="step-label">{s.label}</div>
                  {active || done ? <div className="step-sublabel">{s.sub}</div> : null}
                </div>
              </>
            );
            return done ? (
              <button
                key={s.id}
                type="button"
                className={`step-item done ${active ? "active" : ""}`}
                onClick={() => goToStep(i)}
                aria-label={`${s.label}: ${s.sub}. Go to this step.`}
              >
                {content}
              </button>
            ) : (
              <div key={s.id} className={`step-item ${active ? "active" : ""}`} aria-current={active ? "step" : undefined}>
                {content}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="progress-row">
            <div className="progress-label">PROGRESS</div>
            <div className="progress-pct">{pct}%</div>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: "var(--dim)" }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color: "var(--accent)", textDecoration: "none" }}>
              Sign in →
            </Link>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="main-header">
          <div className="header-step">
            Step <span>{st.step + 1}</span> of {STEPS.length} — {STEPS[st.step].label}
          </div>
          <button type="button" className="skip-btn" onClick={skip}>
            Skip setup →
          </button>
        </div>
        <div className="step-content" ref={stepContentRef}>
          {stepPanel}
        </div>
        <div className="main-footer">
          <button type="button" className="btn-back" onClick={prev} disabled={st.step === 0}>
            <ChevronBack />
            Back
          </button>
          <div className="footer-hint">{footerHint}</div>
          <button
            type="button"
            className={nextClass}
            onClick={next}
            disabled={!canProceed || busy}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
