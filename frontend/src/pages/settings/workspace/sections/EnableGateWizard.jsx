import React, { useMemo } from "react";

const GHA_YAML = `# Copy to .github/workflows/verdikt-gate.yml — see docs/examples/verdikt-gate-gha.yml
name: Verdikt gate
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
jobs:
  verdikt-gate:
    if: contains(github.event.pull_request.labels.*.name, 'verdikt:rc')
    runs-on: ubuntu-latest
    steps:
      - name: Check Verdikt gate
        env:
          VERDIKT_API_URL: \${{ secrets.VERDIKT_API_URL }}
          VERDIKT_API_KEY: \${{ secrets.VERDIKT_API_KEY }}
          VERDIKT_WORKSPACE_ID: \${{ secrets.VERDIKT_WORKSPACE_ID }}
        run: |
          URL="\${VERDIKT_API_URL%/}/api/workspaces/\${VERDIKT_WORKSPACE_ID}/gate"
          QUERY="commit_sha=\${{ github.event.pull_request.head.sha }}&pr_number=\${{ github.event.pull_request.number }}"
          RESP=$(curl -sS -f -H "Authorization: Bearer \${VERDIKT_API_KEY}" "$URL?$QUERY")
          exit $(echo "$RESP" | jq -r '.gate.exit_code // 1')
`;

export default function EnableGateWizard({ wsId, toast }) {
  const branchProtectionSteps = useMemo(
    () => [
      "Copy the workflow below to your repo as .github/workflows/verdikt-gate.yml",
      "Add GitHub secrets: VERDIKT_API_URL, VERDIKT_API_KEY, VERDIKT_WORKSPACE_ID",
      "Settings → Branches → branch protection → require status check verdikt-gate",
      "Apply label verdikt:rc on PRs — nothing merges without Verdikt's permission"
    ],
    []
  );

  function copy(text) {
    void navigator.clipboard?.writeText(text);
    toast("Copied to clipboard");
  }

  return (
    <div className="sblock">
      <div className="sblock-head">
        <div>
          <div className="sblock-title">Enable merge gate (GitHub Actions)</div>
          <div className="sblock-desc">
            Block the merge button until Verdikt certifies the PR head commit. Agents advise; GHA enforces.
          </div>
        </div>
      </div>
      <div className="sblock-body">
        <ol style={{ margin: "0 0 16px", paddingLeft: 20, lineHeight: 1.55, fontSize: 14 }}>
          {branchProtectionSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="muted" style={{ marginBottom: 12 }}>
          Workspace ID: <code>{wsId || "ws_…"}</code> · Full example:{" "}
          <code>docs/examples/verdikt-gate-gha.yml</code>
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" className="btn-ghost accent" onClick={() => copy(GHA_YAML)}>
            Copy workflow snippet
          </button>
        </div>
        <pre className="code-block" style={{ overflow: "auto", fontSize: 11, maxHeight: 220 }}>
          {GHA_YAML}
        </pre>
        <p className="muted" style={{ marginTop: 12, lineHeight: 1.5 }}>
          VCS writeback: when GitHub App is connected, Verdikt posts commit status on verdict. Enable branch
          protection on the GHA check for enforcement at the merge button.
        </p>
      </div>
    </div>
  );
}
