<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# LeadForge — agent guide

Internal lead-gen tool (Gemfield). Read `ARCHITECTURE.md` + `CONTRACTS.md` before changing anything; code mirrors CONTRACTS — change the contract first. Run-state lives in `STATUS.md` / `DECISIONS.md` / `BLOCKERS.md`; per-phase sweeps in `GAPSWEEP_*.md`; ops runbook in `HANDOFF.md`.

- `npm test` = gate suites G1–G8 (199 tests, keyless, MOCK_MODE); `npm run e2e` = Playwright full-campaign E2E; `npx tsc --noEmit` before committing.
- `MOCK_MODE` defaults ON: bundled Overture-shaped parquet runs through the REAL DuckDB ingest path; all provider adapters have deterministic mocks (missing keys degrade to mock, never crash).
- Never weaken: budget guard before every billable call (C10) · intent rows before provider submits · no-snippet-no-owner-name (C1 invariant) · DNC-list never exports · never merge records with differing verified phones (C4) · attribution in UI + export metadata sheet (license requirement).
- Mock fixtures: regenerate with `npm run fixtures`; golden sets with `npm run golden:score` / `golden:owner` (expected values come from the spec, never from running the engine).
- New job types must be registered in `src/server/jobs/handlers.ts` — the dev server registers at boot, so restart it after adding one.
