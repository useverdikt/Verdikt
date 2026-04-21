import React from "react";
import { CATS } from "../onboardingConstants.js";
import { evalSig, fmt, regReqd } from "../onboardingUtils.js";

export default function CertificationStep({ st, verdict }) {
  const { ok, fail } = verdict;
  const reqd = regReqd(st.rel.rtype);
  const proj = st.ws.org || "your organisation";
  const sigs = [];
  CATS.forEach((cat) =>
    cat.sigs.forEach((sig) => {
      const v = st.rel.sigs[sig.id];
      const waived = sig.cond && reqd === false;
      if (waived) {
        sigs.push({ label: sig.label, status: "waived", val: "WAIVED" });
        return;
      }
      if (v === undefined || v === null) return;
      const pass = evalSig(sig, v, st.thresh[sig.id]);
      sigs.push({ label: sig.label, status: pass ? "pass" : "fail", val: fmt(sig, v) });
    })
  );
  return (
    <>
      <div className="step-eyebrow">Step 5 of 6</div>
      <div className="verdict-wrap">
        <div className={`verdict-orb ${ok ? "v-certified" : "v-uncertified"}`}>{ok ? "⊕" : "⊗"}</div>
        <div className="verdict-state-label" style={{ color: ok ? "var(--green)" : "var(--red)" }}>
          {ok ? "CERTIFIED" : "UNCERTIFIED"}
        </div>
        <h1 className="verdict-headline display">
          {ok
            ? `Preview: ${st.rel.version} would be certified.`
            : `Preview: ${st.rel.version} needs attention.`}
        </h1>
        <p className="verdict-body">
          {ok
            ? `This preview uses demo values for your selected setup. All signals passed against your defined thresholds, so ${proj} would be certified.`
            : `${fail.length} signal${fail.length > 1 ? "s are" : " is"} below threshold. The release is UNCERTIFIED. You can still ship — but it requires a named override on permanent record.`}
        </p>
        <div className="verdict-sigs">
          {sigs.slice(0, 12).map((s, idx) => (
            <div key={`${s.label}-${idx}`} className="vsig">
              <div className={`vsig-dot ${s.status}`} />
              <span className="vsig-name">{s.label}</span>
              <span className="vsig-val">{s.val}</span>
            </div>
          ))}
          {sigs.length > 12 ? (
            <div className="vsig" style={{ color: "var(--dim)" }}>
              +{sigs.length - 12} more
            </div>
          ) : null}
        </div>
        <div className="verdict-record">
          <div className="record-dot" />
          <span>
            This is a setup preview. Once real release data is ingested, every future release for{" "}
            <strong style={{ color: "var(--text)" }}>{proj}</strong> will be measured against the thresholds you
            just defined.
          </span>
        </div>
      </div>
    </>
  );
}
