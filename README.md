# LeadForge — Gemfield internal lead generation

Type a niche ("roofers"), pick states; LeadForge pulls every matching business from **free open data** (Overture Maps + Foursquare OS Places, extracted monthly into a local SQLite), scores each one by *how badly it needs a new website* (0–100 with reason chips), finds owner names with quoted evidence, and exports to XLSX / CSV / straight into Google Drive. Internal tool — no billing, no tenants; **data quality and compliance are the product.**

Baseline run cost: **$0**. Optional paid steps (Haiku owner extraction ~$0.001/site, Outscraper top-up $3/1k) sit behind per-campaign toggles, hard budget caps, and a monthly ceiling that defaults to $0.

## Quick start (no keys needed)

```bash
npm ci
npm run dev
```

Open http://localhost:3000. `MOCK_MODE` defaults on: the app self-seeds ~2k businesses through the **real DuckDB ingest path** (bundled Overture-shaped parquet), every adapter runs a deterministic mock, and a "roofers · TX" smoke campaign completes in ~2 seconds at $0.

```bash
npm test          # unit + property + gate suites G1–G8 (199 tests)
npm run e2e       # Playwright mock-mode full campaign E2E
npx tsc --noEmit  # typecheck
```

## Going real

Everything to sign up for is in [docs/LEADFORGE_API_PROCUREMENT_GUIDE.md](docs/LEADFORGE_API_PROCUREMENT_GUIDE.md); the live checklist of what's still parked is [BLOCKERS.md](BLOCKERS.md). Short version:

**Going real — Vercel + Supabase (chosen path, D19):** the full runbook is HANDOFF.md → *Deploy*. Short version: Supabase project (transaction-pooler `DATABASE_URL`, `SUPABASE_URL` + service-role key, private Storage bucket `exports`) → Vercel project with those env vars plus `CRON_SECRET`, `APP_SECRET`, `AUTH_TRUST_PLATFORM=1` + `OPERATOR_EMAIL` (keep Deployment Protection ON — D20) → deploy; migrations run themselves and `vercel.json`'s minute cron drives background jobs. Monthly Overture/FSQ extract runs from any workstation straight into Supabase: `DATABASE_URL=<pooler> npx tsx scripts/workstation-extract.ts TX FL GA`. Backups are Supabase-managed (D21).

**Alternative (self-hosted Docker + Cloudflare tunnel):**

1. Copy `.env.example` → `.env`; set `MOCK_MODE=0`, `APP_SECRET`, `OVERTURE_RELEASE` (2026-08-19.0 — verified live) and `FSQ_RELEASE` (2026-08-11) + `HF_TOKEN` (FSQ moved to a gated HF dataset; free account, auto-approved — BLOCKERS B6).
2. Google Cloud: PageSpeed API key + OAuth client (Drive) → enter in Settings (stored encrypted). Connect Drive once (user OAuth / Shared Drive — never a bare service account).
3. Cloudflare Zero Trust: tunnel + Access app on `leads.gemfieldconsulting.com` → `CF_TUNNEL_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`. The app 401s every request without a valid Access JWT.
4. Host with ≥4 GB RAM: `docker compose up -d --build`. The `/data` volume (PGlite DB, exports, backups) survives redeploys. No inbound ports — the tunnel dials out.
5. Settings → Data → **Run monthly extract** (or on an office machine: `scripts/workstation-extract.ts`).

## Where things are

| | |
|---|---|
| Blueprint | [ARCHITECTURE.md](ARCHITECTURE.md) · [CONTRACTS.md](CONTRACTS.md) |
| Run-state | [STATUS.md](STATUS.md) · [DECISIONS.md](DECISIONS.md) · [BLOCKERS.md](BLOCKERS.md) · GAPSWEEP_*.md |
| Ops runbook | [HANDOFF.md](HANDOFF.md) |
| Source guides | docs/ (build + procurement, vendored) |
| Gates (tests) | tests/ — ingest band G1, taxonomy G2, dedupe determinism G3, score golden G4 (62), owner golden G5 (44 incl. traps), budget invariant G6, export round-trip G7, access gate G8 |

Data attribution (required by license, rendered in-app and in every export): see [data/ATTRIBUTION.md](data/ATTRIBUTION.md).
