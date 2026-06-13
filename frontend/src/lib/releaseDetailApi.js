import { apiGet } from "./apiClient.js";
import { mapBackendDetailToUi, mapBackendSummaryToUi } from "../app/main/appMainLogic.js";

/** Fetch full release detail and map to UI release shape. */
export async function fetchAndMapReleaseDetail(backendReleaseId, navigate) {
  const detail = await apiGet(`/api/releases/${backendReleaseId}`, { navigate });
  return mapBackendDetailToUi(detail);
}

/** Fetch lightweight summary (signals + alignment) for trend/list hydration. */
export async function fetchAndMapReleaseSummary(backendReleaseId, navigate) {
  const detail = await apiGet(`/api/releases/${backendReleaseId}/summary`, { navigate });
  return mapBackendSummaryToUi(detail);
}
