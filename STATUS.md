# STATUS.md

**Session 1 · 2026-09-03 · model: Fable 5 (environment default; guide's Opus-4.8 policy noted in DECISIONS D4)**

## Three likeliest breakpoints (kickoff step 1)

1. **Overture taxonomy mapping quality** — niche→taxonomy sets that over/under-match (e.g. "roofers" pulling `roofing_supply_store`). Mitigations: curated `data/niche_mappings.json`, mandatory human confirmation chips before first run of a niche, G2 golden set of 30 phrases, mappings persisted + reusable.
2. **Conflation false-merges** — two businesses sharing an office phone or a franchise domain collapsing into one lead. Mitigations: phone→domain→name+50m precedence with the never-merge-differing-verified-phones rule (G1d), conflicts stored with per-source attribution and shown in the drawer, conflation unit tests.
3. **Owner-extraction hallucination** — reviewer names, franchise CEOs, web-designer credits extracted as owners. Mitigations: no-snippet-no-name enforced at schema level, role-tied-to-this-business prompt + heuristic rules, multi-location ⇒ low confidence, G5 golden set with must-not-extract traps.

Watchlist #4: **real-release schema drift** — the real Overture extract SQL is written to the Sept-2026 schema but can only be proven against the live bucket (D9). A tiny-bbox live probe is attempted in P2; if the environment can't reach the bucket it moves to BLOCKERS.

## Protocol state

- HUMAN_CHECK: #B blueprint auto-proceeded (review ARCHITECTURE.md + CONTRACTS.md) · #K/#C/#M/#Z handled per DECISIONS D5.
- GAP_SWEEP: P0 pre ✓ / post ✓ (this commit).

## Phase progress

- [x] P0 Blueprint (ARCHITECTURE, CONTRACTS, DECISIONS, STATUS, BLOCKERS; repo scaffolded: Next 16 + deps, native modules smoke-tested)
- [x] P1 Data core (schema+migrations, normalize/identity, budget guard+intents, resumable worker, settings/secure-store/audit, provider interfaces; 27 tests green)
- [ ] P2 Data & enrichment
- [ ] P3 Campaign builder + pipeline + workspace UI
- [ ] P4 Exports + suppression + audit
- [ ] P5 Ops + #Z checklist
