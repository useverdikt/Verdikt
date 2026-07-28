/** Display metadata for pull connectors and push sources (Signal Sources UI). */

export function humanizeSourceId(id) {
  return String(id || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const PULL_CONNECTOR_META = {
  braintrust: {
    logo: "/integrations/braintrust.svg",
    name: "Braintrust",
    detail: "API pull — AI eval scores (tag runs with PR commit SHA)"
  },
  langsmith: {
    logo: "/integrations/langsmith.svg",
    name: "LangSmith",
    detail: "API pull — AI eval traces (commit metadata on runs)"
  },
  browserstack: {
    logo: "/integrations/browserstack.svg",
    name: "BrowserStack",
    detail: "API pull — smoke/E2E pass rates (build_tag or SDK git SHA)"
  },
  sentry: {
    logo: "/integrations/sentry.svg",
    name: "Sentry",
    detail: "API pull — crash/error rates (Sentry release = commit SHA)"
  },
  datadog: {
    logo: "/integrations/datadog.svg",
    name: "Datadog",
    detail: "API pull — latency/health (git.commit.sha or DD_GIT_COMMIT_SHA)"
  }
};

export function pullConnectorUi(sourceId) {
  const meta = PULL_CONNECTOR_META[sourceId] || {};
  return {
    sourceId,
    logo: meta.logo || null,
    icon: meta.icon || "◆",
    name: meta.name || humanizeSourceId(sourceId),
    detail: meta.detail || "API pull — metrics keyed by commit SHA"
  };
}
