import { useCallback } from "react";
import {
  useWorkspaceAuditCtx,
  useWorkspaceAuthCtx,
  useWorkspaceReleasesCtx,
  useWorkspaceShell,
  useWorkspaceThresholdsCtx
} from "../context/workspaceContext.js";

/** Aggregates split workspace contexts — use inside WorkspaceProvider. */
export function useWorkspaceSync() {
  const shell = useWorkspaceShell();
  const auth = useWorkspaceAuthCtx();
  const releases = useWorkspaceReleasesCtx();
  const thresholds = useWorkspaceThresholdsCtx();
  const audit = useWorkspaceAuditCtx();

  return {
    ...shell,
    ...auth,
    ...releases,
    ...thresholds,
    ...audit,
    currentUser: auth.currentUser,
    setCurrentUser: auth.setCurrentUser
  };
}

export function useAuditRecordOpener({ openAuditRecord, setAuditDetail, showToast, toastColor }) {
  return useCallback(
    async (linkedRelease, backendReleaseId) => {
      if (linkedRelease) {
        setAuditDetail(linkedRelease);
        return;
      }
      const mapped = await openAuditRecord(linkedRelease, backendReleaseId, { showToast, toastColor });
      if (mapped) setAuditDetail(mapped);
    },
    [openAuditRecord, setAuditDetail, showToast, toastColor]
  );
}
