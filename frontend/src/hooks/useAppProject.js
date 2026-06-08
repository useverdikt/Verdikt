import { normalizeStoredProject } from "../lib/projectEnv.js";
import { S } from "../app/main/appMainLogic.js";

/** Workspace project metadata from localStorage (settings + sidebar). */
export function useAppProject() {
  const parsed = S.get("project", null);
  const raw = localStorage.getItem("vdk3_project");
  let fallback = null;
  if (!parsed && raw) {
    try {
      fallback = JSON.parse(raw);
    } catch {
      fallback = { name: String(raw), feature: "", env: "UAT" };
    }
  }
  const p = parsed || fallback || {};
  const orgName = (localStorage.getItem("vdk3_org") || "").trim();
  const n = normalizeStoredProject(p);
  return {
    name: (p.name && String(p.name).trim()) || orgName || "Project",
    feature: (p.feature && String(p.feature).trim()) || "",
    env: (n.env && String(n.env).trim()) || "UAT",
    certEnvs: n.certEnvs,
    prodObservation: n.prodObservation
  };
}
