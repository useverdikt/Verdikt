import { createContext, useContext } from "react";

export const WorkspaceShellContext = createContext(null);
export const WorkspaceAuthContext = createContext(null);
export const WorkspaceReleasesContext = createContext(null);
export const WorkspaceThresholdsContext = createContext(null);
export const WorkspaceAuditContext = createContext(null);

function requireContext(value, name) {
  if (!value) throw new Error(`${name} requires WorkspaceProvider`);
  return value;
}

export function useWorkspaceShell() {
  return requireContext(useContext(WorkspaceShellContext), "useWorkspaceShell");
}

export function useWorkspaceAuthCtx() {
  return requireContext(useContext(WorkspaceAuthContext), "useWorkspaceAuthCtx");
}

export function useWorkspaceReleasesCtx() {
  return requireContext(useContext(WorkspaceReleasesContext), "useWorkspaceReleasesCtx");
}

export function useWorkspaceThresholdsCtx() {
  return requireContext(useContext(WorkspaceThresholdsContext), "useWorkspaceThresholdsCtx");
}

export function useWorkspaceAuditCtx() {
  return requireContext(useContext(WorkspaceAuditContext), "useWorkspaceAuditCtx");
}
