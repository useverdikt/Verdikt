import { normalizeStoredProject } from "./projectEnv.js";

const PREFS_KEY = "vdk3_workspace_prefs";

function readAllPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAllPrefs(all) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(all));
}

/** @param {string} [workspaceId] */
export function readWorkspaceProdObservation(workspaceId) {
  const wsId = String(workspaceId || "").trim();
  if (!wsId) return false;
  const row = readAllPrefs()[wsId];
  if (row && typeof row.prodObservation === "boolean") {
    return row.prodObservation === true;
  }
  try {
    const raw = localStorage.getItem("vdk3_project");
    if (!raw) return false;
    return normalizeStoredProject(JSON.parse(raw)).prodObservation === true;
  } catch {
    return false;
  }
}

/** @param {string} workspaceId @param {boolean} enabled */
export function writeWorkspaceProdObservation(workspaceId, enabled) {
  const wsId = String(workspaceId || "").trim();
  if (!wsId) return;
  const all = readAllPrefs();
  all[wsId] = { ...(all[wsId] || {}), prodObservation: enabled === true };
  writeAllPrefs(all);
  try {
    const raw = localStorage.getItem("vdk3_project");
    const parsed = raw ? JSON.parse(raw) : {};
    localStorage.setItem("vdk3_project", JSON.stringify({ ...parsed, prodObservation: enabled === true }));
  } catch {
    /* ignore */
  }
}
