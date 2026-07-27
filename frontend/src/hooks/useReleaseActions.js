import { useCallback } from "react";
import { apiPost, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { UI_RELEASE_STATUS, normalizeReleaseStatus } from "../lib/releaseStatus.js";
import { invalidateReleaseDomain } from "../queries/workspaceMutations.js";
import { useWorkspaceMutations } from "../queries/useWorkspaceMutations.js";
import {
  S,
  nowTs,
  calcVerdict,
  SIGNAL_SOURCES,
  ROLES
} from "../app/main/appMainLogic.js";

export function useReleaseActions({
  navigate,
  releases,
  setReleases,
  selectedId,
  setSelectedId,
  thresholds,
  setThresholds,
  thresholdRequired,
  setThresholdRequired,
  currentUser,
  current,
  showToast,
  setApiBanner,
  addAudit,
  refreshReleaseFromBackend,
  refreshAuditFromServer,
  refreshWorkspaceFromServer,
  loadThresholdSuggestions,
  modalActions
}) {
  const {
    setShowStartCert,
    setShowManualAdd,
    setShowOverride,
    setShowReevalConfirm,
    setReEvaluating,
    reEvaluating,
    setLiveStreamRelease,
    toastGreen,
    toastAmber,
    toastRed,
    toastAccent
  } = modalActions;

  const {
    saveThresholds,
    applyThresholdSuggestion,
    dismissThresholdSuggestion
  } = useWorkspaceMutations(navigate);

  const refreshReleaseAfterMutation = useCallback(
    async (backendId) => {
      if (hasBackend()) await invalidateReleaseDomain(getWorkspaceId());
      await refreshReleaseFromBackend(backendId);
      await refreshAuditFromServer();
    },
    [refreshReleaseFromBackend, refreshAuditFromServer]
  );

  const resolveBackendReleaseId = (release) =>
    release?.backendReleaseId ||
    (typeof release?.id === "string" && release.id.startsWith("rel_") ? release.id : null);

  const handleShip = useCallback(() => {
    // Backend-connected workspaces record ship/bypass via VCS monitor + gate — do not
    // invent a local "shipped" status that diverges from the server.
    if (hasBackend()) {
      showToast(
        "Ship is recorded by merge/gate on the server — local demo ship is disabled when connected.",
        toastAmber
      );
      return;
    }
    const actor = currentUser
      ? `${currentUser.name}, ${ROLES[currentUser.role]?.title || "User"}`
      : "You";
    setReleases((p) =>
      p.map((r) =>
        r.id === selectedId
          ? {
              ...r,
              status: "shipped",
              shippedBy: actor
            }
          : r
      )
    );
    addAudit({
      ts: nowTs(),
      event: "Release shipped",
      release: current.version,
      actor,
      detail: "All thresholds met. Release certified and on permanent record."
    });
    showToast("✓ Certified. Release is on record.", toastGreen);
  }, [currentUser, current, selectedId, setReleases, addAudit, showToast, toastGreen, toastAmber]);

  const handleIntelligenceDecision = useCallback(
    async (decision) => {
      const active = releases.find((r) => r.id === selectedId);
      const backendId = active?.backendReleaseId;
      const decidedAt = new Date().toISOString();
      const localPayload = {
        decision: String(decision),
        notes: "",
        actor: currentUser?.email || currentUser?.name || "local",
        decided_at: decidedAt
      };
      if (!backendId) {
        if (!active) return;
        setReleases((p) =>
          p.map((r) =>
            r.id === selectedId
              ? {
                  ...r,
                  intelligence: {
                    ...(r.intelligence || {}),
                    decision: localPayload
                  }
                }
              : r
          )
        );
        showToast(
          `Decision saved locally (${decision}) — sync a server release to persist on the backend`,
          toastAmber
        );
        return;
      }
      if (!hasBackend()) {
        showToast("Backend required to persist intelligence decisions", toastAmber);
        return;
      }
      try {
        await apiPost(`/api/releases/${backendId}/intelligence/decision`, { decision }, { navigate });
        await refreshReleaseAfterMutation(backendId);
        showToast(`Decision recorded: ${decision}`, toastGreen);
      } catch (e) {
        setApiBanner(e.message || "Intelligence decision failed");
        showToast("Could not record intelligence decision (check login and release sync)", toastRed);
      }
    },
    [
      releases,
      selectedId,
      currentUser,
      setReleases,
      showToast,
      navigate,
      refreshReleaseFromBackend,
      refreshAuditFromServer,
      setApiBanner,
      toastAmber,
      toastGreen,
      toastRed
    ]
  );

  const handleIntelligenceOutcome = useCallback(
    async (label) => {
      const active = releases.find((r) => r.id === selectedId);
      const backendId = active?.backendReleaseId;
      const decidedAt = new Date().toISOString();
      const localPayload = {
        label: String(label),
        notes: "",
        observed_at: decidedAt,
        recorded_at: decidedAt
      };
      if (!backendId) {
        if (!active) return;
        setReleases((p) =>
          p.map((r) =>
            r.id === selectedId
              ? {
                  ...r,
                  intelligence: {
                    ...(r.intelligence || {}),
                    outcome: localPayload
                  }
                }
              : r
          )
        );
        showToast(
          `Outcome saved locally (${label}) — sync a server release to persist on the backend`,
          toastAmber
        );
        return;
      }
      if (!hasBackend()) {
        showToast("Backend required to persist intelligence outcomes", toastAmber);
        return;
      }
      try {
        await apiPost(`/api/releases/${backendId}/intelligence/outcome`, { label }, { navigate });
        await refreshReleaseAfterMutation(backendId);
        showToast(`Outcome recorded: ${label}`, toastGreen);
      } catch (e) {
        setApiBanner(e.message || "Intelligence outcome failed");
        showToast("Could not record intelligence outcome (check login and release sync)", toastRed);
      }
    },
    [
      releases,
      selectedId,
      setReleases,
      showToast,
      navigate,
      refreshReleaseFromBackend,
      refreshAuditFromServer,
      setApiBanner,
      toastAmber,
      toastGreen,
      toastRed
    ]
  );

  const handleOverrideConfirm = useCallback(
    async (owner, payload) => {
      const active = releases.find((r) => r.id === selectedId);
      const backendId = active?.backendReleaseId;
      const justification = payload?.justification ?? "";
      const impact_summary = payload?.impact_summary ?? "";
      const mitigation_plan = payload?.mitigation_plan ?? "";
      const follow_up_due_date = payload?.follow_up_due_date ?? "";
      if (hasBackend() && backendId) {
        try {
          setApiBanner(null);
          await apiPost(
            `/api/releases/${backendId}/override`,
            {
              approver_type: "PERSON",
              approver_name: owner,
              approver_role: owner.split(",")[1]?.trim() || "Approver",
              justification,
              metadata: {
                source: "dashboard",
                impact_summary,
                mitigation_plan,
                follow_up_due_date
              }
            },
            { navigate }
          );
          await refreshReleaseAfterMutation(backendId);
        } catch (e) {
          setApiBanner(e.message || "Override request failed");
          showToast("Override not saved — fix errors and try again", toastRed);
          return;
        }
      }
      setReleases((p) =>
        p.map((r) =>
          r.id === selectedId
            ? {
                ...r,
                status: "overridden",
                overrideBy: owner,
                overrideReason: justification
              }
            : r
        )
      );
      if (!hasBackend() || !backendId) {
        addAudit({
          ts: nowTs(),
          event: "Override approved",
          release: current.version,
          actor: owner,
          detail: "Shipped below threshold. Justification on permanent record."
        });
      }
      setShowOverride(false);
      showToast("⚠ Shipped uncertified. Certified with override — permanently on record.", toastAmber);
    },
    [
      releases,
      selectedId,
      current,
      setReleases,
      setApiBanner,
      navigate,
      refreshReleaseFromBackend,
      refreshAuditFromServer,
      addAudit,
      setShowOverride,
      showToast,
      toastRed,
      toastAmber
    ]
  );

  const handleStartCert = useCallback(
    async ({ version, buildRef, relType }) => {
      const id = `rc-${version.replace(/[^a-zA-Z0-9.]/g, "")}`;
      let backendReleaseId = null;
      if (hasBackend()) {
        try {
          const created = await apiPost(
            `/api/workspaces/${getWorkspaceId()}/releases`,
            {
              version,
              release_type: relType,
              environment: "pre-prod"
            },
            { navigate }
          );
          backendReleaseId = created?.id || null;
          if (!backendReleaseId) {
            showToast("Could not open certification session — try again", toastRed);
            return;
          }
        } catch (e) {
          setApiBanner(e?.message || "Failed to open certification session");
          showToast("Could not open certification session — try again", toastRed);
          return;
        }
      }
      const rel = {
        id,
        version,
        buildRef,
        date: new Date().toISOString().slice(0, 10),
        status: "collecting",
        releaseType: relType,
        backendReleaseId,
        signals: {},
        sources: SIGNAL_SOURCES.map((s) => ({ ...s, status: "waiting" }))
      };
      setReleases((p) => [rel, ...p]);
      setSelectedId(id);
      setShowStartCert(false);
      navigate("/releases", { replace: true });
      showToast(`Certification session opened for ${version}`, toastAmber);
    },
    [navigate, setReleases, setSelectedId, setShowStartCert, showToast, toastRed, setApiBanner]
  );

  const handleManualAddSingle = useCallback(
    async ({ version, date, releaseType }) => {
      const id = `rc-${version.replace(/[^a-zA-Z0-9.]/g, "")}`;
      let backendReleaseId = null;
      if (hasBackend()) {
        try {
          const created = await apiPost(
            `/api/workspaces/${getWorkspaceId()}/releases`,
            {
              version,
              release_type: releaseType,
              environment: "pre-prod"
            },
            { navigate }
          );
          backendReleaseId = created?.id || null;
          if (!backendReleaseId) {
            showToast("Could not add release — try again", toastRed);
            return;
          }
        } catch (e) {
          setApiBanner(e?.message || "Failed to add release");
          showToast("Could not add release — try again", toastRed);
          return;
        }
      }
      const rel = {
        id,
        version,
        date: date || new Date().toISOString().slice(0, 10),
        status: "collecting",
        releaseType,
        backendReleaseId,
        signals: {},
        sources: []
      };
      setReleases((p) => [rel, ...p]);
      setSelectedId(id);
      setShowManualAdd(false);
      navigate("/releases", { replace: true });
      addAudit({
        ts: nowTs(),
        event: "Release added manually",
        release: version,
        actor: "Manual",
        detail: `No integration — ${version} added for certification tracking.`
      });
      showToast(`${version} added. Run verdict or record override when ready.`, toastGreen);
    },
    [navigate, setReleases, setSelectedId, setShowManualAdd, addAudit, showToast, toastGreen, toastRed, setApiBanner]
  );

  const handleManualImportCSV = useCallback(
    (rows) => {
      const newReleases = rows.map(({ version, date, releaseType }) => {
        const id = `rc-${version.replace(/[^a-zA-Z0-9.]/g, "")}`;
        return {
          id,
          version,
          date: date || new Date().toISOString().slice(0, 10),
          status: "collecting",
          releaseType,
          signals: {},
          sources: []
        };
      });
      setReleases((p) => [...newReleases, ...p]);
      if (newReleases.length) setSelectedId(newReleases[0].id);
      setShowManualAdd(false);
      navigate("/releases", { replace: true });
      addAudit({
        ts: nowTs(),
        event: "Releases imported from CSV",
        release: `${newReleases.length} releases`,
        actor: "Manual",
        detail: `Imported ${newReleases.length} release(s) without integration.`
      });
      showToast(`${newReleases.length} release(s) imported.`, toastGreen);
    },
    [setReleases, setSelectedId, setShowManualAdd, navigate, addAudit, showToast, toastGreen]
  );

  const handleSimulateSignal = useCallback(
    (sourceId) => {
      const src = SIGNAL_SOURCES.find((s) => s.id === sourceId);
      if (!src) return;
      const arrivedAt = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      setReleases((p) =>
        p.map((r) => {
          if (r.id !== selectedId) return r;
          const newSources = (r.sources || []).map((s) =>
            s.id === sourceId ? { ...s, status: "arrived", arrivedAt } : s
          );
          const newSignals = { ...r.signals, ...src.demoValues };
          return { ...r, sources: newSources, signals: newSignals };
        })
      );
      showToast(
        `${src.name} — ${src.signals.length} signal${src.signals.length !== 1 ? "s" : ""} received`,
        toastGreen
      );
    },
    [selectedId, setReleases, showToast, toastGreen]
  );

  const handleRunVerdict = useCallback(async () => {
    const active = releases.find((r) => r.id === selectedId);
    if (!active) return;
    const backendId = active.backendReleaseId || active.id;
    if (hasBackend() && backendId) {
      try {
        setApiBanner(null);
        const flat = {};
        Object.entries(active.signals || {}).forEach(([k, v]) => {
          if (typeof v === "number") flat[k] = v;
        });
        const out = await apiPost(
          `/api/releases/${backendId}/signals`,
          {
            source: "dashboard_manual",
            signals: flat
          },
          { navigate }
        );
        await refreshReleaseAfterMutation(backendId);
        const miss = Array.isArray(out.missing_signals) ? out.missing_signals.length : 0;
        const th = Array.isArray(out.threshold_failed_signals) ? out.threshold_failed_signals.length : 0;
        if (miss || th) {
          showToast(
            `Verdict: ${miss ? `${miss} missing` : ""}${miss && th ? " · " : ""}${th ? `${th} below threshold` : ""}`,
            th ? toastAmber : toastGreen
          );
        } else {
          showToast("All required signals passed thresholds", toastGreen);
        }
        if (out.assistive_enrichment_pending) {
          window.setTimeout(() => {
            void refreshReleaseAfterMutation(backendId);
          }, 4500);
        }
      } catch (e) {
        setApiBanner(e.message || "Signal ingest failed");
        showToast("Backend ingest failed — check banner or try again", toastRed);
        return;
      }
    }
    if (!hasBackend() || !backendId) {
      const v = calcVerdict(active.signals, thresholds, active.releaseType);
      const nextStatus = v.recommendation === "SHIP" ? UI_RELEASE_STATUS.CERTIFIED : UI_RELEASE_STATUS.UNCERTIFIED;
      setReleases((p) => p.map((r) => (r.id === selectedId ? { ...r, status: nextStatus } : r)));
      showToast("All signals collected — verdict ready", toastGreen);
    }
  }, [
    releases,
    selectedId,
    thresholds,
    setReleases,
    setApiBanner,
    navigate,
    refreshReleaseFromBackend,
    refreshAuditFromServer,
    showToast,
    toastAmber,
    toastGreen,
    toastRed
  ]);

  const handleConfirmReevaluation = useCallback(async () => {
    if (reEvaluating) return;
    setReEvaluating(true);
    try {
      setShowReevalConfirm(false);
      await handleRunVerdict();
    } finally {
      setReEvaluating(false);
    }
  }, [reEvaluating, setReEvaluating, setShowReevalConfirm, handleRunVerdict]);

  const handleCollectingAction = useCallback(
    async (kind, releaseOverride) => {
      const active =
        releaseOverride ||
        releases.find((r) => r.id === selectedId) ||
        current;
      const backendId = resolveBackendReleaseId(active);
      const isCollecting =
        active && normalizeReleaseStatus(active.status) === UI_RELEASE_STATUS.COLLECTING;

      if (kind === "live") {
        if (!hasBackend() || !backendId) {
          showToast(
            "Sign in and open a server-backed COLLECTING release to view the live signal stream.",
            toastAmber
          );
          return;
        }
        if (!isCollecting) {
          showToast("Live stream is only available while the release is COLLECTING.", toastAmber);
          return;
        }
        setLiveStreamRelease?.(active);
        return;
      }
      if (kind === "extend") {
        if (!hasBackend() || !backendId) {
          showToast(
            "Sign in and open a server-backed COLLECTING release to extend the collection deadline.",
            toastAmber
          );
          return;
        }
        if (!isCollecting) {
          showToast("Only COLLECTING releases can have their deadline extended.", toastAmber);
          return;
        }
        try {
          const out = await apiPost(`/api/releases/${backendId}/collection-deadline/extend`, {}, { navigate });
          const deadline = out.collection_deadline;
          const label = deadline
            ? new Date(deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "updated";
          showToast(
            `Collection deadline extended${out.extend_minutes ? ` by ${out.extend_minutes}m` : ""} · ends ${label}`,
            toastGreen
          );
          await refreshReleaseAfterMutation(backendId);
        } catch (e) {
          showToast(e?.message || "Could not extend collection deadline", toastRed);
        }
        return;
      }
      if (kind === "pull") {
        if (!hasBackend() || !backendId) {
          showToast(
            "Sign in and open a server-backed release to pull metrics from connected integrations (Settings → Signal sources).",
            toastAmber
          );
          return;
        }
        try {
          const out = await apiPost(`/api/releases/${backendId}/sources/pull`, {}, { navigate });
          const src = out.sources || {};
          const parts = Object.entries(src).map(([k, v]) => {
            if (v && v.ok) return `${k}: ok`;
            if (v && v.skipped) return `${k}: skipped`;
            if (v && v.error) return `${k}: ${v.error}`;
            return `${k}: done`;
          });
          showToast(parts.length ? parts.join(" · ") : out.message || "Pull finished.", toastAccent);
          await refreshReleaseAfterMutation(backendId);
        } catch (e) {
          showToast(e?.message || "Pull failed", toastRed);
        }
      }
    },
    [releases, selectedId, current, showToast, navigate, refreshReleaseAfterMutation, setLiveStreamRelease, toastAccent, toastAmber, toastGreen, toastRed]
  );

  const handleThresholdSave = useCallback(
    async (local, localRequired) => {
      if (!hasBackend()) {
        setThresholds(local);
        setThresholdRequired(localRequired);
        S.set("thresholds", local);
        S.set("thresholdRequired", localRequired);
        addAudit({
          ts: nowTs(),
          event: "Thresholds updated",
          release: "—",
          actor: "You",
          detail: "Signal thresholds updated."
        });
        await loadThresholdSuggestions();
        return true;
      }
      try {
        await saveThresholds.mutateAsync({ local, localRequired });
        setThresholds(local);
        setThresholdRequired(localRequired);
        S.set("thresholds", local);
        S.set("thresholdRequired", localRequired);
        setApiBanner(null);
        await refreshWorkspaceFromServer();
        await loadThresholdSuggestions();
        return true;
      } catch (e) {
        setApiBanner(e.message || "Failed to save thresholds");
        return false;
      }
    },
    [
      setThresholds,
      setThresholdRequired,
      addAudit,
      loadThresholdSuggestions,
      refreshWorkspaceFromServer,
      setApiBanner,
      saveThresholds
    ]
  );

  const handleApplySuggestion = useCallback(
    async (id) => {
      if (!hasBackend()) return;
      try {
        await applyThresholdSuggestion.mutateAsync(id);
        await refreshWorkspaceFromServer();
        await loadThresholdSuggestions();
        setApiBanner(null);
      } catch (e) {
        setApiBanner(e.message || "Failed to apply suggestion");
      }
    },
    [applyThresholdSuggestion, refreshWorkspaceFromServer, loadThresholdSuggestions, setApiBanner]
  );

  const handleDismissSuggestion = useCallback(
    async (id) => {
      if (!hasBackend()) return;
      try {
        await dismissThresholdSuggestion.mutateAsync(id);
        await loadThresholdSuggestions();
        setApiBanner(null);
      } catch (e) {
        setApiBanner(e.message || "Failed to dismiss suggestion");
      }
    },
    [dismissThresholdSuggestion, loadThresholdSuggestions, setApiBanner]
  );

  return {
    handleShip,
    handleIntelligenceDecision,
    handleIntelligenceOutcome,
    handleOverrideConfirm,
    handleStartCert,
    handleManualAddSingle,
    handleManualImportCSV,
    handleSimulateSignal,
    handleRunVerdict,
    handleConfirmReevaluation,
    handleCollectingAction,
    handleThresholdSave,
    handleApplySuggestion,
    handleDismissSuggestion
  };
}
