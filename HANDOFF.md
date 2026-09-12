# HANDOFF.md — operating LeadForge

## Deploy (Vercel + Supabase — the chosen path, D19)

One-time, in order; every step is a human step (accounts + credentials). **Do not deploy until the operator says go.**

1. **Supabase** (B13/B14): create a project → note `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Settings → API) and the **transaction-pooler** `DATABASE_URL` (Settings → Database → Connection string → Transaction pooler, port 6543). Storage → create a **private** bucket named `exports`.
2. **Vercel** (B15): import this repo (framework auto-detects Next). Project → Settings → Environment Variables: `MOCK_MODE` (=1 for a mock demo, =0 for real), `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (any long random string), `APP_SECRET` (B10), and — since Deployment Protection is the door — `AUTH_TRUST_PLATFORM=1` + `OPERATOR_EMAIL` (D20). Add data/provider keys from BLOCKERS as they exist (`OVERTURE_RELEASE`, `FSQ_RELEASE`, `HF_TOKEN`, `PAGESPEED_API_KEY`, …).
3. Keep **Deployment Protection ON** (Vercel Authentication) — with `AUTH_TRUST_PLATFORM=1` the app trusts Vercel's door; never combine that flag with an unprotected public URL.
4. Deploy (`vercel --prod` or git push). First request runs migrations against Supabase automatically (advisory-locked). `vercel.json` registers crons → `/api/jobs/tick`; verify in Vercel → Settings → Cron Jobs. **Plan note:** Hobby allows only daily crons, so `vercel.json` ships two daily ticks (03:15 backup window, Sun 04:05 freshness) — interactive jobs (campaign runs, exports) don't wait for cron anyway, they start via the `after()` kick on the enqueue routes. On Pro, change the first cron back to `* * * * *` for minute-level job slices.
5. **Monthly data** never runs on Vercel (native DuckDB): from any machine, `MOCK_MODE=0 OVERTURE_RELEASE=<rel> DATABASE_URL=<pooler url> npx tsx scripts/workstation-extract.ts <STATES>`; the FSQ gap-fill alone (after keys/token changes) is `scripts/fsq-gapfill.ts <STATES>` with `FSQ_RELEASE` + `HF_TOKEN` — it streams the public parquet straight into Supabase, gate included. **Size the plan first** (B13): free tier = ~one small state; TX/FL/GA-scale needs Supabase Pro. If the home router's DNS flakes under the multi-GB S3 stream, run `npx tsx scripts/net-proxy.ts` and add `DUCKDB_HTTP_PROXY=127.0.0.1:8118` — the scan then resolves names via 1.1.1.1 in-process (TLS stays end-to-end).
6. Backups: Supabase manages database backups (D21 — verify in its dashboard; the in-app nightly job records a skip on purpose). Exports live in the `exports` bucket.

Local/Docker keeps working exactly as before with zero accounts (PGlite under `.data/pg` / the `/data` volume); the Cloudflare-tunnel path in §below remains a supported alternative.

## Daily use
- **New campaign** → niche → *Propose categories* → confirm the chips (first run per niche; confirmed mappings auto-apply afterwards) → states → filters → caps → **Smoke test first** (200 records) → review → full run. Free runs finish in seconds.
- **Leads** → sort by score; the drawer shows *why* (chips), the owner evidence quote, per-lead DNC, notes, tags, assignee. Bulk-set statuses from the table.
- **Exports** → XLSX/CSV, column picker, optional Drive push. DNC-list matches never export; `dnc`/`not-interested` statuses and client-list matches are excluded unless you flip the audited override.
- **Suppressions** → import the client roster (kind=client) FIRST (B12) — that's what structurally prevents cold-calling existing customers. DNC scrub results go in kind=dnc.

## Monthly
1. Check the Overture releases page; bump `OVERTURE_RELEASE` in `.env`, then re-derive the category catalog from the new release: `npx tsx scripts/derive-taxonomy.ts DE NV CT` (~40s; the canonical CSV no longer exists upstream — D18). FSQ: bump `FSQ_RELEASE` (monthly `dt=` releases on the HF dataset; needs the free-account `HF_TOKEN` — B6). Each release row in Settings shows the diff vs the previous data: new / changed sites / changed phones / disappeared.
2. On Vercel: run the extract from a workstation — `DATABASE_URL=<supabase pooler> npx tsx scripts/workstation-extract.ts TX FL …` (writes directly into Supabase; nothing to ship). Local/Docker: Settings → Data → **Run monthly extract** (needs ≥4 GB RAM).
3. The **ingest gate** must pass (row-count band ±40% per state, taxonomy resolution ≤2% unresolved, GERS on every row) or the previous release stays active — the failure report is on the release row in Settings.
4. Weekly freshness runs itself (Sun 04:00): re-checks active leads' sites at $0, tags `site-launched` / `site-died` / `not-in-latest-release`, rescores.

## Money
- Everything is $0 until you toggle Haiku extraction or the Outscraper top-up on a campaign.
- Three independent brakes: per-campaign hard cap (Run button gates on the estimate), per-top-up cap, monthly ceiling (Settings, default $0). Overshoot is bounded to one provider page; the invariant is property-tested (G6).
- Outscraper jobs that stall are surfaced on the campaign page and **never auto-resubmitted** (a submitted job bills whether or not you fetch it) — check their dashboard first.
- Set the Anthropic console spend limit (~$20) as the backstop beyond the app's caps (procurement §7).

## Ops
- **Backups**: nightly 03:15 via SQLite online-backup → gzip → `/data/backups` (30-day retention) → Drive when connected. "Backup now" in Settings. Restore = stop app, gunzip over `/data/leadforge.db`, start.
- **Deploy**: `docker compose up -d --build`. The `/data` volume is never touched by a redeploy. No inbound ports; cloudflared dials out.
- **Access**: Cloudflare Access (Google IdP, `@gemfieldconsulting.com` policy) in front; the app independently verifies the Access JWT on every request (G8) — if you ever expose the app another way, that guard is the only door: **don't**. Documented alternative (§2 of the build guide): a **Tailscale** tailnet instead of the tunnel — pure private network, no public hostname. Be aware v1's in-app guard is built for Access JWTs: with Access unset it locks everyone out (fail-closed, on purpose), so going Tailscale-only means consciously adding a trusted-network mode to `src/proxy.ts`/`src/server/auth.ts` and accepting network-level trust in place of per-user identity. Record that as a DECISIONS entry if you do it; don't quietly weaken the door.
- **Health**: `/api/health` (only unauthenticated route; no data). Docker healthcheck uses it.
- **Alerting**: set the ops alert webhook in Settings → API keys (any Slack-compatible receiver — Slack/Discord/Google Chat). Every job that exhausts its retries (ingest, backup, exports, campaigns) POSTs one message there; no webhook = silent, check Settings → Data weekly instead.
- Jobs are resumable rows in the `jobs` table; a crash/restart resumes from checkpoints without double-billing (intents). Failed jobs show `lastError` in Settings → Data.

## HUMAN_CHECK #Z — pre-launch checklist (people, not code)
- [ ] #B reviewed: ARCHITECTURE.md + CONTRACTS.md match what you want
- [ ] #K: PageSpeed + Google OAuth keys entered in Settings; Drive consent completed; folder ID set; HF token for FSQ gap-fill (free account, B6); monthly ceiling consciously chosen (default $0); optional Anthropic/Outscraper keys + console limits; optional ops alert webhook
- [ ] #C: config/compliance.json reviewed — UA string contact address, DNC process wording, export-exclusion defaults
- [ ] Cloudflare Access policy verified: a colleague OUTSIDE the allowed emails is refused at `leads.gemfieldconsulting.com`; a request with no JWT gets 401 (curl the origin URL directly)
- [ ] Client roster imported under Suppressions (B12)
- [ ] Real extract for one state; spot-check ten known local businesses in Leads (definition of done §7)
- [ ] First real campaign as a smoke test; XLSX opens in Excel; Drive push lands in the folder
- [ ] Backup file exists in `/data/backups` after the first night (or "Backup now")

## Known limits (by design, documented)
- Freshness is monthly, not live; the weekly sweep catches launched/dead sites for active leads only (§4.5).
- No ratings/review counts exist in open data (UI says so); the paid top-up is the recall lever for the very smallest businesses.
- `data/overture_taxonomy.csv` + `data/us_cities.csv` ship as starter subsets until B5/B9 drop in the full files; the ingest gate and fan-out read whatever is present.
- Address-less records use bbox-only state attribution (D16).
