# DECISIONS.md

Running log. Newest last. "Guide" = LEADFORGE_BUILD_GUIDE v2 + PROCUREMENT guide (Sept 2026), both vendored in `docs/`.

- **D1 · Declined data sources (from guide, do not re-litigate):** Google Places API — phone/website live in the Enterprise tier and policy forbids storing place content beyond 30 days, incompatible with a lead database even inside the free allowance. Yelp Fusion — no longer meaningfully free; re-verify terms before ever adding.
- **D2 · Free-first:** Overture Maps primary + FSQ OS Places gap-fill, extracted monthly by DuckDB into local SQLite; paid Outscraper only as per-campaign opt-in top-up behind `ListingsProvider`.
- **D3 · Drive auth:** user OAuth (Workspace account) or Shared Drive — **never a bare service account** (no My Drive quota; uploads fail silently). `drive.file` scope only.
- **D4 · Model policy:** guide asks for Opus 4.8 w/ FABLE_FLAG. This session runs on the environment's model (Fable 5) end-to-end — noted for the record; zero-flag expectation unchanged (pipeline + CRUD app).
- **D5 · HUMAN_CHECK in an autonomous session:** user asked for the system to be built unattended. #B: Blueprint written, auto-proceeded, flagged for review in STATUS. #K: keys parked in BLOCKERS; app boots in MOCK_MODE and real mode per-adapter as keys appear; monthly ceiling defaults **$0**. #C: defaults committed to `config/compliance.json`, review requested. #M: enforced in-product (mapping confirmation UI for first three niches / new niches). #Z: launch checklist in HANDOFF.md, left to the humans.
- **D6 · Runtime versions:** Next 16.3.4 · React 19.2 · Tailwind 4 · Drizzle 0.45 + better-sqlite3 13 · zod 4 · vitest 5 · @duckdb/node-api 1.5.5 · Node 22 (Docker base node:22-slim).
- **D7 · DB path:** dev default `./.data/leadforge.db` (gitignored) so the committed `data/` stays bundled assets only; Docker sets `DATABASE_PATH=/data/leadforge.db` on the volume. Same for `EXPORTS_DIR`, `BACKUPS_DIR`, `CONFIG_DIR`.
- **D8 · Encrypted config store** (OAuth refresh token, entered API keys): AES-256-GCM JSON files under `CONFIG_DIR`, key = SHA-256(`APP_SECRET`). `APP_SECRET` is required in real mode, defaulted in mock.
- **D9 · Overture schema mapping is release-pinned:** the extract SQL targets the September 2026 shape (`taxonomy` property — `categories` deprecated). Column mapping lives in one module (`src/server/ingest/overture.ts`) with the release ID; bumping a release = verify mapping there. Mock fixtures use the same shape, so CI exercises the real SQL path.
- **D10 · Bundled data files are starters:** `data/overture_taxonomy.csv` ships as a curated common-SMB subset until procurement drops in the pinned release's full taxonomy; `data/us_cities.csv` ships as a small starter subset of SimpleMaps basic (CC-BY-4.0, attribution kept) — the full 30k-row file is a procurement download. Both are BLOCKERS items; ingest gate + fan-out read whatever file is present.
- **D11 · No component library:** internal tool; Tailwind only, zero extra UI deps.
- **D12 · Google APIs via raw `fetch`** (OAuth token exchange, Drive multipart/resumable upload, PageSpeed) — the googleapis SDK is ~10 MB of dependency for three endpoints.
- **D13 · Worker singleton via `instrumentation.ts`** with a `globalThis` guard (dev HMR safe); cron = 1-minute ticker inserting jobs, so scheduled work shares the resumable job machinery.
- **D14 · Fetcher is an interface too:** in mock mode a deterministic `MockFetcher` serves fixture HTML by domain hash so website-check, owner extraction, and the score golden set run keyless and offline (CI).
- **D15 · Name-similarity for conflation:** Jaro-Winkler ≥ 0.85 + haversine ≤ 50 m (C4). Implemented in-repo (~30 lines) rather than adding a dependency.
