import React, { useMemo, useState } from "react";
import { C } from "../../../theme/tokens.js";

const CSV_TEMPLATE = "version,date,release_type\nv2.15.0,2026-03-04,prompt_update\nv2.14.1,2026-03-03,model_patch";

const parseManualCSV = (text, releaseTypes) => {
  const lines = (text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().replace(/\s/g, "");
  const cols = header.split(",");
  const vIdx = cols.findIndex((c) => c === "version" || c === "v");
  const dIdx = cols.findIndex((c) => c === "date" || c === "d");
  const tIdx = cols.findIndex((c) => c === "release_type" || c === "type" || c === "releasetype");
  if (vIdx < 0) return [];
  const validTypes = releaseTypes.map((r) => r.id);
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((s) => s.trim());
    const version = (cells[vIdx] || "").trim();
    if (!version) continue;
    const date = dIdx >= 0 && cells[dIdx] ? cells[dIdx].trim() : today;
    let releaseType = tIdx >= 0 && cells[tIdx] ? cells[tIdx].trim().toLowerCase().replace(/\s/g, "_") : "prompt_update";
    if (!validTypes.includes(releaseType)) releaseType = "prompt_update";
    out.push({ version, date, releaseType });
  }
  return out;
};

export default function ManualAddModal({ onClose, onAddSingle, onImportCSV, releaseTypes }) {
  const isMobile = window.innerWidth <= 900;
  const titleId = React.useId();
  const [mode, setMode] = useState("single");
  const [version, setVersion] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [relType, setRelType] = useState("prompt_update");
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState("");

  const canSingle = version.trim().length > 1;
  const parsed = useMemo(() => parseManualCSV(csvText, releaseTypes), [csvText, releaseTypes]);
  const inputStyle = { width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, fontFamily: C.mono, outline: "none", boxSizing: "border-box" };

  const handleAddOne = () => {
    if (!canSingle) return;
    onAddSingle({ version: version.trim(), date: date.trim() || new Date().toISOString().slice(0, 10), releaseType: relType });
    onClose();
  };

  const handleImport = () => {
    if (parsed.length === 0) {
      setCsvError("Add a header row and at least one data row. Download the template below.");
      return;
    }
    setCsvError("");
    onImportCSV(parsed);
    onClose();
  };

  const downloadTemplate = () => {
    const a = document.createElement("a");
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;
    a.download = "verdikt-releases-template.csv";
    a.click();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000d8", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: isMobile ? 10 : 20 }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: isMobile ? 12 : 16, padding: isMobile ? "16px 12px" : "28px 32px", width: "100%", maxWidth: 520, maxHeight: isMobile ? "96vh" : "90vh", overflow: "auto", position: "relative" }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 16, right: 18, background: "transparent", border: "none", color: C.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.accent, letterSpacing: "0.12em", marginBottom: 6 }}>NO INTEGRATION</div>
        <h3 id={titleId} style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: C.text }}>Add releases manually</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: C.muted, lineHeight: 1.6 }}>For teams without build sync. Add one release or import many from a CSV (e.g. from your build list or spreadsheet).</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setMode("single")} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${mode === "single" ? C.accent : C.border}`, background: mode === "single" ? C.accentDim : "transparent", color: mode === "single" ? C.accentBright : C.muted, fontSize: 12, fontFamily: C.mono, cursor: "pointer", fontWeight: mode === "single" ? 700 : 400 }}>Add single</button>
          <button onClick={() => setMode("csv")} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${mode === "csv" ? C.accent : C.border}`, background: mode === "csv" ? C.accentDim : "transparent", color: mode === "csv" ? C.accentBright : C.muted, fontSize: 12, fontFamily: C.mono, cursor: "pointer", fontWeight: mode === "csv" ? 700 : 400 }}>Import CSV</button>
        </div>

        {mode === "single" ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>VERSION *</label>
              <input type="text" placeholder="e.g. v2.15.0" value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>DATE</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 8 }}>RELEASE TYPE</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {releaseTypes.map((rt) => (
                  <button key={rt.id} onClick={() => setRelType(rt.id)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${relType === rt.id ? C.accent : C.border}`, background: relType === rt.id ? C.accentDim : "transparent", color: relType === rt.id ? C.accentBright : C.muted, fontSize: 11, fontFamily: C.mono, cursor: "pointer" }}>
                    {rt.icon} {rt.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: C.mono }}>Cancel</button>
              <button onClick={handleAddOne} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: canSingle ? C.green : C.border, color: canSingle ? "#000" : C.dim, fontSize: 13, fontWeight: 700, cursor: canSingle ? "pointer" : "not-allowed", fontFamily: C.mono }}>Add release</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>PASTE CSV OR UPLOAD</label>
              <textarea placeholder={"version,date,release_type\nv2.15.0,2026-03-04,prompt_update"} value={csvText} onChange={(e) => { setCsvText(e.target.value); setCsvError(""); }} rows={6} style={{ ...inputStyle, resize: "vertical", minHeight: 120 }} />
            </div>
            {csvError && <div style={{ marginBottom: 10, fontSize: 12, color: C.red }}>{csvError}</div>}
            {parsed.length > 0 && <div style={{ marginBottom: 10, fontSize: 11, color: C.green }}>✓ {parsed.length} release(s) will be added.</div>}
            <div style={{ marginBottom: 16, fontSize: 11, color: C.muted }}>
              <a href="#" onClick={(e) => { e.preventDefault(); downloadTemplate(); }} style={{ color: C.accent, textDecoration: "underline" }}>Download CSV template</a> - columns: version, date, release_type
            </div>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: C.mono }}>Cancel</button>
              <button onClick={handleImport} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: parsed.length > 0 ? C.green : C.border, color: parsed.length > 0 ? "#000" : C.dim, fontSize: 13, fontWeight: 700, cursor: parsed.length > 0 ? "pointer" : "not-allowed", fontFamily: C.mono }}>
                Import {parsed.length} release(s)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
