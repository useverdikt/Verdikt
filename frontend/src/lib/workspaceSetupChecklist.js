import { DEFAULT_TRIGGER_LABEL } from "./firstCertCopy.js";

const LEGACY_AI_THRESHOLD_KEYS = ["accuracy", "safety", "tone", "hallucination", "relevance"];

export function isThresholdsConfigured(thresholds = {}, signalDefinitions = []) {
  if (Array.isArray(signalDefinitions) && signalDefinitions.length > 0) return true;
  return LEGACY_AI_THRESHOLD_KEYS.every(
    (key) => thresholds[key] !== undefined && thresholds[key] !== null && thresholds[key] !== ""
  );
}

export function buildWorkspaceSetupChecklist({
  githubConnected = false,
  labelTriggerEnabled = false,
  signalsConnected = false,
  thresholds = {},
  signalDefinitions = [],
  triggerLabel = DEFAULT_TRIGGER_LABEL
} = {}) {
  const thresholdsConfigured = isThresholdsConfigured(thresholds, signalDefinitions);
  const githubReady = githubConnected && labelTriggerEnabled;
  const signalsReady = Boolean(signalsConnected);
  const label = triggerLabel || DEFAULT_TRIGGER_LABEL;

  const items = [
    {
      id: "github",
      label: `Connect GitHub App and enable ${label} label trigger`,
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
      label: "Tag eval/build runs with the PR head SHA",
      done: signalsReady && githubReady,
      hint: "Set the PR head SHA on each eval/build run in your CI — otherwise the cert window stays in COLLECTING.",
      link: {
        label: "SHA tagging guide",
        url: "https://docs.useverdikt.com/connecting-signals/api-push"
      }
    },
    {
      id: "thresholds",
      label: "Adopt a starting threshold pack",
      done: thresholdsConfigured,
      to: "/thresholds",
      hint: "One-click adopt on Thresholds uses Verdikt's recommended AI pack. Tune required signals before production."
    }
  ];

  return {
    items,
    complete: githubReady && signalsReady && thresholdsConfigured,
    githubReady,
    signalsReady,
    thresholdsConfigured,
    triggerLabel: label
  };
}
