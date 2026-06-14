-- Backfill connector catalog rows for DBs seeded before LangSmith / ZizkaDB were added.

INSERT INTO connector_signal_map (source_id, signal_id, display_name, direction, ingest_mode) VALUES
  ('langsmith', 'accuracy', 'Accuracy', 'min', 'pull'),
  ('langsmith', 'safety', 'Safety', 'min', 'pull'),
  ('langsmith', 'tone', 'Tone', 'min', 'pull'),
  ('langsmith', 'hallucination', 'Hallucination', 'min', 'pull'),
  ('langsmith', 'relevance', 'Relevance', 'min', 'pull'),
  ('zizkadb', 'behavioural_drift', 'Behavioural Drift', 'max', 'push'),
  ('zizkadb', 'session_anomaly_rate', 'Session Anomaly Rate', 'max', 'push')
ON CONFLICT (source_id, signal_id) DO NOTHING;
