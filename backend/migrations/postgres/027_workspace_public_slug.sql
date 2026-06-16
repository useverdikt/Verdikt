-- Public certification record URLs: /cert/:public_slug/:version

ALTER TABLE workspace_policies
  ADD COLUMN IF NOT EXISTS public_slug TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS public_display_name TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_policies_public_slug
  ON workspace_policies (LOWER(public_slug))
  WHERE public_slug IS NOT NULL AND public_slug <> '';
