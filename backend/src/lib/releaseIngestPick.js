"use strict";

function normalizeCommitSha(sha) {
  const s = String(sha || "").trim().toLowerCase();
  if (!s) return null;
  return s;
}

function commitShaMatches(stored, candidate) {
  const a = normalizeCommitSha(stored);
  const b = normalizeCommitSha(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = 7;
  if (a.length >= minLen && b.length >= minLen) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

/** In-memory release resolver (same rules as resolveReleaseForWorkspaceIngest). */
function pickReleaseForIngestFromList(
  releases,
  { release_id, release_ref, version, commit_sha, pr_number, github_owner, github_repo, prefer_collecting = true }
) {
  const list = Array.isArray(releases) ? releases : [];
  const sortCollectingFirst = (rows) =>
    [...rows].sort((a, b) => {
      const aC = a.status === "COLLECTING" ? 0 : 1;
      const bC = b.status === "COLLECTING" ? 0 : 1;
      if (aC !== bC) return aC - bC;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });

  if (typeof release_id === "string" && release_id.trim()) {
    const byId = list.find((r) => r.id === release_id.trim());
    if (byId) return byId;
  }

  const sha = normalizeCommitSha(commit_sha);
  if (sha) {
    const owner = String(github_owner || "").trim().toLowerCase() || null;
    const repo = String(github_repo || "").trim().toLowerCase() || null;
    const pr = Number.isFinite(Number(pr_number)) ? Number(pr_number) : null;
    let candidates = list.filter((r) => r.commit_sha != null);
    if (owner && repo) {
      candidates = candidates.filter(
        (r) => String(r.github_owner || "").toLowerCase() === owner && String(r.github_repo || "").toLowerCase() === repo
      );
    }
    if (pr != null) candidates = candidates.filter((r) => Number(r.pr_number) === pr);
    const ordered = prefer_collecting ? sortCollectingFirst(candidates).slice(0, 20) : candidates.slice(0, 20);
    for (const row of ordered) {
      if (commitShaMatches(row.commit_sha, sha)) return row;
    }
    // A supplied SHA is an integrity boundary. Never fall back to another
    // release for the same PR/ref/version when the requested commit is absent.
    return null;
  }

  const prOnly = Number.isFinite(Number(pr_number)) ? Number(pr_number) : null;
  if (prOnly != null) {
    const byPr = sortCollectingFirst(list.filter((r) => Number(r.pr_number) === prOnly))[0];
    if (byPr) return byPr;
  }

  const ref = typeof release_ref === "string" && release_ref.trim() ? release_ref.trim() : null;
  if (ref) {
    const byRef = list.filter((r) => r.release_ref === ref).sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    )[0];
    if (byRef) return byRef;
  }

  const ver = typeof version === "string" && version.trim() ? version.trim() : null;
  if (ver) {
    const byVersion = list.filter((r) => r.version === ver).sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    )[0];
    if (byVersion) return byVersion;
  }

  return null;
}

module.exports = {
  normalizeCommitSha,
  commitShaMatches,
  pickReleaseForIngestFromList
};
