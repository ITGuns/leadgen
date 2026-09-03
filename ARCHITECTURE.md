# LeadForge — Architecture (P0 Blueprint)

Internal lead-generation tool for Gemfield. One Next.js full-stack app, one SQLite file, no external services in the free path. Data quality and compliance are the product.

## A1. System shape

```
┌────────────────────────────────────────────────────────────────────┐
│ Docker host (VPS ≥4GB / office machine) — no inbound ports         │
│                                                                    │
│  ┌──────────────┐   http://leadforge:3000   ┌───────────────────┐  │
│  │  cloudflared  │──────────────────────────▶│  leadforge (Next) │  │
│  │  (tunnel)     │                           │  · App Router UI  │  │
│  └──────────────┘                           │  · API routes     │  │
│         ▲ outbound only                      │  · in-proc worker │  │
│         │                                    │  · in-proc crons  │  │
│  Cloudflare Access (Google IdP,              └─────────┬─────────┘  │
│  @gemfieldconsulting.com policy)                       │            │
│                                             /data volume (survives │
│                                             redeploys):            │
│                                             leadforge.db (WAL)     │
│                                             exports/ backups/      │
│                                             config/ (enc. tokens)  │
└────────────────────────────────────────────────────────────────────┘
External (all optional at runtime): Overture S3 (anon), FSQ parquet (anon),
PageSpeed API, Anthropic API, Outscraper API, Google Drive API.
```

- **App**: Next.js 16 + TypeScript + Tailwind 4, App Router, single deployable.
- **DB**: SQLite via Drizzle + better-sqlite3, WAL mode, one file at `DATABASE_PATH` (default `./.data/leadforge.db` in dev, `/data/leadforge.db` in Docker). Migrations run programmatically at boot.
- **Jobs**: in-process worker over a persisted `jobs` table; `p-queue` for concurrency; jobs are resumable checkpoints, not fire-and-forget promises. Worker + cron scheduler start from `instrumentation.ts` (guarded singleton, survives dev HMR).
- **Auth**: Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) verified on every request via `proxy.ts` + a node-side guard in API handlers; `MOCK_MODE=1` substitutes `dev@gemfieldconsulting.com`.
- **AI / paid providers**: behind adapters (`AIProvider`, `ListingsProvider`, `PageSpeedProvider`, `DrivePort`, `Fetcher`), each with a mock twin selected by `MOCK_MODE` or missing keys.

## A2. Source layout

```
src/db/            schema.ts · client.ts · migrate.ts
src/server/
  config.ts        env parsing + defaults; runtime settings (DB-backed) merge
  secure-store.ts  AES-256-GCM encrypted JSON store on the volume (OAuth tokens)
  auth.ts          CF Access JWT verify (jose, cached JWKS) + mock identity
  audit.ts         audit_log writes
  normalize.ts     phone/domain/name normalization (CONTRACTS C2)
  identity.ts      identity-key derivation (CONTRACTS C3)
  classify.ts      URL classification (CONTRACTS C5)
  scoring/         rubric loader + engine (config/score-rubric.json)
  fetcher/         polite HTTP fetcher: robots.txt, per-domain ≤2 / global 10, 8s, UA; + mock
  providers/       listings/{outscraper,mock} · ai/{anthropic,heuristic,mock}
                   pagespeed/{real,mock} · drive/{real,oauth,mock}
  ingest/          overture.ts · fsq.ts · conflate.ts · taxonomy.ts · releases.ts · gate.ts · chains.ts
  jobs/            worker.ts · registry.ts · cron.ts · handlers/*
  pipeline/        estimate.ts · scheduler.ts (global limits, round-robin) · stages/*
  budget.ts        intents, cap guard, spend ledger
  suppression.ts   client / DNC lists, matching
  exports/         xlsx.ts (streaming) · csv.ts · columns.ts
  campaigns.ts / leads.ts   domain queries for the UI
src/app/           (UI + /api routes; UI ships last — gates before UI)
config/            score-rubric.json · compliance.json · app.json
data/              overture_taxonomy.csv · niche_mappings.json · us_cities.csv
                   known_chains.txt · state_bboxes.json  (+ attribution notes)
fixtures/          mock parquet (Overture-shaped ×2) · golden sets (score/owner/taxonomy)
scripts/           generate-fixtures.ts · workstation-extract.ts (+ docs)
tests/             vitest unit/property/gate suites
e2e/               Playwright mock-mode campaign E2E
```

## A3. Data flow

1. **Monthly ingest** (`ingest_overture` job): DuckDB (`@duckdb/node-api`, httpfs) reads the pinned Overture release from the public bucket. Query discipline: **bbox columns first** (predicate pushdown per state bbox from `data/state_bboxes.json`), then `addresses[1].region` = state code, bbox+polygon fallback only for records lacking an address. Writes `places_overture` keyed by GERS ID, then `ingest_fsq` writes `places_fsq` (US + selected regions), then `conflate` merges into `businesses`. Each run is a versioned `releases` row; the **ingest gate** (row-count bands vs previous, GERS presence, taxonomy resolution, no differing-verified-phone merges) must pass before the release flips to `active`; the previous release is kept until then. `release_diff` computes new/changed/disappeared for freshness. In `MOCK_MODE`, the identical DuckDB path reads `fixtures/mock/*.parquet` — the real code path runs keyless in CI.
2. **Campaign run** (`campaign_run` job): stages `plan → pull → dedupe → website_check → pagespeed → owner_extract → score → ready` (CONTRACTS C7). Pull is a **local SQL query** (taxonomy set × states × filters) against `businesses` — instant, $0. The optional paid top-up (Outscraper) fans out per city (SimpleMaps, population floor 5,000) with intent rows and the budget guard before every billable call.
3. **Enrichment**: URL classification decides everything downstream; only `real_site` gets PageSpeed + owner extraction. A **global scheduler** owns the shared PageSpeed daily quota and fetch concurrency and round-robins work units across concurrently-running campaigns.
4. **Workspace**: leads are global (one row per business, `campaign_leads` join holds history); status pipeline, notes, tags, assignee, bulk ops.
5. **Exports**: background jobs; streaming XLSX / CSV to `EXPORTS_DIR`; optional Drive push via stored OAuth. DNC + not-interested excluded by default; toggle audit-logged.
6. **Freshness** (`freshness` cron, weekly): no-spend re-check (fetch + cached PageSpeed) of leads in active statuses; flags launched sites / dead hosts; bumps `lastVerifiedAt`.
7. **Backup** (`backup` cron, nightly 03:15): better-sqlite3 online `backup()` → gzip → `/data/backups` → Drive when configured; 30-day retention; never a raw copy of a live WAL DB.

## A4. Job & scheduler model

- `jobs` table is the source of truth; worker claims `pending` jobs transactionally (single process — SQLite serializes), runs handlers from `registry.ts` under `p-queue` (default concurrency 2), heartbeats, checkpoints `progress` JSON after every batch.
- Crash recovery: on boot every `running` job reverts to `pending`; handlers are written to resume from their checkpoint (stage + cursor), and every provider effect is guarded by an intent row, so **resume never double-bills** (§4.3 of the build guide).
- Pause/cancel: flags on the campaign row; stage loops check between batches and exit cleanly; resume re-enqueues.
- Cron: in-process ticker (1 min) fires `backup` (daily 03:15) and `freshness` (weekly Sun 04:00) by inserting jobs — so scheduled work is visible/resumable like everything else.
- Global scheduler singleton: PageSpeed quota counter (per-day row, default limit 25,000 with a 500 safety margin), website-fetch limiter (≤2/domain, ≤10 global), round-robin dispenser keyed by campaign so two simultaneous runs share fairly.

## A5. Trust & compliance boundaries

- All inbound traffic passes Cloudflare Access; the app additionally verifies the Access JWT on **every** route (pages, API, downloads) — 401 otherwise. The tunnel is the only door; nothing else is ever exposed.
- Secrets live in `.env` (host) or the encrypted config store (`/data/config`, AES-256-GCM under `APP_SECRET`); never in the DB, never committed.
- Fetching: identified UA from `config/compliance.json`, robots.txt honored, business-owned pages only. No scraping of personal social profiles. LeadForge stores and exports; it never sends outreach.
- Attribution (Overture CDLA-Permissive-2.0 / FSQ Apache-2.0 / SimpleMaps CC-BY-4.0) renders in Settings → About and in every export's metadata sheet. Do not remove.

## A6. Phases (build order)

P0 this document + CONTRACTS → P1 data core (schema, normalization, worker, budget invariant, mocks; gates green) → P2 data (ingest, conflation, taxonomy, enrichment providers, golden sets; top-up last) → P3 campaign builder + pipeline UI + leads workspace → P4 exports + suppression + audit → P5 ops (Access verify, Docker, backups, settings, spend, HANDOFF) → #Z.
