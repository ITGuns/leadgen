# GAP_SWEEP · P5 post (ops) — final sweep before #Z

C12 checklist:
1. Requirements → owners: CF Access JWT verified at the edge (`src/proxy.ts`) AND per-route (withAuth, defense in depth); real-mode-without-config = locked shut · mock dev identity for keyless local runs · nightly backup via SQLite ONLINE backup API → gzip → 30-day retention → Drive (never a raw WAL copy) · weekly freshness sweep at $0 (site-launched/site-died/not-in-latest-release tags + rescore, manual re-pulls only) · Settings: encrypted key entry (presence-only display), Drive connect (OAuth w/ state check) + folder, ceiling/quota/population-floor knobs, releases + manual extract + manual backup, confirmed-mapping catalog editor, compliance + attribution About · Docker multi-stage standalone + compose (app + cloudflared, no inbound ports, /data volume untouched by redeploys, healthcheck) · keyless CI (typecheck, G1–G8, build, Playwright E2E) · workstation-extract script for <4 GB hosts · HANDOFF.md with #Z checklist · README rewritten.
2. No TODOs in core paths (`grep -rn "TODO" src/` clean).
3. Contracts: auth test seam documented in code; no schema drift this phase.
4. Gates measured: **all of G1–G8 green — 204 tests, 13 files**; `tsc --noEmit` clean; `next build` clean; **Playwright mock-mode full-campaign E2E 5/5 green** (self-seed → build+confirm+smoke-run at $0 → ranking + owner evidence drawer → XLSX download validates as zip → suppression import).
5. Idempotency: backup/freshness enqueue with dedupe; export orphan reconciliation; boot HMR-safe.
6. Compliance: 401 on every route incl. export downloads (G8 asserts the real route handlers); /api/health is the only public route and returns no data; secrets never rendered back; audit on settings/exports/suppressions/DNC.
7. STATUS final below; BLOCKERS current.

Deviations worth knowing (all documented): Next 16 `proxy.ts` used for the edge guard; e2e uses an isolated DB via env; Docker healthcheck uses node fetch (slim image has no curl).

Definition of done (§7) — machine side: every §4.6 gate green · mock E2E green · keyless CI defined · Docker Compose written (clean-VM `docker compose up` is a human step, B4). Human side = HANDOFF.md #Z checklist.
