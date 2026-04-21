import React from "react";

/** One threshold control row for onboarding collapsible categories. */
export function renderThreshSigRow(sig, st, updateThresh) {
  const floorVal = st.thresh[sig.id] ?? 100;
  if (sig.dir === "test") {
    return (
      <div className="thresh-sig" key={sig.id}>
        <div style={{ flex: 1 }}>
          <div className="thresh-sig-name">
            {sig.label}
            {sig.cond ? <span className="badge badge-cond">CONDITIONAL</span> : null}
          </div>
          <div className="thresh-sig-desc">≥{floorVal}% pass rate · P0 failure → hard block</div>
        </div>
        <div className="thresh-ctrl">
          <span className="thresh-dir">≥</span>
          <input
            className="thresh-inp"
            type="number"
            value={floorVal}
            min={0}
            max={100}
            step={1}
            onChange={(e) => updateThresh(sig.id, +e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="thresh-unit">%</span>
        </div>
      </div>
    );
  }
  if (sig.dir === "pass") {
    return (
      <div className="thresh-sig" key={sig.id}>
        <div style={{ flex: 1 }}>
          <div className="thresh-sig-name">
            {sig.label}
            {sig.hg ? <span className="badge badge-hg">HARD GATE</span> : null}
            {sig.cond ? <span className="badge badge-cond">CONDITIONAL</span> : null}
          </div>
        </div>
        <div className="pass-fixed">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path
              d="M2 5.5l2.5 2.5 4.5-4.5"
              stroke="var(--green)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          PASS required
        </div>
      </div>
    );
  }
  const dir = sig.dir === "above" ? "≥" : "≤";
  if (sig.delta) {
    const dk = `${sig.id}_delta`;
    return (
      <div className="thresh-sig" key={sig.id}>
        <div style={{ flex: 1 }}>
          <div className="thresh-sig-name">{sig.label}</div>
          <div className="thresh-sig-desc">
            floor ≥{st.thresh[sig.id]}% · max drop {st.thresh[dk] ?? 5}pts
          </div>
        </div>
        <div className="thresh-ctrl" style={{ flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9,
                color: "var(--mid)",
                minWidth: 50,
                textAlign: "right",
                letterSpacing: "0.06em"
              }}
            >
              FLOOR
            </span>
            <input
              className="thresh-inp"
              type="number"
              value={st.thresh[sig.id]}
              step={0.1}
              onChange={(e) => updateThresh(sig.id, +e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="thresh-unit">{sig.unit}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9,
                color: "var(--mid)",
                minWidth: 50,
                textAlign: "right",
                letterSpacing: "0.06em"
              }}
            >
              MAX DROP
            </span>
            <input
              className="thresh-inp"
              style={{ color: "var(--pink)" }}
              type="number"
              value={st.thresh[dk] ?? 5}
              step={1}
              onChange={(e) => updateThresh(dk, +e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="thresh-unit">pts</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="thresh-sig" key={sig.id}>
      <div style={{ flex: 1 }}>
        <div className="thresh-sig-name">{sig.label}</div>
        <div className="thresh-sig-desc">
          {dir}
          {st.thresh[sig.id]}
          {sig.unit} default
        </div>
      </div>
      <div className="thresh-ctrl">
        <span className="thresh-dir">{dir}</span>
        <input
          className="thresh-inp"
          type="number"
          value={st.thresh[sig.id]}
          step={sig.unit === "s" || sig.unit === "%" ? 0.1 : sig.unit === "ms" ? 10 : 1}
          onChange={(e) => updateThresh(sig.id, +e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="thresh-unit">{sig.unit}</span>
      </div>
    </div>
  );
}
