/** Workspace-scoped localStorage helpers (demo / offline fallback). */
export const S = {
  get: (k, d) => {
    try {
      const v = localStorage.getItem("vdk3_" + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem("vdk3_" + k, JSON.stringify(v));
    } catch {
      /* ignore quota / private mode */
    }
  }
};
