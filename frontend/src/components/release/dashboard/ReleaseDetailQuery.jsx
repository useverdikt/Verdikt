import { useNavigate } from "react-router-dom";
import { hasBackend } from "../../../lib/hasBackend.js";
import {
  mergeReleaseDetailForDisplay,
  useReleaseDetailQuery
} from "../../../queries/useReleaseDetailQuery.js";
import ReleaseDetail from "./ReleaseDetail.jsx";

export default function ReleaseDetailQuery({ release, ...props }) {
  const navigate = useNavigate();
  const backendReleaseId = release?.backendReleaseId;
  const queryEnabled = Boolean(hasBackend() && backendReleaseId);
  const detailQuery = useReleaseDetailQuery(backendReleaseId, navigate, {
    enabled: queryEnabled
  });
  const detailRelease = queryEnabled
    ? mergeReleaseDetailForDisplay(release, detailQuery.data)
    : release;

  return (
    <ReleaseDetail
      {...props}
      release={detailRelease}
      detailLoadError={queryEnabled && detailQuery.isError ? detailQuery.error : null}
      onRetryDetail={queryEnabled ? detailQuery.refetch : null}
    />
  );
}
