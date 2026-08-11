CREATE INDEX IF NOT EXISTS idx_releases_collecting_deadline
  ON releases (collection_deadline, id)
  WHERE status = 'COLLECTING'
    AND collection_deadline IS NOT NULL;
