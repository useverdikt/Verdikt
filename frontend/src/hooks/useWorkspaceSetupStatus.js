import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { DEFAULT_TRIGGER_LABEL } from "../lib/firstCertCopy.js";
import { buildWorkspaceSetupChecklist } from "../lib/workspaceSetupChecklist.js";
import { hasConnectedSignalSource } from "../pages/settings/workspace/settingsWorkspaceModel.js";

/** Live workspace setup status for the Releases onboarding checklist. */
export function useWorkspaceSetupStatus(navigate, wsId, { thresholds = {}, signalDefinitions = [] } = {}) {
  const [loading, setLoading] = useState(Boolean(hasBackend() && wsId));
  const [githubConnected, setGithubConnected] = useState(false);
  const [labelTriggerEnabled, setLabelTriggerEnabled] = useState(false);
  const [triggerLabel, setTriggerLabel] = useState(DEFAULT_TRIGGER_LABEL);
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
        setTriggerLabel(labelTrigger?.label_name || DEFAULT_TRIGGER_LABEL);
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
    const built = buildWorkspaceSetupChecklist({
      githubConnected,
      labelTriggerEnabled,
      signalsConnected,
      thresholds,
      signalDefinitions,
      triggerLabel
    });
    return {
      loading,
      items: built.items,
      complete: built.complete,
      signalsConnected,
      triggerLabel: built.triggerLabel,
      githubReady: built.githubReady
    };
  }, [
    signalsConnected,
    githubConnected,
    labelTriggerEnabled,
    triggerLabel,
    loading,
    thresholds,
    signalDefinitions
  ]);
}
