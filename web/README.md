# Navis AI — Web Dashboard

A private, glassy iOS-style dashboard for the Navis AI market pipeline.

- **Dashboard** — latest AI market summary, sentiment, recent SEC filings, portfolio value
- **Portfolio** — track positions and see realtime unrealized P&L (USD + %)
- **Watchlist** — manage the tickers the bots watch (no code edits)
- **Settings** — alert thresholds + toggles

## Stack

- React + Vite + TypeScript (no build-time secrets — the Supabase anon key is public-safe)
- Supabase: Postgres (RLS), Auth (magic link), Edge Functions
- Hosted free on GitHub Pages via GitHub Actions

## Access

Login is restricted to pre-approved emails (magic link). Public sign-ups are disabled.

## Local development

```bash
cd web
npm install
npm run dev   # http://localhost:5173/navis-ai/
```

## Deploy

Pushing changes under `web/**` to `main` triggers
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml),
which builds and publishes to GitHub Pages automatically.
