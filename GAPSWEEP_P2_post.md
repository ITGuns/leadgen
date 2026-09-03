# GAP_SWEEP · P2 post (data & enrichment)

Scope: bundled data, fixtures, ingest (Overture/FSQ/conflate/gate/chains/releases), classification, fetcher, website check, scoring, owner extraction, AI/PageSpeed/Outscraper/Drive adapters, fan-out, golden sets.

C12 checklist:
1. Requirements → owners: monthly extract w/ bbox pushdown + region select + address-less fallback ✓ (overture.ts, D16) · FSQ gap-fill-only ✓ · conflation C4 incl. G1d never-merge ✓ · release versioning + band gate + previous-release retention ✓ · taxonomy catalog + niche proposals + confirm-persist ✓ · chains §4.2 ✓ · URL classification C5 (static + fetch pass, shortener resolution) ✓ · polite fetcher C6 (robots, ≤2/domain, 10 global, 8s, 2MB, identified UA) ✓ · website check fingerprints ✓ · PageSpeed quota+cache ✓ · owner heuristic + Haiku adapter + schema-level no-snippet-no-name ✓ · Outscraper async adapter + intents contract ✓ · city fan-out (paid path only, population floor) ✓ · Drive OAuth + upload + mock ✓ · attribution files ✓.
2. No TODOs in core paths (grep clean). Every keyed adapter has a deterministic mock twin; missing keys degrade to mock, never crash.
3. CONTRACTS drift fixed this phase: rubric weights recalibrated so worst-real = band ceiling 80 (C8 updated); `real_site` base chip added so every score explains itself.
4. Gates measured: G1 (9 ingest/conflation tests incl. idempotent re-ingest + stable business ids), G2 (32), G3 (property), G4 (62 fixtures + ordering invariants), G5 (44 fixtures, 14 traps), G6 (property) — **188 tests green**.
5. Idempotency: re-running ingest+conflate yields identical business ids/counts (tested); intents dedupe by hash.
6. Compliance: fetcher enforces robots + UA from config/compliance.json; owner extraction fetches the business's own site only (homepage + about/team paths).
7. STATUS/BLOCKERS updated.

**Live de-risk beyond plan:** the real Overture bucket was probed anonymously (scripts/probe-overture.ts): release 2026-08-19.0 schema verified against the extract SQL; one drift found and fixed (`taxonomy.alternates` plural); real-row formats (region `TX`, unnormalized phones, nullable operating_status) all covered by existing normalization. Residual real-mode risk shifts to B5 taxonomy-value reconciliation, exactly where the ingest gate reports it.

Deferred (in-spec): FSQ live probe awaits B6 pinning; polygon refinement of address-less rows documented as D16.
