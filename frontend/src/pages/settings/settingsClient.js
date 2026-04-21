/**
 * Settings feature entry points for API access — re-exports shared client so imports stay stable.
 * @see ../../lib/apiClient.js
 */
export {
  resolveApiOrigin,
  apiFetchInit,
  authHeaders,
  authFetchHeaders,
  onApiUnauthorized,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  apiPostFormData,
  getWorkspaceId
} from "../../lib/apiClient.js";
