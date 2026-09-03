# GAP_SWEEP · P0 pre (Blueprint)

Requirement areas the Blueprint must give an owner (section) to — swept from both source guides before writing a line of it:

- [ ] Free-first ingestion: Overture (primary, DuckDB over public parquet, bbox predicate pushdown, region-code state select), FSQ (gap-fill only), release pinning + monthly diff, ingest gate, 4 GB RAM constraint + workstation-extract alternative
- [ ] Taxonomy: bundled taxonomy file, niche→taxonomy mapping (curated file → optional Haiku assist → human confirm), mapping persistence + auto-apply after confirmation
- [ ] Conflation: phone → domain → name+50m; never merge differing verified phones; source attribution on conflicts
- [ ] Dedupe/normalization contract: E.164 phones, normalized domains, identity key precedence, property-tested determinism
- [ ] Campaign builder: niche, states (50+DC), city/ZIP upload, filters (website-class, min confidence, phone, operating, source, chains), contact-channel rule + contactless toggle, caps (records + hard budget), live estimate gating Run, smoke mode (200), release version recorded per campaign
- [ ] Pipeline: plan → pull → dedupe → website check → PageSpeed → owner extraction → score → ready; resumable, idempotent, observable (per-stage counts, live cost), pause/resume/cancel, per-stage errors + retry; single global scheduler with fair round-robin + shared PageSpeed quota
- [ ] URL classification before anything: real_site | social_only | aggregator | parked | dead | none; websites vs socials fields; has-website filter uses classification only
- [ ] Website check: resolve/SSL/redirect-to-social/builder fingerprint/copyright year/contact-form/click-to-call/viewport; ≤2 per domain, 10 global, 8s timeout, robots.txt, identified UA
- [ ] PageSpeed: mobile strategy, 25k/day tracked quota, 30-day per-domain cache, background only
- [ ] Owner extraction: own-site pages only, heuristic first, optional Haiku, evidence snippet mandatory (no snippet = no name), role-tied-to-this-business rule, multi-location ⇒ low confidence, Outscraper owner merged
- [ ] Opportunity Score: 0–100 with reason chips, config-file rubric, golden set
- [ ] Leads workspace: table, search, drawer with evidence + raw source, status pipeline, notes, assignee, tags, bulk actions, cross-campaign dedupe with campaign history
- [ ] Exports: streaming XLSX background job (column picker, formatting, hyperlinks, score coloring, filename convention), Drive push (user OAuth / Shared Drive, never bare service account), CSV; DNC + not-interested excluded by default (audit-logged toggle)
- [ ] Suppression & compliance: do-not-prospect client list (separate from DNC), DNC list import, per-lead DNC one-click, export audit log, email column + CAN-SPAM note, business-public data only
- [ ] Paid top-up: Outscraper adapter (async submit/poll/paginate, intent-before-submit, stalled surfacing, billed-even-if-unfetched), city fan-out (SimpleMaps, population floor), per-campaign opt-in + budget cap
- [ ] Cost safety: intent rows, cap checked before every billable call (never exceed cap by more than one page), actual-vs-estimated spend both stored, monthly ceiling
- [ ] Freshness: lastVerifiedAt, weekly no-spend recheck for active statuses, newly-launched-site invalidation, manual budgeted re-pulls only
- [ ] Chain exclusion: ≥N states heuristic + known_chains.txt, flag not delete
- [ ] Auth & access: Cloudflare Access JWT on every route incl. exports, team-domain certs cached, MOCK_MODE dev identity, 401 gate test
- [ ] Ops: Docker Compose (app + cloudflared), /data volume never touched by redeploys, nightly online-backup → gzip → Drive, 30-day retention, settings UI, spend dashboard, attribution (Overture/FSQ/SimpleMaps)
- [ ] Mock mode: bundled Overture-shaped parquet through the *real* DuckDB path, mock listings/PageSpeed/AI/Drive/fetcher, frozen clock, keyless CI, exports → ./exports
- [ ] Gates (§4.6): ingest bands, taxonomy golden 30, dedupe determinism (property), score golden 60+, owner golden 40+ with traps, budget-cap invariant (property), export round-trip, access gate
- [ ] Protocols: HUMAN_CHECK #B/#K/#C/#M/#Z handling in an autonomous session; GAP_SWEEP per phase; STATUS/DECISIONS/BLOCKERS maintained

Result: every line above must map to a numbered section in ARCHITECTURE.md or CONTRACTS.md (see P0 post-sweep).
