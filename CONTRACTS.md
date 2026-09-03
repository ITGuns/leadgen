# LeadForge — Contracts (P0)

Code mirrors this file. A change here is a decision (log it in DECISIONS.md); a change in code without a change here is a bug.

## C1. Core entities (lead schema)

`businesses` — one row per real-world business (conflated, cross-campaign):

| field | type | notes |
|---|---|---|
| id | int pk | |
| gersId | text unique nullable | Overture stable ID when sourced from Overture |
| identityKey | text unique | CONTRACTS C3 |
| name / normalizedName | text | |
| phone | text nullable | E.164; `phoneSource` ∈ overture·fsq·outscraper |
| websiteRaw / websiteNormalized | text nullable | C2; `websiteSource` as above |
| websiteClass | text | `real_site·social_only·aggregator·parked·dead·none·unknown` (C5) |
| socials / emails | json string[] | |
| street·city·region·postal | text | region = `TX` style USPS code |
| lat·lng | real | |
| taxonomyPrimary | text | Overture taxonomy value |
| taxonomyAlternates | json string[] | |
| confidence | real | Overture confidence 0–1 |
| operatingStatus | text | `open`·`closed`·`unknown` |
| chain | bool | §4.2 heuristic/list; a filter, never a deletion |
| sources | json | `{overture?:{release},fsq?:{release,fsqId},outscraper?:{placeId}}` + per-field conflicts kept with attribution |
| firstSeenRelease / lastSeenRelease | text | |

`leads` — 1:1 with businesses; enrichment + workflow state:
score (0–100), scoreReasons `[{chip,points,detail?}]`, websiteCheck json (C6), pagespeed json `{mobileScore,lcpMs,fetchedAt}`, ownerName/ownerRole/ownerEvidence/ownerConfidence(`high·low`)/ownerSource(`heuristic·ai·outscraper`), status ∈ `new·contacted·interested·not_interested·dnc`, assignee, tags string[], lastVerifiedAt.
**Anti-hallucination invariant: `ownerName` non-null ⇒ `ownerEvidence` non-null.** Enforced in code and by DB trigger-equivalent check on write.

`campaigns` — niche, confirmedTaxonomy string[], states string[], cityList?, filters `{hasWebsite:any|yes|no, minConfidence(0.6), hasPhone, operatingOnly, sources, excludeChains, includeContactless:false}`, caps `{maxRecords, budgetCapUSD}`, smoke bool, aiOwnerExtraction bool, topUp `{enabled:false, provider, capUSD}`, status `draft·running·paused·completed·canceled·failed`, releaseOverture/releaseFsq (recorded at plan time — reproducibility), estimate json, spendUSD, stageCounts json, createdBy, per-stage error counts.
`campaign_leads` — (campaignId, leadId) unique; how a lead accrues campaign history.

Support tables: `places_overture`, `places_fsq`, `releases`, `jobs` (incl. `runAfter` for backoff/cron), `intents`, `suppressions` (kind `client·dnc`, phone/domain normalized), `audit_log`, `taxonomy_mappings` (niche→set, confirmedBy/At, timesUsed), `pagespeed_cache` (domain pk, 30-day TTL), `quota_usage` (provider+day), `spend_ledger`, `notes`, `exports` (params, status, path, rowCount, driveLink), `app_settings` (runtime-tunable ops knobs; never secrets), `chains`.

## C2. Normalization (deterministic, property-tested)

- **Phone** → E.164 via libphonenumber-js, default region US; unparseable ⇒ null. Idempotent.
- **Website** → trim; add `//` scheme if missing for parsing; lowercase host; strip leading `www.`; drop fragment; drop tracking params (`utm_*`,`fbclid`,`gclid`,`msclkid`,`ref`,`mc_cid`,`mc_eid`); path lowercased with trailing `/` removed; result `host[/path][?kept-params]`. `domainOf(url)` = normalized host only.
- **Name** → lowercase; unicode-normalize (NFKD, strip diacritics); strip punctuation to spaces; collapse whitespace; drop leading `the`; drop trailing legal suffixes (`llc`,`inc`,`co`,`corp`,`ltd`,`llp`,`pllc`,`pc`,`company`).
- All three are pure functions in `src/server/normalize.ts`; idempotence (`f(f(x))=f(x)`) is property-tested.

## C3. Identity key (dedupe)

Precedence (build-guide §4.6): `overture:<gersId>` → else `phone:<E.164>` → else `dn:<normalizedDomain>|<normalizedName>` → else `nl:<normalizedName>|<city>|<region>` (storage-uniqueness fallback; such records are contactless and excluded by default anyway). Same raw pull twice ⇒ identical lead set (gate G3). Cross-source conflation (C4) happens **before** key assignment so a merged business carries the Overture key.

## C4. Conflation (Overture ⟵ FSQ, ⟵ top-up)

Match order: normalized phone equality → normalized domain equality → (normalized-name similarity ≥ 0.85 Jaro-Winkler AND haversine ≤ 50 m). On match: fill missing phone/website/email on the Overture record, record source per field, keep conflicting values in `sources.conflicts` (UI shows who said what). **Never merge two records whose verified phones differ** (gate G1d). Unmatched FSQ records are NOT independent leads in v1 (no taxonomy crosswalk) — retained in `places_fsq` only. Top-up records join `businesses` through the same matcher; unmatched ones become new businesses with `identityKey` per C3.

## C5. URL classification (before anything else)

Input: `websites[]` + `socials[]` from the source record, + live fetch result when needed.
- No websites and no socials ⇒ `none`.
- Only social links (facebook/instagram/linktr.ee/tiktok/x/twitter/youtube/yelp-biz-page-as-social) ⇒ `social_only`.
- Website host on the aggregator list (yelp, angi, homeadvisor, thumbtack, houzz, bbb.org, yellowpages, mapquest, nextdoor, porch, expertise.com, findlaw, avvo, healthgrades, zocdoc, opentable, doordash/grubhub/ubereats store pages, google business-site (`business.site`), facebook/instagram again) ⇒ `aggregator`.
- Shorteners (bit.ly, goo.gl, tinyurl, t.co, lnkd.in, qrco.de) are resolved once through the fetcher, then reclassified on the final URL.
- Fetch outcomes: DNS/timeout/conn-refused ⇒ `dead`; parking fingerprints (godaddy/sedo/afternic/dan.com/hugedomains/parkingcrew bodies, "this domain is for sale") ⇒ `parked`; 30x landing on a social host ⇒ `social_only`; else ⇒ `real_site`.
- Scoring: `aggregator`/`parked`/`dead` score like `none` with an explanatory chip. The `has website` filter uses `websiteClass = real_site` for "yes" and `∈ {none,aggregator,parked,dead,social_only}` for "no". PageSpeed and owner extraction run **only** on `real_site`.

## C6. Website check result

```ts
{ finalUrl, httpStatus, ok, ssl, redirectedToSocial, builder:  // one of
  'wix'|'squarespace'|'godaddy'|'weebly'|'wordpress'|'duda'|'shopify'|'custom'|null,
  copyrightYear, hasContactForm, hasBooking, hasClickToCall, hasViewportMeta,
  htmlBytes, fetchedAt }
```
Fetcher rules: ≤2 concurrent per domain, ≤10 global, 8 s timeout, honors robots.txt (cached per host, `User-agent: *` + our UA token), UA string from `config/compliance.json`, no JS rendering in v1, max 2 MB body.

## C7. Pipeline stages (per campaign; each idempotent + resumable)

| stage | does | idempotency cursor |
|---|---|---|
| plan | resolve taxonomy set + filters; record releases; estimate cost; verify cap ≥ estimate; top-up: city fan-out plan → intent rows | plan hash |
| pull | local query → attach businesses as leads (`campaign_leads`); suppression (client+DNC) excluded; contact-channel rule; maxRecords / smoke-200 cap; top-up: submit→poll→paginate with budget guard per page | last business id / provider cursor |
| dedupe | top-up records conflated into `businesses` (C4); membership de-duped | intent id |
| website_check | classify (C5) then check (C6) for leads with stale/missing checks | lead id batches |
| pagespeed | `real_site` only; 30-day cache; daily quota via global scheduler | lead id batches |
| owner_extract | `real_site` only; heuristic → optional AI; evidence mandatory | lead id batches |
| score | rubric engine (C8); chips persisted | lead id batches |
| ready | final counts, campaign completed | — |

Every stage: batch loop → checkpoint job progress → honor pause/cancel between batches. Per-stage error counters with per-lead retry action. A crashed run resumes at its checkpoint without re-billing (intents).

## C8. Score rubric format (`config/score-rubric.json`)

```jsonc
{ "version": 1,
  "base": { "none": 95, "dead": 95, "parked": 93, "aggregator": 90, "social_only": 85, "real_site": 30 },
  "baseChips": { "none": "No website", "dead": "Dead site", "parked": "Parked domain",
                 "aggregator": "Aggregator listing only", "social_only": "Social-only presence" },
  "modifiers": [                        // apply only when base = real_site
    { "cond": "builder", "add": 25, "chip": "Built on {builder}" },
    { "cond": "mobile_below", "arg": 50, "add": 15, "chip": "Mobile score {mobileScore}" },
    { "cond": "mobile_below", "arg": 30, "add": 10, "chip": "Very poor mobile" },
    { "cond": "no_ssl", "add": 8, "chip": "No SSL" },
    { "cond": "copyright_older_than", "arg": 3, "add": 6, "chip": "© {copyrightYear}" },
    { "cond": "no_viewport", "add": 6, "chip": "Not mobile-friendly" },
    { "cond": "no_contact_form", "add": 4, "chip": "No contact form" },
    { "cond": "mobile_at_least", "arg": 80, "add": -12, "chip": "Fast mobile site" },
    { "cond": "custom_recent", "add": -8, "chip": "Modern custom site" } ],
  "clamp": [0, 100] }
```
Engine: pick base by websiteClass; for `real_site` apply matching modifiers in order; clamp. Conditions are a fixed enum implemented in `scoring/score.ts`. Expected bands (golden G4): none/dead/parked/aggregator ⇒ ≥90 · social_only 80–89 · builder+poor mobile 60–80 · decent 20–40 · strong <20.

## C9. Provider interfaces (`src/server/providers/types.ts`)

```ts
interface ListingsProvider {            // paid top-up only
  name: string;
  estimateCostUSD(recordsPlanned: number): number;
  submit(q: { category: string; city: string; region: string; limit: number }): Promise<{ providerJobId: string }>;
  poll(providerJobId: string): Promise<'pending'|'ready'|'failed'>;
  fetchPage(providerJobId: string, cursor?: string):
    Promise<{ records: RawListing[]; nextCursor?: string; actualCostUSD?: number }>;
}
interface AIProvider {
  name: string;
  extractOwner(i: { businessName: string; multiLocation: boolean;
                    pages: { url: string; text: string }[] }): Promise<OwnerExtraction|null>; // zod-validated
  proposeTaxonomy(niche: string, catalog: string[]): Promise<string[]>;
  costPerOwnerCallUSD: number;
}
interface PageSpeedProvider { runMobile(url: string): Promise<{ mobileScore: number; lcpMs: number }>; }
interface DrivePort { upload(localPath: string, name: string, folderId: string, mime: string):
                        Promise<{ id: string; webViewLink: string }>; }
interface Fetcher { get(url: string, opts?): Promise<FetchResult>; }  // polite wrapper (C6 rules)
```
`OwnerExtraction = { ownerName?: string; role?: string; evidenceSnippet: string; confidence: 'high'|'low' }` — schema rejects a name without a snippet. Selection: `MOCK_MODE=1` or missing key ⇒ mock twin; mocks are deterministic (seeded by input hash) and never touch the network.

## C10. Budget & intents (§4.3)

`intents`: (provider, queryHash unique, campaignId, status `planned·submitted·fetched·abandoned·stalled`, providerJobId, estCostUSD, actualCostUSD, pagesFetched). Written **before** submit; a resumed run skips `fetched`, re-polls `submitted`, never re-submits `stalled` without human action (UI button). `budgetGuard(campaignId, nextCallUSD)` runs before **every** billable call; overshoot bound = one page. Monthly ceiling `MONTHLY_SPEND_CEILING_USD` guards globally the same way. Actual spend read back from provider responses when available, else estimated — both in `spend_ledger`.

## C11. Gates (§4.6) → test files

| # | gate | where |
|---|---|---|
| G1 | ingest: row-count bands (±40% vs previous ⇒ fail, keep prior), GERS on every row, taxonomy resolves, no differing-phone merges | tests/ingest-gate.test.ts |
| G2 | taxonomy golden 30 niches | tests/taxonomy-golden.test.ts |
| G3 | dedupe determinism + normalization idempotence (property) | tests/dedupe.property.test.ts |
| G4 | score rubric golden 60+ fixtures | tests/score-golden.test.ts |
| G5 | owner extraction golden 40+ incl. traps | tests/owner-golden.test.ts |
| G6 | budget-cap invariant (property over generated plans) | tests/budget.property.test.ts |
| G7 | export round-trip DB→XLSX→parse identical; DNC absent | tests/export-roundtrip.test.ts |
| G8 | access gate: no valid JWT ⇒ 401 on every route incl. exports | tests/access-gate.test.ts |

## C12. GAP_SWEEP checklist (run pre+post each phase → `GAPSWEEP_<phase>_{pre|post}.md`)

1. Every guide requirement touching this phase has an implementation or an explicit BLOCKERS/DECISIONS entry.
2. No TODO/stub in core paths; mock twins exist for anything keyed.
3. New tables/fields reflected here (C1) and in migrations.
4. Gates for the phase are green locally (`npm test`), not claimed.
5. Idempotency: re-running the phase's jobs mutates nothing new.
6. Compliance: UA, robots, attribution, suppression respected by any new fetch/export path.
7. STATUS.md updated (done / next / breakpoints), BLOCKERS.md current.
