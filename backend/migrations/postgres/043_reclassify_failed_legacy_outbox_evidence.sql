-- Failed legacy deliveries are mismatches even when their payloads matched.
UPDATE outbound_effect_outbox
   SET state = 'shadow_mismatch',
       shadow_result_json =
         COALESCE(shadow_result_json, '{}'::jsonb) ||
         jsonb_build_object(
           'outcome', 'mismatch',
           'reason', 'legacy_delivery_failed'
         ),
       last_error = 'legacy_delivery_failed',
       updated_at = NOW()
 WHERE state = 'shadow_matched'
   AND (
          (
            shadow_result_json->>'legacy_response_status' ~ '^[0-9]+$'
            AND (shadow_result_json->>'legacy_response_status')::int NOT BETWEEN 200 AND 299
          )
       OR COALESCE(shadow_result_json->>'legacy_error', '') <> ''
       OR (
            legacy_response_status IS NOT NULL
            AND legacy_response_status NOT BETWEEN 200 AND 299
          )
       OR legacy_error_code IS NOT NULL
       OR (
            legacy_comparison_json IS NOT NULL
            AND COALESCE(legacy_comparison_json->>'outcome', 'unknown') <> 'succeeded'
          )
   );
