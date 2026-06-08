-- Split recommendation engine output from user intelligence decisions (decision_json).
ALTER TABLE release_intelligence
  ADD COLUMN IF NOT EXISTS recommendation_json TEXT;

-- Move existing recommendation blobs out of decision_json (user decisions stay put).
UPDATE release_intelligence
SET recommendation_json = decision_json,
    decision_json = NULL
WHERE recommendation_json IS NULL
  AND decision_json IS NOT NULL
  AND (
    decision_json LIKE '%"confidence_score"%'
    OR decision_json LIKE '%"recommended_verdict"%'
  );
