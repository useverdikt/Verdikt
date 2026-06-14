import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";

function countConnectedIntegrations(data) {
  const integrations = Array.isArray(data?.integrations) ? data.integrations.length : 0;
  const csvRows = Number(data?.csv_import?.row_count || 0);
  return integrations + (csvRows > 0 ? 1 : 0);
}

/** Live workspace setup status for the Releases onboarding checklist. */
export function useWorkspaceSetupStatus(navigate, wsId, { thresholds = {} } = {}) {
  const [loading, setLoading] = useState(Boolean(hasBackend() && wsId));
  const [githubConnected, setGithubConnected] = useState(false);
  const [labelTriggerEnabled, setLabelTriggerEnabled] = useState(false);
  const [connectedIntegrations, setConnectedIntegrations] = useState(0);

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
        setConnectedIntegrations(countConnectedIntegrations(integrations));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, wsId]);

  return useMemo(() => {
    const thresholdsConfigured = ["accuracy", "safety", "tone", "hallucination", "relevance"].every(
      (key) => thresholds[key] !== undefined && thresholds[key] !== null && thresholds[key] !== ""
    );
    const githubReady = githubConnected && labelTriggerEnabled;
    const signalsReady = connectedIntegrations > 0;

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
        hint: "Connect Braintrust, Sentry, Datadog, or another source so real signals can flow in."
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
      connectedIntegrations
    };
  }, [
    connectedIntegrations,
    githubConnected,
    labelTriggerEnabled,
    loading,
    thresholds
  ]);
}
