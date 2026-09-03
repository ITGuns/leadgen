# GAP_SWEEP · P1 post (data core)

Pre-sweep scope (implicit, tracked in STATUS): schema+migrations, normalization/identity, budget guard + intents, resumable worker, settings/secure-store/audit, provider interfaces, gates G3(part)+G6.

C12 checklist:
1. Guide requirements → owners: schema mirrors CONTRACTS C1 (all tables incl. `app_settings` — added to support-table list, see note below); normalization C2 ✓; identity C3 ✓; budget/intents C10 ✓ (guard-before-every-call, idempotent intents, ledger actual/estimated, monthly ceiling); worker resumable w/ crash recovery + checkpoints + cancel + backoff ✓; cron inserts jobs (backup nightly / freshness weekly) ✓.
2. No TODOs in core paths ✓ (grep clean). Mock twins: interfaces defined (C9); concrete mocks land in P2 with fixtures — acceptable: nothing in P1 calls a provider.
3. CONTRACTS drift: `app_settings` was missing from C1 support tables → **fixed in CONTRACTS.md this commit**. `jobs.runAfter` added for backoff/scheduling → noted in C1 via jobs row (support table).
4. Gates: G3 normalization idempotence property ✓, G6 budget invariant property ✓, worker resume/cancel/retry ✓, secure-store roundtrip ✓ — 27 tests green, `tsc --noEmit` clean.
5. Idempotency: intents dedupe by hash ✓; enqueueJob dedupe option ✓; worker re-claim safe (status-guarded update) ✓.
6. Compliance: no fetch/export paths exist yet in P1.
7. STATUS/BLOCKERS updated.

Gap found & fixed during sweep: frozen mock clock leaked into worker scheduling (retries never came due) — worker now uses wall-clock for runAfter/claims, frozen clock only stamps data. `mailto:`/userinfo URLs slipped normalization — rejected now.
