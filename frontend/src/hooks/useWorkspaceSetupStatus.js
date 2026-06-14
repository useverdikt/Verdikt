import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { hasConnectedSignalSource } from "../pages/settings/workspace/settingsWorkspaceModel.js";

const LEGACY_AI_THRESHOLD_KEYS = ["accuracy", "safety", "tone", "hallucination", "relevance"];

function isThresholdsConfigured(thresholds, signalDefinitions) {
  if (Array.isArray(signalDefinitions) && signalDefinitions.length > 0) return true;
  return LEGACY_AI_THRESHOLD_KEYS.every(
    (key) => thresholds[key] !== undefined && thresholds[key] !== null && thresholds[key] !== ""
  );
}

/** Live workspace setup status for the Releases onboarding checklist. */
export function useWorkspaceSetupStatus(navigate, wsId, { thresholds = {}, signalDefinitions = [] } = {}) {
  const [loading, setLoading] = useState(Boolean(hasBackend() && wsId));
  const [githubConnected, setGithubConnected] = useState(false);
  const [labelTriggerEnabled, setLabelTriggerEnabled] = useState(false);
  const [signalsConnected, setSignalsConnected] = useState(false);

  useEffect(() => {
    if (!hasBackend() || !wsId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [githubStatus, labelTrigger, integrations] = await Promise.all([
          apiGet(`/api/workspaces/${wsId}/github-app/status`, { navigate }).catch(() => null),
          apiGet(`/api/workspaces/${wsId}/github-label-trigger`, { navigate }).catch(() => null),
          apiGet(`/api/workspaces/${wsId}/signal-integrations`, { navigate }).catch(() => null)
        ]);
        if (cancelled) return;
        setGithubConnected(Boolean(githubStatus?.connected));
        setLabelTriggerEnabled(Boolean(labelTrigger?.enabled));
        setSignalsConnected(hasConnectedSignalSource(integrations));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, wsId]);

  return useMemo(() => {
    const thresholdsConfigured = isThresholdsConfigured(thresholds, signalDefinitions);
    const githubReady = githubConnected && labelTriggerEnabled;
    const signalsReady = signalsConnected;

    const items = [
      {
        id: "github",
        label: "Connect GitHub App and enable verdikt:rc label trigger",
        done: githubReady,
        to: "/settings?section=trigger",
        hint: githubConnected
          ? "Select repo(s) and save the label trigger."
          : "Install the GitHub App and enable the label trigger for PR certification."
      },
      {
        id: "signals",
        label: "Connect at least one signal source",
        done: signalsReady,
        to: "/settings?section=api",
        hint: "Connect a pull integration, adopt push signals in Thresholds, or upload CSV."
      },
      {
        id: "sha",
        label: "Tag eval/build runs with the PR head commit SHA",
        done: signalsReady && githubReady,
        to: "/settings?section=api",
        hint: "Use Probe SHA match in Settings → Signal sources before your first cert window."
      },
      {
        id: "thresholds",
        label: "Configure quality thresholds",
        done: thresholdsConfigured,
        to: "/thresholds",
        hint: "Defaults work for a first walkthrough; tune required signals before production."
      }
    ];

    const requiredComplete = githubReady && signalsReady && thresholdsConfigured;
    return {
      loading,
      items,
      complete: requiredComplete,
      signalsConnected
    };
  }, [
    signalsConnected,
    githubConnected,
    labelTriggerEnabled,
    loading,
    thresholds,
    signalDefinitions
  ]);
}
