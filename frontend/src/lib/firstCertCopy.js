export const DEFAULT_TRIGGER_LABEL = "verdikt:rc";

export const FIRST_CERT_EYEBROW = "First certification";
export const FIRST_CERT_TITLE = "Certify a pull request before merge";
export const FIRST_CERT_INTRO =
  "Connect GitHub, apply the release-candidate label, tag evals with the PR head SHA, then adopt a starting threshold pack. Verdikt opens a COLLECTING window until those signals land.";

export const WAITING_FOR_FIRST_PR_TITLE = "Waiting for your first PR";
export const COLLECTING_EXPLAINER =
  "COLLECTING means the cert window is open. Signals that are not tagged with the PR head SHA never match, so the release stays collecting.";

export function shaTaggingSnippet() {
  return `# Tag eval/build output with the PR head SHA so Verdikt can match this cert window
COMMIT_SHA: \${{ github.event.pull_request.head.sha }}`;
}

export function waitingForFirstPrBody(label = DEFAULT_TRIGGER_LABEL) {
  return `Apply ${label} on a pull request in a connected repo. Verdikt opens a COLLECTING cert window for that PR head SHA.`;
}

export function emptyReleasesWedgeCopy(label = DEFAULT_TRIGGER_LABEL) {
  return `No releases yet. Label a PR ${label} in a connected repo — do not start from "New release" unless you are wiring a manual cert.`;
}
