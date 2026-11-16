-- At most one pending escalation per release. Concurrent escalate calls could
-- insert duplicate pending rows (duplicate emails, SLA reminders, inbox rows).
-- Older duplicates are resolved before the unique index is built; the newest
-- pending row per release stays pending.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY release_id ORDER BY created_at DESC, id DESC) AS rn
    FROM escalation_requests
   WHERE state = 'pending_human_review'
)
UPDATE escalation_requests e
   SET state = 'resolved',
       acknowledged_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       acknowledged_by = 'system:duplicate_pending',
       updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM ranked
 WHERE e.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_escalations_one_pending_per_release
  ON escalation_requests (release_id)
  WHERE state = 'pending_human_review';
