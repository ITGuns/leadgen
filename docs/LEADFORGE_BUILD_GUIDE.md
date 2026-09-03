# Gemfield LeadForge — Internal Lead Generation Tool — Autonomous Build Guide
### Opus 4.8 default · Fable 5 by flag only · HUMAN_CHECK + GAP_SWEEP protocols · Internal MVP · v2 — FREE-FIRST DATA

**How to run:** fresh repo, Claude Code on **Opus 4.8**, paste this file. Fable-Init discipline applies (Blueprint before code, session handoffs, production bars, no TODOs in core paths). This is an internal tool, not a SaaS: no billing, no multi-tenancy, no marketing — but every lead it produces feeds Gemfield's sales pipeline, so **data quality and compliance are the product.**

**What it does in one sentence:** you type a niche ("roofers") and pick states; it pulls every matching business with phone, website, and owner name where findable, scores each one by *how badly it needs a new website*, and exports the list to XLSX or straight into a Google Drive folder.

---

## 1. Inputs, sources, and the cost model (decided — verified September 2026)

**Free-first architecture.** Listings come from open datasets, not a paid API. Paid providers exist only as an optional top-up behind the same adapter.

| Need | Source | Cost | Notes |
|---|---|---|---|
| Business listings: name, address, phone, website, socials, emails, category, operating status | **Overture Maps Places** (primary) — monthly GeoParquet release, CDLA-Permissive-2.0 / Apache-2.0; ~64–74M places, majority sourced from Meta (Facebook business data) | **$0** | Queried with DuckDB directly from the public release, US slice extracted once per month into the local DB (§4.0). Carries a per-record confidence score |
| Second source for conflation / gap-fill | **Foursquare OS Places** — Apache-2.0 parquet | **$0** | Merged by name+phone+location matching; adds coverage and cross-validates phones/websites |
| Optional paid top-up for a specific geo where free coverage is thin | Outscraper Google Maps API via the same `ListingsProvider` adapter | $3/1k, 500 free/mo | **Off by default**; a campaign opts in with its own budget cap |
| Owner name | Own website fetch → **free heuristic extractor** (owner/founder/proprietor patterns with quoted evidence) → optional **Haiku 4.5** structured extraction for higher recall | $0 / ~$0.001 per site | Haiku is the only non-free step and is a per-campaign toggle |
| Website quality | **Google PageSpeed Insights API** (free, 25k/day) + own fetch heuristics | $0 | The Opportunity Score engine |
| Niche → categories | Overture **category taxonomy** mapping (the `taxonomy` property — the older `categories` property is deprecated as of the September 2026 release), assisted by Haiku or a curated mapping file, human-confirmed | $0 / negligible | Mappings persist in the catalog |
| Export | ExcelJS → .xlsx · Google Drive API | $0 | Drive auth is user OAuth or a Shared Drive — never a bare service account (no My Drive quota; fails silently) |

**Declined, in `DECISIONS.md`:** Google Places API (phone/website in the Enterprise tier; policy forbids storing place content beyond 30 days — incompatible with a lead database, even inside its free allowance). Yelp Fusion (no longer meaningfully free; verify before ever adding).

**Honest tradeoffs of free-first:** freshness is monthly, not live (closed businesses linger until §4.5's checks catch them); **no ratings or review counts** exist in the open data — the "real business" filter becomes confidence score + verified phone + verified website; coverage of the very smallest businesses trails Google Maps, which is what the optional paid top-up is for.

**Run cost model, shown before every run:** `$0` baseline; `+ sites × ~$0.001` if Haiku extraction is toggled on; `+ records × $0.003` only if a paid top-up is enabled. A campaign's **hard budget cap** (§4.3) applies to whichever paid steps are on — and is simply `$0` by default.

## 2. Stack & hosting (internal, near-zero cost)

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16 + TypeScript + Tailwind**, single full-stack app | The team already runs Next.js on the Gemfield site and Deskii |
| DB | **SQLite via Drizzle** (`better-sqlite3`, WAL mode), single file **on a mounted Docker volume** (`/data/leadforge.db`) | Zero infrastructure; hundreds of thousands of leads is trivial for SQLite; backup = copy a file. The Dockerfile builds the native module in a multi-stage image; a redeploy must never touch the volume |
| Jobs | In-process worker with a **persisted job table** (SQLite) and `p-queue` concurrency; jobs resume after restart | No Redis, no extra services |
| AI | Anthropic Haiku 4.5 behind an `AIProvider` adapter, zod-validated outputs | Cheap, fast, mockable |
| Hosting | **Docker Compose on a ~$5/mo VPS** (Hetzner/DigitalOcean) *or* an always-on office machine | Either is fine; the spec must work on both |
| Access & auth | **Cloudflare Tunnel + Cloudflare Access** (free ≤50 users) on `leads.gemfieldconsulting.com` — a free subdomain of the domain you already own | No open ports, no TLS to manage, Google-login gating with zero auth code: the app verifies the Cloudflare Access JWT header (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` config, keys fetched from the team's certs endpoint and cached) and trusts the identity; `MOCK_MODE=1` substitutes a fixed dev identity so local runs work without a tunnel. Tailscale is the documented alternative for a pure private network |
| Backups | Nightly snapshot via **SQLite's online backup API** (never a raw copy of a live WAL database), gzipped, pushed to the Drive folder, 30-day retention | The lead DB is the asset; a corrupt backup is worse than none |

No expensive domain, no managed database, no auth SaaS. Monthly infra cost: the VPS, or nothing.

---

## 3. Features (MVP — all required)

### 3.1 Campaign builder
- **Niche input:** free text → Haiku proposes matching Outscraper categories → **the user confirms the category set** (chips, add/remove) before anything runs. Mappings are saved and reused: **a niche whose mapping was previously confirmed auto-applies** (with an "edit" affordance), so HUMAN_CHECK #M fires only for the first three niches and for genuinely new ones — never for every run.
- **Geography:** multi-select states (50 + DC); optional city/ZIP list upload for precision; **automatic city fan-out** per §4.1 so state-level coverage is actually complete.
- **Filters:** has website (any / yes / no — by classification), **minimum Overture confidence score** (default 0.6), has phone, operating status open, source (Overture / FSQ / both / paid top-up), exclude national chains (§4.2). No ratings filter exists in v1 — the open data has none, and the UI says so rather than showing an empty column.
- **Contact-channel rule:** by default a business must have at least one of phone / website / email to enter results (an "include contactless" toggle exists, off by default — those records are almost always noise). **Every campaign records the Overture/FSQ release version it queried** so results are reproducible after a monthly rollover. **Caps:** max records, **hard budget cap in dollars**, and the live cost estimate. Run button is disabled until the estimate is under the cap. **Smoke-test mode:** a one-click "first 200 records only" run for validating category mapping and field quality — and, when a paid top-up is enabled, keys and spend — before a full campaign.

### 3.2 Pipeline (per campaign, resumable, observable)
`plan → pull listings → dedupe → website check → PageSpeed → owner extraction → score → ready`. A **single global scheduler** owns provider concurrency and the PageSpeed daily quota across all campaigns (two staff launching runs at once share limits fairly by round-robin rather than starving each other). Progress bar with counts per stage, live cost accrual, pause/resume/cancel, per-stage error counts with retry. Every stage is idempotent; a crash mid-run resumes without double-billing (§4.3).

### 3.3 Enrichment & the Opportunity Score
- **URL classification first:** Overture provides `websites` and `socials` as separate fields — a business whose only link is a Facebook/Instagram page is classified `social_only` (a hot lead), never "has website." Beyond that, a listing's website field is frequently junk — link shorteners, aggregator pages (Yelp/Angi/HomeAdvisor/Facebook), parked domains, dead hosts. Classify before anything else: `real_site | social_only | aggregator | parked | dead | none`. Only `real_site` proceeds to PageSpeed; `aggregator`/`parked`/`dead` score like `none` (they *are* no-website leads, with a chip explaining why). The `has website` filter uses the classification, never the raw field.
- **Website check:** resolves? SSL? redirects to Facebook/Instagram/Linktree/Yelp (= "no real website")? site-builder fingerprint (Wix/Squarespace/GoDaddy/Weebly/WordPress/custom)? copyright year? contact form / booking / click-to-call present? mobile viewport meta?
- **PageSpeed (mobile):** performance score, LCP — cached 30 days per domain.
- **Owner extraction:** fetch homepage + About/Team pages (rate-limited, robots-respecting, identified user agent) → Haiku extracts `{ownerName?, role?, evidenceSnippet, confidence}`; **no snippet = no name** (anti-hallucination rule); the extraction prompt accepts a name only when the page ties it to *this* business as owner/founder/proprietor/principal — never team rosters, reviewers, franchise executives, or web-designer credits — and multi-location sites yield `confidence: low` by rule; Outscraper's owner field is merged when present.
- **Opportunity Score (0–100) with reasons:** no website → 95; social-only → 85; builder site + poor mobile score → 60–80; decent site → 20–40; strong site → <20. Reasons render as chips ("No website", "Mobile score 31", "Built on GoDaddy", "© 2016"). The rubric lives in one config file with a golden set (§4.5).

### 3.4 Leads workspace
Sortable/filterable table (score, state, category, has-website, rating, owner found, status), search, detail drawer (all fields + evidence + raw source), **status pipeline** (new → contacted → interested → not interested → DNC), notes, assignee, tags, bulk actions. **Cross-campaign dedupe:** a business pulled twice is one lead with campaign history.

### 3.5 Exports
- **XLSX download** runs as a **background export job** with a streaming writer (ExcelJS streaming API) and a download link when ready — a 50k-row export must not block a request or spike memory; column picker, formatted header, frozen row, hyperlinked websites, score coloring; filename `leadforge_{niche}_{states}_{date}.xlsx`.
- **Direct to Google Drive:** one click into a configured folder; link returned; optional per-campaign subfolder.
- CSV for CRM imports. **DNC and `not interested` leads are excluded from exports by default** (toggle, audit-logged).

### 3.6 Suppression & compliance
- **Do-not-prospect list (separate from DNC):** existing Gemfield clients — imported by domain/phone from the client roster (and, when the Deskii bridge ships, synced from its client organizations) — are tagged `client` and excluded from campaigns and exports by default. Cold-calling a current customer is an avoidable embarrassment; this list prevents it structurally.
- **DNC/suppression list:** import numbers/domains; suppressed leads never export and show a badge. The National DNC registry applies to some sole-proprietor/cell numbers — the suppression list is where your scrubbed results go, and the UI says so.
- Per-lead **do-not-contact** one-click; audit log of exports (who, when, how many).
- **Email outreach:** the open data includes business emails; they export in their own column, and the compliance config (#C) covers CAN-SPAM basics — identification, physical address, working unsubscribe — for any email campaign built from an export. LeadForge stores and exports; it never sends.
- Data hygiene: business-public data only; no scraping of personal social profiles; owner extraction limited to the business's own site.

### 3.7 Settings & ops
API keys (Outscraper, Anthropic, PageSpeed, Drive OAuth), Drive folder, default caps, category catalog editor, concurrency limits, backup status, spend this month.

---

## 4. Technical decisions

### 4.0 Free-first ingestion (the new core)
- **Monthly extract job:** DuckDB (with the `httpfs` extension installed at build time, anonymous access to the public bucket, release path pinned in config and bumped monthly) reads the current Overture Places release directly from the public parquet (AWS Open Data bucket — no credentials, no requester-pays; Azure mirror as fallback). **Query discipline:** always pre-filter on the record `bbox` columns (predicate pushdown) *before* any other test, or DuckDB scans the global file; select states by the address **region code** (`US-TX`) rather than polygons, with a bbox+polygon fallback only for records lacking an address. The job pulls the fields LeadForge uses, and writes a local `places_overture` table keyed by Overture's stable GERS ID. FSQ OS Places is extracted for the same states (country = US, region filter) into `places_fsq` and used in v1 **only as phone/website gap-fill on matched Overture records** — not as an independent campaign source, which would require a second taxonomy crosswalk for little gain. A full US extract is a few GB on disk and runs unattended; the host needs **≥4 GB RAM** for DuckDB and 20 GB disk — a 2 GB VPS will fail the extract. Alternative: run the extract on an office machine and upload the resulting DB file (a documented script).
- **Conflation:** the two sources merge into `businesses` by normalized phone → normalized domain → (name + ~50m location) matching; conflicts keep both values with source attribution, and the UI shows which source said what.
- **Release management:** each release is versioned; a new monthly release diffs against the previous — new businesses, changed websites/phones, disappeared records — feeding §4.5 freshness. The previous release is retained until the new one passes the ingest gate.
- **Campaign queries are local and instant:** niche (taxonomy set) × states × filters runs against the local DB; no per-query cost, no rate limits, no fan-out. The §4.1 city fan-out applies **only to the paid top-up path**.
- **Attribution:** Overture and Foursquare attribution appear in Settings → About and in every export's metadata sheet, per their licenses.

### 4.1 Coverage: city fan-out (paid top-up only)
Google Maps caps results per query (~a few hundred), so "HVAC, Texas" as a single query silently misses most of the state. The planner fans out **per city** using a bundled free US places dataset (**SimpleMaps US Cities basic tier, CC-BY-4.0, ~30k rows, shipped in-repo as `data/us_cities.csv` with attribution page**), ordered by population **with a configurable population floor (default 5,000)** so a state fans out to a few hundred meaningful queries rather than every hamlet, and merges + dedupes results. The estimate accounts for fan-out. Users see coverage: "412 cities queried."

### 4.2 Chain exclusion
Heuristic + list: a name appearing in ≥ N states across the DB, or on a maintained `known_chains.txt`, is flagged `chain: true` and excluded when the filter is on — reviewable, never deleted. Local franchisees are still leads; the flag is a filter, not a verdict.

### 4.3 Idempotency & cost safety
Provider calls are recorded before they're made (intent row with a hash of the query); results are keyed on provider IDs; a resumed run skips completed intents. **Budget cap is checked before every billable call, not just at planning** — a run can never exceed its cap by more than one page of results. Actual spend is read back from provider responses where available and estimated otherwise, both stored.

### 4.4 Rate limits & politeness
Outscraper jobs are async: submit → poll (backoff, max 30 min) → paginate results; respect their rate limits. **Failure paths specified:** a job stuck past the timeout is marked `stalled` and surfaced (not retried blindly — resubmitting re-bills); partial results are persisted page-by-page so nothing fetched is lost; **a submitted job is billed whether or not results are fetched**, so the intent row is written before submit and the fetch is retried until complete or explicitly abandoned by a human. Website fetches: ≤ 2 concurrent per domain, 10 global, 8s timeout, honor robots.txt, no JS rendering in v1. PageSpeed: 25k/day quota tracked; throttled and cached.

### 4.5 Freshness
Websites appear, businesses close, scores decay. Each lead carries `lastVerifiedAt`; a weekly low-cost job re-checks website status (our fetch + cached PageSpeed, no provider spend) for leads in active statuses, flags newly-launched sites (a "no website" lead that now has one is *gone* as a hot lead) and dead phones/closed businesses reported by later pulls. Re-pulling a provider category is a manual, budgeted decision, never automatic.

### 4.6 Gates (measured, never claimed)
- **Ingest gate:** per-state extract row counts within an expected band (a state that suddenly loses 40% of businesses fails the gate and keeps the prior release); every record has a GERS ID; taxonomy values all resolve against the bundled taxonomy file; conflation never merges two records with different verified phones.
- **Taxonomy mapping golden set:** 30 niche phrases ("roofers", "septic pumping", "PI lawyer") → expected taxonomy sets.
- **Dedupe determinism:** the same raw pull twice yields identical lead sets. Normalization is specified: phones → E.164 via `libphonenumber-js` (US default region); websites → scheme-stripped, `www`-stripped, lowercased host + path, trailing slash removed, tracking params dropped; identity key = provider place ID, else (normalized phone), else (normalized domain + normalized name). Property-tested.
- **Score rubric golden set:** 60+ fixture sites (no site, social-only, each builder, good custom) → expected score band; rubric changes must keep it green.
- **Owner extraction golden set:** 40+ page fixtures incl. must-not-extract traps (a reviewer's name, a franchise CEO) — no snippet, no name.
- **Budget-cap invariant:** property test over generated plans — spend never exceeds cap + one page.
- **Export round-trip:** DB → XLSX → parse → identical rows; DNC never present.
- **Access gate:** requests without a valid Cloudflare Access JWT get 401 on every route including exports.

### 4.7 Mock mode
`MOCK_MODE=1`: a tiny bundled Overture-shaped parquet fixture (three states, ~2k rows) so the real DuckDB ingest path runs in CI without touching the internet, `MockListingsProvider` for the paid top-up, `MockPageSpeed`, `MockAI`, Drive → a local `./exports` folder, frozen clock. The full pipeline and every export run keyless in CI; real-mode runs need keys and are parked in `BLOCKERS.md` until provided.

---

## 5. Protocols
- **Model policy:** Opus 4.8 for everything including orchestration; **FABLE_FLAG** only for genuine novelty or two-strikes. Expectation: **zero flags** — this is a pipeline + CRUD app.
- **HUMAN_CHECK (blocking):** #B Blueprint · #K keys entered (PageSpeed + Drive OAuth required; Anthropic and Outscraper optional) + monthly spend ceiling, default $0 · #C compliance config (DNC process, export exclusions, the identified user agent string) · #M category-mapping review for the first three niches · #Z pre-launch.
- **GAP_SWEEP** pre + post per phase → `GAPSWEEP_<phase>_{pre|post}.md`; checklist in `CONTRACTS.md`.
- **Run-state:** `STATUS.md`, `DECISIONS.md`, `BLOCKERS.md`; Fable-Init session handoffs.

## 6. Phases
**P0** Blueprint (`ARCHITECTURE.md`, `CONTRACTS.md` incl. lead schema, provider interfaces, score rubric format) → #B. **P1** Data core: schema, dedupe normalization, job table + worker, budget-cap invariant, mock providers → gates green. **P2** Data: Overture + FSQ extract jobs (DuckDB), conflation, taxonomy catalog, release diffing → ingest gate; PageSpeed, website checker, heuristic + Haiku owner extraction + golden sets; Outscraper adapter + city fan-out as the optional top-up (built last in the phase). **P3** Campaign builder + pipeline UI + leads workspace. **P4** Exports (XLSX, Drive, CSV) + suppression + audit → round-trip gate. **P5** Ops: Cloudflare Access JWT verification, Docker Compose, nightly backup, settings, spend dashboard, `HANDOFF.md`; full sweep → #Z.

## 7. Definition of done
**Machine:** all §4.6 gates green · mock-mode full campaign E2E (Playwright) green · keyless CI · Docker Compose up on a clean VM. **Human:** the monthly Overture extract for one state completes on the VPS and row counts look sane against a spot-check of ten known local businesses; a "roofers in Texas" campaign runs at $0 and completes in seconds, the leads table ranks a no-website business at the top, an owner name shows with its evidence snippet, the XLSX opens cleanly in Excel, the Drive push lands in the folder, and a colleague without Access is refused.

## 8. Kickoff
1. Read fully; write the three likeliest breakpoints to `STATUS.md` (candidates: Overture taxonomy mapping quality, conflation false-merges, owner hallucination).
2. Pre-sweep P0 → Blueprint → #B. Build in phase order; gates before UI; flag loudly only when it matters.
