# GAP_SWEEP · P3 post (campaign builder + pipeline + workspace)

C12 checklist:
1. Requirements → owners: pipeline C7 all 8 stages, resumable + pause/cancel between batches (run.ts) · single global scheduler w/ round-robin fairness + shared PageSpeed quota (scheduler.ts + providers/pagespeed) · budget guard before every billable call, top-up's own cap + campaign cap + monthly ceiling, overshoot ≤ 1 page (tested) · intents before submit, stalled surfaced never auto-resubmitted, partial pages persisted · niche→categories proposal + mandatory human confirmation, confirmed mappings auto-apply (#M in-product) · geography multi-state + city list · all §3.1 filters + contact-channel rule + "no ratings" notice in UI · caps + live estimate gating Run + smoke mode · release versions recorded per campaign and shown · D17 two-phase website filter with post-classification detach (tested) · workspace: sortable/filterable table, search, drawer (evidence + raw source), status pipeline, notes, assignee, tags, bulk actions, cross-campaign dedupe (tested) · suppression: client list excluded at pull (tested), DNC badge in UI.
2. No TODOs in core paths. Estimate uses the *effective* AI provider rate (mock=$0 — honest, since mock runs free).
3. Contract adherence: AIProvider.extractOwner now returns {extraction, costUSD} for actual-spend recording (C9 note updated in code; CONTRACTS C9 comment covers it).
4. Gates: pipeline e2e suite (8 tests) green — completes at $0, smoke cap, suppression exclusion, score ranking (no-website on top ≥90), owner-evidence invariant, D17 universe, cross-campaign dedupe, top-up ≤ cap+1page with intents. Full suite 196 green, tsc clean, `next build` clean.
5. Idempotency: re-enqueued campaign_run resumes by stage/cursor; attach uses PK-on-conflict; ensureLead unique by business.
6. Compliance: pull excludes client-suppressed; fetches keep C6 rules via shared fetcher; UI renders attribution in the sidebar.
7. STATUS updated.

Bugs found & fixed during P3 verification: signed `>>` on uint32 hashes produced `undefined` mock names (fixed to `>>>`); owner-heuristic reject window ±90 → ±60 (recall without trap regressions); `\bstars?\b` reviewer-rejector false-positived on "Lone Star" business names.

Live UI verification (dev server, mock): builder propose→confirm→estimate→smoke run; campaign completed in ~2s with stage trail (29 pulled / 15 checked / 12 pagespeed / 6 owners / 29 scored); leads table ranks no-website at 95 on top; drawer shows owner + verbatim evidence.
