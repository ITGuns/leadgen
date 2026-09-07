# Graph Report - .  (2026-09-07)

## Corpus Check
- 142 files · ~57,519 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 726 nodes · 1699 edges · 62 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: imports: 551 · contains: 438 · imports_from: 354 · calls: 141 · references: 138 · method: 43 · implements: 14 · conceptually_related_to: 10 · shares_data_with: 7 · cites: 3


## Input Scope
- Requested: auto
- Resolved: committed (source: cli)
- Included files: 142 · Candidates: 164
- Excluded: 0 untracked · 34856 ignored · 0 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.
## God Nodes (most connected - your core abstractions)
1. `getDb()` - 35 edges
2. `CONTRACTS.md P0 Contracts` - 29 edges
3. `LeadForge Build Guide v2` - 25 edges
4. `now()` - 23 edges
5. `env` - 22 edges
6. `withAuth()` - 19 edges
7. `Worker` - 18 edges
8. `businesses` - 16 edges
9. `defaults` - 14 edges
10. `enqueueJob()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `GAP_SWEEP P0 Pre` --references--> `API & Service Procurement Guide`  [EXTRACTED]
  GAPSWEEP_P0_pre.md → docs/LEADFORGE_API_PROCUREMENT_GUIDE.md
- `GAP_SWEEP P2 Post` --references--> `CONTRACTS.md P0 Contracts`  [EXTRACTED]
  GAPSWEEP_P2_post.md → CONTRACTS.md
- `AGENTS.md Agent Guide` --references--> `ARCHITECTURE.md P0 Blueprint`  [EXTRACTED]
  AGENTS.md → ARCHITECTURE.md
- `AGENTS.md Agent Guide` --references--> `Attribution Requirement`  [EXTRACTED]
  AGENTS.md → data/ATTRIBUTION.md
- `AGENTS.md Agent Guide` --references--> `BLOCKERS.md Real-mode Blockers`  [EXTRACTED]
  AGENTS.md → BLOCKERS.md

## Hyperedges (group relationships)
- **Free-first Ingestion Flow** — overture_maps, fsq_os_places, duckdb, monthly_ingest, conflation, ingest_gate, release_management [EXTRACTED 1.00]
- **Cost Safety System** — budget_guard, intent_rows, monthly_spend_ceiling, paid_topup, gate_g6 [EXTRACTED 1.00]
- **Gate Suite G1-G8 in Keyless CI** — gate_g1, gate_g2, gate_g3, gate_g4, gate_g5, gate_g6, gate_g7, gate_g8, keyless_ci [EXTRACTED 1.00]

## Communities

### Community 0 - "Data Core & Jobs"
Cohesion: 0.06
Nodes (61): POST, DB, G, getDb(), openDatabase(), openTestDatabase(), appSettings, businesses (+53 more)

### Community 1 - "Auth & Lead Services"
Cohesion: 0.05
Nodes (53): aiAvailable(), anthropicKey(), getAIProvider(), POST, POST, GET, POST, POST (+45 more)

### Community 2 - "Config & Ingest"
Cohesion: 0.06
Nodes (42): GET, getSqlite(), driveAvailable(), DrivePort, getDrive(), MockDrive, RealDrive, accessToken() (+34 more)

### Community 3 - "Enrichment & Scoring"
Cohesion: 0.05
Nodes (52): ScoreReason, WebsiteCheck, BUILDERS, checkWebsite(), detectBuilder(), detectCopyrightYear(), fetchOwnerPages(), htmlToText() (+44 more)

### Community 4 - "Provider Adapters"
Cohesion: 0.06
Nodes (29): AIProvider, AnthropicProvider, AIProvider, MockAIProvider, extractOwnerHeuristic(), NOT_NAMES, PATTERNS, REJECT_NEARBY (+21 more)

### Community 5 - "Budget & API Routes"
Cohesion: 0.07
Nodes (38): GET, intents, pagespeedCache, quotaUsage, GET, PATCH, CronDef, CRONS (+30 more)

### Community 6 - "Campaign Pipeline"
Cohesion: 0.10
Nodes (35): campaigns, estimateCampaign(), round2(), City, fanOutCities(), loadCities(), splitCsvLine(), Campaign (+27 more)

### Community 7 - "UI Pages & Formatting"
Cohesion: 0.08
Nodes (25): STATUS_STYLE, CampaignResp, STAGE_COUNT_KEY, STAGE_LABEL, STAGES, Detail, ListResp, Row (+17 more)

### Community 8 - "Mock Fixture Generator"
Cohesion: 0.09
Nodes (20): ADJ, chance(), FIRST, fsqRows, gers(), LAST, OUT_DIR, overtureRows (+12 more)

### Community 9 - "Core Contracts"
Cohesion: 0.11
Nodes (21): Conflation, CONTRACTS.md P0 Contracts, D17 Two-phase Website Filter, GAP_SWEEP P1 Post, GAP_SWEEP P3 Post, GAP_SWEEP P4 Post, G1 Ingest Gate Tests, G2 Taxonomy Golden 30 (+13 more)

### Community 10 - "Database Migrations"
Cohesion: 0.12
Nodes (19): app_settings, audit_log, businesses, campaign_leads, campaigns, chains, exports, intents (+11 more)

### Community 11 - "Build Guide Spec"
Cohesion: 0.14
Nodes (17): Attribution Requirement, Campaign Builder, Chain Exclusion, CI Workflow (keyless), Contact-Channel Rule, Exports (XLSX/CSV/Drive), Freshness Sweep, GAP_SWEEP Protocol (+9 more)

### Community 12 - "Normalization & Identity"
Cohesion: 0.28
Nodes (10): mergeRawListing(), TopUpMergeResult, identityKeyFor(), domainOf(), haversineMeters(), jaroWinkler(), LEGAL_SUFFIXES, normalizeName() (+2 more)

### Community 13 - "Protocol Invariants"
Cohesion: 0.17
Nodes (13): AGENTS.md Agent Guide, Anthropic API (Haiku 4.5), B6 FSQ Gated HF Access, CLAUDE.md Project Instructions, D4 Model Policy, D5 HUMAN_CHECK Autonomous Handling, Never-Merge-Differing-Phones Rule, No-Snippet-No-Owner-Name Invariant (+5 more)

### Community 14 - "Architecture & Deployment"
Cohesion: 0.18
Nodes (12): ARCHITECTURE.md P0 Blueprint, Nightly Backup, Cloudflare Tunnel, Docker Compose Deployment, GAP_SWEEP P0 Post, Gemfield, Global Scheduler, Google Drive API (+4 more)

### Community 15 - "Procurement & Run-state"
Cohesion: 0.36
Nodes (9): Data Attribution Notes, BLOCKERS.md Real-mode Blockers, DECISIONS.md Decision Log, DuckDB (httpfs), Foursquare OS Places, API & Service Procurement Guide, Monthly Ingest Job, Overture Maps Places (+1 more)

### Community 16 - "Owner Golden Set"
Cohesion: 0.25
Nodes (6): bizzes, Case, cases, names, out, perms

### Community 17 - "Ops Runbook"
Cohesion: 0.33
Nodes (7): Cloudflare Access, D16 Bbox Fallback Without Polygons, GAP_SWEEP P2 Post, GAP_SWEEP P5 Post, HANDOFF.md Ops Runbook, HUMAN_CHECK Protocol, Tailscale Alternative

### Community 18 - "Cost Safety Concepts"
Cohesion: 0.40
Nodes (6): Budget Guard, City Fan-out, Intent Rows, Monthly Spend Ceiling, Outscraper, Paid Top-up

### Community 19 - "Score Golden Set"
Cohesion: 0.33
Nodes (4): builders, Case, cases, out

### Community 20 - "Edge Access Guard"
Cohesion: 0.40
Nodes (5): config, G, jwks(), proxy(), PUBLIC_PATHS

### Community 21 - "App Shell"
Cohesion: 0.50
Nodes (2): metadata, NAV

### Community 23 - "ESLint Config"
Cohesion: 1.00
Nodes (1): eslintConfig

### Community 24 - "Next Config"
Cohesion: 1.00
Nodes (1): nextConfig

### Community 25 - "PostCSS Config"
Cohesion: 1.00
Nodes (1): config

### Community 26 - "Blocker: PageSpeed Key"
Cohesion: 1.00
Nodes (1): B1 PAGESPEED_API_KEY

### Community 27 - "Blocker: App Secret"
Cohesion: 1.00
Nodes (1): B10 APP_SECRET

### Community 28 - "Blocker: Bucket Probe (done)"
Cohesion: 1.00
Nodes (1): B11 Live-bucket Probe (DONE)

### Community 29 - "Blocker: Client Roster"
Cohesion: 1.00
Nodes (1): B12 Client Roster Import

### Community 30 - "Blocker: Google OAuth"
Cohesion: 1.00
Nodes (1): B2 Google OAuth Client + Drive Folder

### Community 31 - "Blocker: Cloudflare Tokens"
Cohesion: 1.00
Nodes (1): B3 Cloudflare Tokens

### Community 32 - "Blocker: Host 4GB"
Cohesion: 1.00
Nodes (1): B4 Host >=4GB

### Community 33 - "Blocker: Overture Taxonomy"
Cohesion: 1.00
Nodes (1): B5 Overture Release + Taxonomy File

### Community 34 - "Blocker: Anthropic Key"
Cohesion: 1.00
Nodes (1): B7 ANTHROPIC_API_KEY (optional)

### Community 35 - "Blocker: Outscraper Key"
Cohesion: 1.00
Nodes (1): B8 OUTSCRAPER_API_KEY (optional)

### Community 36 - "Blocker: SimpleMaps CSV"
Cohesion: 1.00
Nodes (1): B9 Full SimpleMaps CSV (optional)

### Community 37 - "Decision: Declined Sources"
Cohesion: 1.00
Nodes (1): D1 Declined Data Sources

### Community 38 - "Decision: Bundled Starters"
Cohesion: 1.00
Nodes (1): D10 Bundled Starters

### Community 39 - "Decision: No UI Library"
Cohesion: 1.00
Nodes (1): D11 No Component Library

### Community 40 - "Decision: Raw Google Fetch"
Cohesion: 1.00
Nodes (1): D12 Google APIs via Raw fetch

### Community 41 - "Decision: Worker Singleton"
Cohesion: 1.00
Nodes (1): D13 Worker Singleton via instrumentation.ts

### Community 42 - "Decision: Fetcher Interface"
Cohesion: 1.00
Nodes (1): D14 Fetcher Is an Interface

### Community 43 - "Decision: In-repo Similarity"
Cohesion: 1.00
Nodes (1): D15 In-repo Name Similarity

### Community 44 - "Decision: Free-first"
Cohesion: 1.00
Nodes (1): D2 Free-first

### Community 45 - "Decision: Drive User OAuth"
Cohesion: 1.00
Nodes (1): D3 Drive User OAuth

### Community 46 - "Decision: Runtime Versions"
Cohesion: 1.00
Nodes (1): D6 Runtime Versions

### Community 47 - "Decision: DB Path"
Cohesion: 1.00
Nodes (1): D7 DB Path

### Community 48 - "Decision: Encrypted Store"
Cohesion: 1.00
Nodes (1): D8 Encrypted Config Store

### Community 49 - "Decision: Release-pinned Mapping"
Cohesion: 1.00
Nodes (1): D9 Release-pinned Overture Mapping

### Community 53 - "Declined: Google Places"
Cohesion: 1.00
Nodes (1): Google Places API (declined)

### Community 54 - "Phase P0 Blueprint"
Cohesion: 1.00
Nodes (1): P0 Blueprint

### Community 55 - "Phase P1 Data Core"
Cohesion: 1.00
Nodes (1): P1 Data Core

### Community 56 - "Phase P2 Enrichment"
Cohesion: 1.00
Nodes (1): P2 Data & Enrichment

### Community 57 - "Phase P3 Workspace"
Cohesion: 1.00
Nodes (1): P3 Builder + Pipeline + Workspace

### Community 58 - "Phase P4 Exports"
Cohesion: 1.00
Nodes (1): P4 Exports + Suppression + Audit

### Community 59 - "Phase P5 Ops"
Cohesion: 1.00
Nodes (1): P5 Ops

### Community 61 - "Icon: File"
Cohesion: 1.00
Nodes (1): File/Document icon (16x16 boilerplate)

### Community 62 - "Icon: Globe"
Cohesion: 1.00
Nodes (1): Globe icon - Earth/world representation

### Community 63 - "Icon: Next.js"
Cohesion: 1.00
Nodes (1): Next.js wordmark - static branding asset

### Community 64 - "Icon: Vercel"
Cohesion: 1.00
Nodes (1): Vercel logomark

### Community 65 - "Icon: Window"
Cohesion: 1.00
Nodes (1): Window icon with frame and control buttons

### Community 68 - "Declined: Yelp Fusion"
Cohesion: 1.00
Nodes (1): Yelp Fusion (declined)

## Knowledge Gaps
- **215 isolated node(s):** `app_settings`, `audit_log`, `chains`, `exports`, `intents` (+210 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `App Shell`** (2 nodes): `metadata`, `NAV`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ESLint Config`** (1 nodes): `eslintConfig`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Next Config`** (1 nodes): `nextConfig`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `PostCSS Config`** (1 nodes): `config`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: PageSpeed Key`** (1 nodes): `B1 PAGESPEED_API_KEY`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: App Secret`** (1 nodes): `B10 APP_SECRET`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Bucket Probe (done)`** (1 nodes): `B11 Live-bucket Probe (DONE)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Client Roster`** (1 nodes): `B12 Client Roster Import`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Google OAuth`** (1 nodes): `B2 Google OAuth Client + Drive Folder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Cloudflare Tokens`** (1 nodes): `B3 Cloudflare Tokens`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Host 4GB`** (1 nodes): `B4 Host >=4GB`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Overture Taxonomy`** (1 nodes): `B5 Overture Release + Taxonomy File`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Anthropic Key`** (1 nodes): `B7 ANTHROPIC_API_KEY (optional)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: Outscraper Key`** (1 nodes): `B8 OUTSCRAPER_API_KEY (optional)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Blocker: SimpleMaps CSV`** (1 nodes): `B9 Full SimpleMaps CSV (optional)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Declined Sources`** (1 nodes): `D1 Declined Data Sources`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Bundled Starters`** (1 nodes): `D10 Bundled Starters`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: No UI Library`** (1 nodes): `D11 No Component Library`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Raw Google Fetch`** (1 nodes): `D12 Google APIs via Raw fetch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Worker Singleton`** (1 nodes): `D13 Worker Singleton via instrumentation.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Fetcher Interface`** (1 nodes): `D14 Fetcher Is an Interface`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: In-repo Similarity`** (1 nodes): `D15 In-repo Name Similarity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Free-first`** (1 nodes): `D2 Free-first`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Drive User OAuth`** (1 nodes): `D3 Drive User OAuth`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Runtime Versions`** (1 nodes): `D6 Runtime Versions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: DB Path`** (1 nodes): `D7 DB Path`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Encrypted Store`** (1 nodes): `D8 Encrypted Config Store`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Decision: Release-pinned Mapping`** (1 nodes): `D9 Release-pinned Overture Mapping`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Declined: Google Places`** (1 nodes): `Google Places API (declined)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Phase P0 Blueprint`** (1 nodes): `P0 Blueprint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Phase P1 Data Core`** (1 nodes): `P1 Data Core`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Phase P2 Enrichment`** (1 nodes): `P2 Data & Enrichment`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Phase P3 Workspace`** (1 nodes): `P3 Builder + Pipeline + Workspace`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Phase P4 Exports`** (1 nodes): `P4 Exports + Suppression + Audit`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Phase P5 Ops`** (1 nodes): `P5 Ops`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon: File`** (1 nodes): `File/Document icon (16x16 boilerplate)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon: Globe`** (1 nodes): `Globe icon - Earth/world representation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon: Next.js`** (1 nodes): `Next.js wordmark - static branding asset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon: Vercel`** (1 nodes): `Vercel logomark`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon: Window`** (1 nodes): `Window icon with frame and control buttons`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Declined: Yelp Fusion`** (1 nodes): `Yelp Fusion (declined)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ARCHITECTURE.md P0 Blueprint` connect `Architecture & Deployment` to `Protocol Invariants`, `Ops Runbook`, `Core Contracts`, `Build Guide Spec`, `Data Core & Jobs`, `Procurement & Run-state`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `CONTRACTS.md P0 Contracts` connect `Core Contracts` to `Protocol Invariants`, `Architecture & Deployment`, `Cost Safety Concepts`, `Procurement & Run-state`, `Build Guide Spec`, `Ops Runbook`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `HANDOFF.md Ops Runbook` connect `Ops Runbook` to `Protocol Invariants`, `Procurement & Run-state`, `Cost Safety Concepts`, `Data Core & Jobs`, `Build Guide Spec`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `app_settings`, `audit_log`, `chains` to the rest of the system?**
  _215 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Data Core & Jobs` be split into smaller, more focused modules?**
  _Cohesion score 0.05730777159348588 - nodes in this community are weakly interconnected._
- **Should `Auth & Lead Services` be split into smaller, more focused modules?**
  _Cohesion score 0.05191146881287726 - nodes in this community are weakly interconnected._
- **Should `Config & Ingest` be split into smaller, more focused modules?**
  _Cohesion score 0.059676044330775786 - nodes in this community are weakly interconnected._