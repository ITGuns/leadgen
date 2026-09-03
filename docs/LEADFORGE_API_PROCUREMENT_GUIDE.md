# LeadForge — API & Service Procurement Guide for Developers
### Everything to sign up for, what to obtain, what it costs, and the exact config the build expects · September 2026

**Read this before running the build guide.** Every external dependency of LeadForge is listed below with: whether an account is needed, the credential to obtain, cost, setup steps, the environment variable the build expects, and known gotchas. Items marked **REQUIRED** must exist for real-mode operation; **OPTIONAL** items are off by default. The build runs fully in `MOCK_MODE=1` with none of them — procurement never blocks development.

**Secrets rule:** all credentials go in `.env` (gitignored) on the host, mirrored by a committed `.env.example` with blank values. Nothing below is ever committed, pasted into chat, or stored in the database.

---

## 0. Summary table

| # | Service | Role | Account? | Cost | Required? |
|---|---|---|---|---|---|
| 1 | Overture Maps Places | Primary business listings | **None** | $0 | REQUIRED |
| 2 | Foursquare OS Places | Phone/website gap-fill | **None** | $0 | REQUIRED |
| 3 | Google PageSpeed Insights API | Website quality scoring | Google Cloud project | $0 (25k/day) | REQUIRED |
| 4 | Google Drive API | Direct-to-Drive export, backups | Same Google Cloud project | $0 | REQUIRED |
| 5 | Cloudflare Zero Trust (Tunnel + Access) | Private access + staff login | Cloudflare account (domain already there) | $0 (≤50 users) | REQUIRED |
| 6 | VPS (Hetzner / DigitalOcean) or office machine | Hosting | Provider account | ~$5–8/mo or $0 | REQUIRED (one of) |
| 7 | Anthropic API (Haiku 4.5) | Owner-name extraction, taxonomy assist | Anthropic Console | ~$0.001/site; pennies | OPTIONAL |
| 8 | Outscraper Google Maps API | Paid coverage top-up | Outscraper account | $3/1k, 500 free/mo | OPTIONAL |
| 9 | SimpleMaps US Cities (basic) | City fan-out for paid top-up only | None (download) | $0 (CC-BY-4.0) | OPTIONAL |

**Baseline monthly cost: $0 + hosting (≈$5–8, or $0 on an office machine).**

---

## 1. Overture Maps Places — REQUIRED, no account

- **What:** open POI dataset (~64–74M places; phones, websites, socials, emails, categories, operating status, confidence). Monthly releases as GeoParquet.
- **Access:** public AWS Open Data bucket (`s3://overturemaps-us-west-2/release/<RELEASE>/theme=places/type=place/`) — anonymous, no credentials, no requester-pays. Azure mirror exists as fallback. Find the current release ID on the Overture docs releases page.
- **Setup:** none. The extract job needs DuckDB with the `httpfs` extension (installed in the Docker build). Pin the release in config and bump monthly.
- **Also download:** the Overture **category taxonomy** file for the pinned release (bundle as `data/overture_taxonomy.csv`). The `taxonomy` property replaced the deprecated `categories` property in the September 2026 release — use `taxonomy`.
- **License:** CDLA-Permissive-2.0 / Apache-2.0. **Attribution is required** — appears in Settings → About and every export's metadata sheet (the build handles it; don't remove it).
- **Env:** `OVERTURE_RELEASE=2026-08-20.0` (example — set the current one), `OVERTURE_BASE_URL=s3://overturemaps-us-west-2/release`
- **Gotcha:** the host running the extract needs ≥4 GB RAM and ~20 GB disk. A 2 GB VPS will fail. Alternative: run the extract on an office machine and upload the DB file (script provided by the build).

## 2. Foursquare OS Places — REQUIRED, no account

- **What:** open POI dataset with `tel`/`website` fields; used only to fill gaps on matched Overture records.
- **Access:** parquet on Hugging Face (`foursquare/fsq-os-places`) or the public S3 bucket referenced in its README. Anonymous.
- **License:** Apache-2.0. Attribution bundled with Overture's.
- **Env:** `FSQ_RELEASE=<dt from README>`, `FSQ_BASE_URL=<hf or s3 path>`

## 3. Google PageSpeed Insights API — REQUIRED

- **Steps:** Google Cloud Console → create project `gemfield-leadforge` (or reuse the one from #4) → APIs & Services → Enable **PageSpeed Insights API** → Credentials → Create **API key** → restrict the key to the PageSpeed API only.
- **Cost:** free; quota ~25,000 requests/day (verify in the console). The build tracks and throttles usage and caches results 30 days per domain.
- **Env:** `PAGESPEED_API_KEY=`
- **Gotcha:** each call takes 10–30 s. That's why scoring runs in the background queue, never inline.

## 4. Google Drive API — REQUIRED

- **Decision already made (do not deviate):** **user OAuth** (a Gemfield Google Workspace account) **or a Shared Drive** — **never a bare service account.** Service accounts have no My Drive storage quota; uploads fail silently.
- **Steps:** same Google Cloud project → Enable **Google Drive API** → OAuth consent screen: **Internal** (Workspace) → Create **OAuth client ID** (type: Web application) → authorized redirect URI: `https://leads.gemfieldconsulting.com/api/google/callback` (plus `http://localhost:3000/api/google/callback` for dev) → note client ID + secret.
- **Scopes the build requests:** `https://www.googleapis.com/auth/drive.file` (only files it creates — least privilege). The first admin completes the consent flow once in Settings; the refresh token is stored encrypted in the app's config store, not in the DB.
- **Create the destination folder** in Drive (recommend a Shared Drive named `LeadForge Exports`); paste its folder ID into Settings.
- **Env:** `GOOGLE_OAUTH_CLIENT_ID=`, `GOOGLE_OAUTH_CLIENT_SECRET=`, `GOOGLE_DRIVE_FOLDER_ID=`
- **Gotcha:** Workspace admins may need to allow the internal app if OAuth app access control is restricted.

## 5. Cloudflare Zero Trust — REQUIRED

- **Why:** private access to the app with Google-login gating, no open ports, no TLS management, no auth code — free for ≤50 users. Uses the domain you already own.
- **Steps:**
  1. Cloudflare dashboard → the `gemfieldconsulting.com` zone → Zero Trust → **Tunnels** → Create tunnel `leadforge` → copy the tunnel token → public hostname `leads.gemfieldconsulting.com` → service `http://leadforge:3000` (the Docker service name).
  2. Zero Trust → **Access → Applications** → Add self-hosted app on `leads.gemfieldconsulting.com` → identity provider: **Google** (add the Google login method under Settings → Authentication; uses the same Cloud project's OAuth client, or a dedicated one) → policy: allow emails ending in `@gemfieldconsulting.com` (add contractor emails explicitly).
  3. From the application's overview page copy the **Application Audience (AUD) tag**; note your **team domain** (`<team>.cloudflareaccess.com`).
- **Env:** `CF_TUNNEL_TOKEN=`, `CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`, `CF_ACCESS_AUD=`
- **Gotcha:** the app verifies the `Cf-Access-Jwt-Assertion` header on every request. If you ever expose the app any other way, that guard is your only door — don't.

## 6. Hosting — REQUIRED (choose one)

- **VPS:** Hetzner CX22-class or DigitalOcean 4 GB droplet (**≥4 GB RAM, ≥40 GB disk**, Ubuntu 24.04, Docker + Compose). ~$5–8/mo. Only outbound traffic needed (the tunnel dials out) — leave inbound ports closed.
- **Office machine:** any always-on box with Docker; same tunnel; $0.
- **Backups:** nightly SQLite online-backup snapshot → Drive folder (#4). Nothing to procure.

## 7. Anthropic API — OPTIONAL

- **Use:** Haiku 4.5 for higher-recall owner extraction and niche→taxonomy assistance. Off unless toggled per campaign; free heuristics run otherwise.
- **Steps:** console.anthropic.com → API key → set a **monthly spend limit** in the console (recommend $20) as a hard backstop beyond the app's own cap.
- **Env:** `ANTHROPIC_API_KEY=`, `ANTHROPIC_MODEL=claude-haiku-4-5`
- **Cost reality:** ~$0.001 per site → ~$5 per 5,000-lead campaign.

## 8. Outscraper — OPTIONAL (paid coverage top-up)

- **Use:** only when a specific geo's free coverage is thin; a campaign opts in with its own budget cap.
- **Steps:** outscraper.com → account → API key → prepay credits (no subscription; 500 records/month free; $3/1k after; $1/1k above 100k/mo; credits never expire).
- **Env:** `OUTSCRAPER_API_KEY=`
- **Gotchas:** jobs are async (submit → poll → paginate) and **a submitted job is billed whether or not you fetch results** — the build handles this, but never re-submit a stalled job by hand without checking the dashboard. Google Maps scraping sits in a ToS gray zone borne by the vendor; keep it as the top-up, not the backbone.

## 9. SimpleMaps US Cities (basic) — OPTIONAL

- Needed **only** for the paid top-up's city fan-out. Download the free basic tier (CC-BY-4.0), save as `data/us_cities.csv`, keep the attribution line the build renders.

---

## 10. Environment manifest (copy into `.env.example`)

```
# Data (free)
OVERTURE_RELEASE=            OVERTURE_BASE_URL=s3://overturemaps-us-west-2/release
FSQ_RELEASE=                 FSQ_BASE_URL=
# Google (free)
PAGESPEED_API_KEY=
GOOGLE_OAUTH_CLIENT_ID=      GOOGLE_OAUTH_CLIENT_SECRET=      GOOGLE_DRIVE_FOLDER_ID=
# Access
CF_TUNNEL_TOKEN=             CF_ACCESS_TEAM_DOMAIN=           CF_ACCESS_AUD=
# Optional paid
ANTHROPIC_API_KEY=           ANTHROPIC_MODEL=claude-haiku-4-5
OUTSCRAPER_API_KEY=
# App
MOCK_MODE=0                  DATABASE_PATH=/data/leadforge.db     MONTHLY_SPEND_CEILING_USD=0
```

## 11. Procurement checklist (in order)

- [ ] Google Cloud project created; PageSpeed + Drive APIs enabled; API key restricted; OAuth client created with both redirect URIs
- [ ] Drive folder / Shared Drive created; folder ID captured
- [ ] Cloudflare tunnel created; Access app + Google IdP + email policy configured; AUD + team domain captured
- [ ] Host provisioned (≥4 GB RAM) with Docker; `.env` populated; tunnel connector running
- [ ] Current Overture + FSQ release IDs pinned; taxonomy file bundled
- [ ] *(Optional)* Anthropic key with console spend limit · Outscraper credits · SimpleMaps CSV
- [ ] First run: `MOCK_MODE=1` smoke → real-mode single-state extract → 200-record smoke campaign → Drive export lands

**Total procurement time:** roughly one afternoon. **Total recurring cost:** hosting only.
