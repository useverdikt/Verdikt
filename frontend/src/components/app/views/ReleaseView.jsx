import React from "react";
import CollectingView from "../CollectingView.jsx";
import { ReleaseDashboardRedesign } from "../../release/ReleaseDashboardRedesign.jsx";
import { getSafeApiBase } from "../../../lib/apiBase.js";

export default function ReleaseView({
  current,
  releases = [],
  formatReleaseAge,
  thresholds,
  releaseTypes,
  signalCategories,
  calcCategoryStatus,
  setDetailCat: _setDetailCat,
  setShowStartCert,
  onViewFullRecord,
  onBeginOverride,
  handleSimulateSignal,
  handleRunVerdict,
  signalSources,
  releaseVersionPrimarySecondary,
  onCollectingAction
}) {
  const setupChecklist = (() => {
    let thresholdsConfigured = false;
    let triggerConfigured = false;
    try {
      const t = JSON.parse(localStorage.getItem("vdk3_thresholds") || "{}");
      thresholdsConfigured = ["accuracy", "safety", "tone", "hallucination", "relevance"].every(
        (k) => t[k] !== undefined && t[k] !== null && t[k] !== ""
      );
    } catch (_) {}
    try {
      const tr = JSON.parse(localStorage.getItem("vdk3_trigger") || "{}");
      triggerConfigured = typeof tr?.mode === "string" && tr.mode.length > 0;
    } catch (_) {}
    const apiBaseConfigured =
      getSafeApiBase() === "" ||
      (import.meta.env.DEV && (localStorage.getItem("vdk3_api_base") || "").trim().length > 0) ||
      (import.meta.env.PROD && Boolean(String(import.meta.env.VITE_API_BASE || "").trim()));
    const items = [
      { id: "api", label: "Connect signal sources", done: apiBaseConfigured, to: "/settings?section=api" },
      { id: "thresholds", label: "Configure quality thresholds", done: thresholdsConfigured, to: "/settings?section=thresholds" },
      { id: "trigger", label: "Choose release trigger", done: triggerConfigured, to: "/settings?section=trigger" },
    ];
    return { items, complete: items.every((i) => i.done) };
  })();

  // Collecting view for selected release (shown as a full overlay if the current release is collecting)
  if (current && current.status === "collecting" && releases.length <= 1) {
    return (
      <CollectingView
        release={current}
        onSimulate={handleSimulateSignal}
        onRunVerdict={handleRunVerdict}
        signalSources={signalSources}
        releaseTypes={releaseTypes}
      />
    );
  }

  return (
    <ReleaseDashboardRedesign
      releases={releases}
      signalCategories={signalCategories}
      calcCategoryStatus={calcCategoryStatus}
      thresholds={thresholds}
      releaseTypes={releaseTypes}
      releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
      formatReleaseAge={formatReleaseAge}
      onNewRelease={() => setShowStartCert?.(true)}
      onViewFullRecord={onViewFullRecord}
      onBeginOverride={onBeginOverride}
      onCollectingAction={onCollectingAction}
      setupChecklist={setupChecklist}
    />
  );
}
