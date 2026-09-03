# STATUS.md

**Session 1 · 2026-09-03 · model: Fable 5 (environment default; guide's Opus-4.8 policy noted in DECISIONS D4)**

## Three likeliest breakpoints (kickoff step 1)

1. **Overture taxonomy mapping quality** — niche→taxonomy sets that over/under-match (e.g. "roofers" pulling `roofing_supply_store`). Mitigations: curated `data/niche_mappings.json`, mandatory human confirmation chips before first run of a niche, G2 golden set of 30 phrases, mappings persisted + reusable.
2. **Conflation false-merges** — two businesses sharing an office phone or a franchise domain collapsing into one lead. Mitigations: phone→domain→name+50m precedence with the never-merge-differing-verified-phones rule (G1d), conflicts stored with per-source attribution and shown in the drawer, conflation unit tests.
3. **Owner-extraction hallucination** — reviewer names, franchise CEOs, web-designer credits extracted as owners. Mitigations: no-snippet-no-name enforced at schema level, role-tied-to-this-business prompt + heuristic rules, multi-location ⇒ low confidence, G5 golden set with must-not-extract traps.

Watchlist #4 RESOLVED: live probe (scripts/probe-overture.ts) verified the 2026-08-19.0 schema and sample rows; the one drift (taxonomy.alternates) is fixed. Remaining real-mode risk: B5 taxonomy-value reconciliation, surfaced by the ingest gate.

## Protocol state

- HUMAN_CHECK: #B blueprint auto-proceeded (review ARCHITECTURE.md + CONTRACTS.md) · #K/#C/#M/#Z handled per DECISIONS D5.
- GAP_SWEEP: P0 pre ✓ / post ✓ (this commit).

## Phase progress

- [x] P0 Blueprint (ARCHITECTURE, CONTRACTS, DECISIONS, STATUS, BLOCKERS; repo scaffolded: Next 16 + deps, native modules smoke-tested)
- [x] P1 Data core (schema+migrations, normalize/identity, budget guard+intents, resumable worker, settings/secure-store/audit, provider interfaces; 27 tests green)
- [x] P2 Data & enrichment (fixtures via real DuckDB path; ingest+gate+conflation+chains; classification; polite fetcher; website check; scoring engine+rubric; owner heuristic+Haiku adapter; PageSpeed/Outscraper/Drive adapters + mocks; fan-out; goldens G1-G6 — 188 tests green. Live bucket probe verified release 2026-08-19.0 schema; fixed taxonomy.alternates drift)
- [ ] P3 Campaign builder + pipeline + workspace UI
- [ ] P4 Exports + suppression + audit
- [ ] P5 Ops + #Z checklist
