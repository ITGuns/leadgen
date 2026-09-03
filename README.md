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

1. Copy `.env.example` → `.env`; set `MOCK_MODE=0`, `APP_SECRET`, and `OVERTURE_RELEASE` (2026-08-19.0 was latest at build time — verified live).
2. Google Cloud: PageSpeed API key + OAuth client (Drive) → enter in Settings (stored encrypted on the volume). Connect Drive once (user OAuth / Shared Drive — never a bare service account).
3. Cloudflare Zero Trust: tunnel + Access app on `leads.gemfieldconsulting.com` → `CF_TUNNEL_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`. The app 401s every request without a valid Access JWT.
4. Host with ≥4 GB RAM: `docker compose up -d --build`. The `/data` volume (DB, exports, backups, encrypted config) survives redeploys. No inbound ports — the tunnel dials out.
5. Settings → Data → **Run monthly extract** (or run it on an office machine: `scripts/workstation-extract.ts`). Drop the pinned release's taxonomy file over `data/overture_taxonomy.csv` (B5) — the ingest gate reports unresolved category values until you do.

## Where things are

| | |
|---|---|
| Blueprint | [ARCHITECTURE.md](ARCHITECTURE.md) · [CONTRACTS.md](CONTRACTS.md) |
| Run-state | [STATUS.md](STATUS.md) · [DECISIONS.md](DECISIONS.md) · [BLOCKERS.md](BLOCKERS.md) · GAPSWEEP_*.md |
| Ops runbook | [HANDOFF.md](HANDOFF.md) |
| Source guides | docs/ (build + procurement, vendored) |
| Gates (tests) | tests/ — ingest band G1, taxonomy G2, dedupe determinism G3, score golden G4 (62), owner golden G5 (44 incl. traps), budget invariant G6, export round-trip G7, access gate G8 |

Data attribution (required by license, rendered in-app and in every export): see [data/ATTRIBUTION.md](data/ATTRIBUTION.md).
