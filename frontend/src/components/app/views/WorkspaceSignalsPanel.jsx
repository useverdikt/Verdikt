import React, { useMemo, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { Btn } from "../../ui/Btn.jsx";
import { definitionToSignalMeta, groupLibraryByCategory, LIBRARY_CATEGORY_LABELS } from "../../../lib/workspaceSignalUi.js";

function CustomSignalModal({ open, onClose, onCreate, connectors }) {
  const [signalId, setSignalId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [direction, setDirection] = useState("max");
  const [threshold, setThreshold] = useState("");
  const [unit, setUnit] = useState("");
  const [sourceId, setSourceId] = useState("custom");
  const [required, setRequired] = useState(true);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const id = signalId.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!id) return;
    const num = Number(threshold);
    if (!Number.isFinite(num)) return;
    setSaving(true);
    try {
      await onCreate({
        signal_id: id,
        display_name: displayName.trim() || id,
        direction,
        unit: unit.trim(),
        source_id: sourceId,
        required_for_certification: required,
        threshold: direction === "max" ? { max: num } : { min: num }
      });
      onClose();
      setSignalId("");
      setDisplayName("");
      setThreshold("");
    } finally {
      setSaving(false);
    }
  };

  const pushSources = useMemo(() => {
    const ids = new Set(["custom"]);
    for (const c of connectors || []) {
      if (c.ingest_mode === "push") ids.add(c.source_id);
    }
    return [...ids];
  }, [connectors]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 440
        }}
      >
        <div style={{ fontFamily: C.serif, fontSize: 22, color: C.text, marginBottom: 16 }}>Add custom signal</div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Signal ID (slug)</div>
          <input
            value={signalId}
            onChange={(e) => setSignalId(e.target.value)}
            placeholder="behavioural_drift"
            required
            style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Display name</div>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Behavioural Drift"
            style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text }}
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Direction</div>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text }}
            >
              <option value="min">Minimum (≥)</option>
              <option value="max">Maximum (≤)</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Threshold</div>
            <input
              type="number"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
              style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text }}
            />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Unit (optional)</div>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="score, %, ms"
            style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Source</div>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text }}
          >
            {pushSources.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span style={{ fontSize: 12, color: C.text }}>Required for certification</span>
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add signal"}
          </Btn>
        </div>
      </form>
    </div>
  );
}

export default function WorkspaceSignalsPanel({
  definitions = [],
  library = [],
  connectors = [],
  loading = false,
  local,
  setLocal,
  localRequired,
  setLocalRequired,
  canAct,
  currentUser,
  isMobile,
  onAdopt,
  onCreate,
  onDelete,
  renderValueControl
}) {
  const [showModal, setShowModal] = useState(false);
  const libraryGroups = useMemo(() => groupLibraryByCategory(library), [library]);

  const customDefs = definitions.filter((d) => !d.from_library || d.source_id === "custom" || d.source_id === "zizkadb");
  const standardDefs = definitions.filter((d) => d.from_library && !customDefs.includes(d));

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 280px",
          gap: 16,
          marginBottom: 20
        }}
      >
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, background: C.raise, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Workspace signals</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Signals this workspace gates on. Required signals must arrive before certification.</div>
            </div>
            {canAct(currentUser) ? (
              <Btn variant="primary" onClick={() => setShowModal(true)} style={{ fontSize: 11, padding: "6px 12px" }}>
                + Add custom
              </Btn>
            ) : null}
          </div>
          {loading ? (
            <div style={{ padding: 18, color: C.muted, fontSize: 12 }}>Loading signal catalog…</div>
          ) : definitions.length === 0 ? (
            <div style={{ padding: 18, color: C.muted, fontSize: 12 }}>No workspace signals yet. Adopt from the library or add a custom signal.</div>
          ) : (
            [...standardDefs, ...customDefs].map((def, i, arr) => {
              const sig = definitionToSignalMeta(def);
              const isCustom = !def.from_library || def.source_id === "custom" || def.source_id === "zizkadb";
              return (
                <div
                  key={def.signal_id}
                  style={{
                    padding: "14px 18px",
                    borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none",
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr auto auto auto",
                    alignItems: "center",
                    gap: 16
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{def.display_name}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 10, color: C.dim }}>{def.signal_id}</span>
                      {localRequired[def.signal_id] ? (
                        <span style={{ fontSize: 9, fontFamily: C.mono, color: C.accent, background: "rgba(56,189,248,0.08)", padding: "1px 5px", borderRadius: 3 }}>REQUIRED</span>
                      ) : null}
                      {isCustom ? (
                        <span style={{ fontSize: 9, fontFamily: C.mono, color: C.pink, padding: "1px 5px", borderRadius: 3, border: `1px solid ${C.border}` }}>CUSTOM</span>
                      ) : null}
                    </div>
                    {def.description ? <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{def.description}</div> : null}
                    {def.source_id ? <div style={{ color: C.dim, fontSize: 10, fontFamily: C.mono, marginTop: 4 }}>source: {def.source_id}</div> : null}
                  </div>
                  {renderValueControl(sig)}
                  {canAct(currentUser) ? (
                    <label style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, cursor: "pointer" }}>
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted }}>REQUIRED</span>
                      <input
                        type="checkbox"
                        checked={!!localRequired[def.signal_id]}
                        onChange={(e) => setLocalRequired((r) => ({ ...r, [def.signal_id]: e.target.checked }))}
                        style={{ width: 16, height: 16, accentColor: C.accent }}
                      />
                    </label>
                  ) : null}
                  {canAct(currentUser) && isCustom ? (
                    <Btn variant="ghost" onClick={() => onDelete?.(def.signal_id)} style={{ fontSize: 10, padding: "4px 8px", color: C.red }}>
                      Delete
                    </Btn>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", maxHeight: 520, overflowY: "auto" }}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, background: C.raise, position: "sticky", top: 0, zIndex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Signal library</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Verdikt suggestions — adopt what fits your stack.</div>
          </div>
          {library.length === 0 ? (
            <div style={{ padding: 14, fontSize: 11, color: C.muted }}>All library signals adopted.</div>
          ) : (
            [...libraryGroups.entries()].map(([cat, entries]) => (
              <div key={cat} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontFamily: C.mono, color: C.dim, marginBottom: 8, textTransform: "uppercase" }}>
                  {LIBRARY_CATEGORY_LABELS[cat] || cat}
                </div>
                {entries.map((entry) => (
                  <div key={entry.signal_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.text }}>{entry.display_name}</div>
                      <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono }}>{entry.signal_id}</div>
                    </div>
                    {canAct(currentUser) ? (
                      <Btn variant="ghost" onClick={() => onAdopt?.(entry.signal_id)} style={{ fontSize: 10, padding: "4px 8px" }}>
                        Adopt
                      </Btn>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
      <CustomSignalModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={onCreate}
        connectors={connectors}
      />
    </>
  );
}
