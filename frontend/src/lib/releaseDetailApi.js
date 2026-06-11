import { apiGet } from "./apiClient.js";
import { mapBackendDetailToUi } from "../app/main/appMainLogic.js";

/** Fetch full release detail and map to UI release shape. */
export async function fetchAndMapReleaseDetail(backendReleaseId, navigate) {
  const detail = await apiGet(`/api/releases/${backendReleaseId}`, { navigate });
  return mapBackendDetailToUi(detail);
}
