# Verdikt docs site (Mintlify)

Public developer docs for [docs.useverdikt.com](https://docs.useverdikt.com).

## Local preview

Mintlify requires **Node 20.17+**. Brand tokens match [useverdikt.com](https://useverdikt.com) — see `docs.json`, `style.css`, and `logo/`.

```bash
cd docs-site
nvm use
npx mintlify dev
```

Configuration: **`docs.json`** (primary). `style.css` overrides navbar/sidebar to match the app dark navy palette.

## Deploy

1. Create a Mintlify project at [mintlify.com](https://mintlify.com)
2. Connect the `useverdikt/Verdikt` GitHub repo
3. Set **docs path** to `docs-site`
4. Add custom domain `docs.useverdikt.com` in Mintlify DNS settings

## Structure

```
introduction.mdx              Quick start
connecting-signals/
  overview.mdx                Pull vs push vs CSV
  api-push.mdx                Partner push setup (primary)
  integration-pull.mdx        Braintrust, LangSmith, …
  csv-upload.mdx
github/
  gate-workflow.mdx           GHA polling
agent/
  api-keys.mdx                vdk_live_ keys
```

Add logo assets under `docs-site/logo/` (referenced in `docs.json`).

## Source of truth

Partner-facing push instructions live in **`connecting-signals/api-push.mdx`**. Internal runbooks in `docs/` may link here rather than duplicating curl examples.
