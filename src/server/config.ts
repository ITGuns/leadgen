import path from "node:path";
import fs from "node:fs";

/**
 * Environment + defaults. Operational knobs can be overridden at runtime via the
 * app_settings table (see settings.ts); secrets entered in the UI live in the
 * encrypted config store (secure-store.ts). Precedence: secure store > env.
 */

function bool(v: string | undefined, dflt = false): boolean {
  if (v === undefined || v === "") return dflt;
  return v === "1" || v.toLowerCase() === "true";
}
function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : dflt;
}

const cwd = process.cwd();

export const env = {
  get mockMode(): boolean {
    // Default to mock when nothing is configured — the app must always boot.
    return bool(process.env.MOCK_MODE, true);
  },
  /** D19: Supabase/Postgres connection string; empty = local PGlite under pgliteDir */
  databaseUrl: () => process.env.DATABASE_URL || "",
  pgliteDir: () => process.env.PGLITE_DIR || path.join(cwd, ".data", "pg"),
  exportsDir: () => process.env.EXPORTS_DIR || (process.env.VERCEL ? "/tmp/leadforge-exports" : path.join(cwd, ".data", "exports")),
  backupsDir: () => process.env.BACKUPS_DIR || (process.env.VERCEL ? "/tmp/leadforge-backups" : path.join(cwd, ".data", "backups")),
  appSecret: () => process.env.APP_SECRET || "leadforge-dev-secret-not-for-production",

  overtureRelease: () => process.env.OVERTURE_RELEASE || "",
  overtureBaseUrl: () => process.env.OVERTURE_BASE_URL || "s3://overturemaps-us-west-2/release",
  fsqRelease: () => process.env.FSQ_RELEASE || "",
  fsqBaseUrl: () => process.env.FSQ_BASE_URL || "",
  // FSQ OS Places moved to gated HF distribution (free account, auto-approved) — probed 2026-09-06, see BLOCKERS B6
  hfToken: () => process.env.HF_TOKEN || "",

  pagespeedApiKey: () => process.env.PAGESPEED_API_KEY || "",
  googleClientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  googleClientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  googleDriveFolderId: () => process.env.GOOGLE_DRIVE_FOLDER_ID || "",

  cfAccessTeamDomain: () => process.env.CF_ACCESS_TEAM_DOMAIN || "",
  cfAccessAud: () => process.env.CF_ACCESS_AUD || "",

  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
  outscraperApiKey: () => process.env.OUTSCRAPER_API_KEY || "",

  monthlySpendCeilingUSD: () => num(process.env.MONTHLY_SPEND_CEILING_USD, 0),
  appUrl: () => process.env.APP_URL || "http://localhost:3000",

  // D19/D20 — Vercel + Supabase deployment
  supabaseUrl: () => (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseServiceKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  cronSecret: () => process.env.CRON_SECRET || "",
  /** D23 — the app's own front door: HTTP Basic with this password (any username).
   * Exists because Vercel's free tier cannot protect the production domain. */
  appPassword: () => process.env.APP_PASSWORD || "",
  /** Explicit, documented weakening switch (D20): trust the platform's own door
   * (Vercel Deployment Protection / a fronting proxy) instead of CF Access JWTs. */
  authTrustPlatform: () => bool(process.env.AUTH_TRUST_PLATFORM, false),
  operatorEmail: () => process.env.OPERATOR_EMAIL || "operator@gemfieldconsulting.com",
  jobSliceMs: () => num(process.env.JOB_SLICE_MS, 280_000),
};

/** Static operational defaults; overridable via app_settings (settings.ts). */
export const defaults = {
  fetchPerDomain: 2,
  fetchGlobal: 10,
  fetchTimeoutMs: 8000,
  fetchMaxBytes: 2 * 1024 * 1024,
  pagespeedDailyQuota: 25000,
  pagespeedQuotaSafety: 500,
  pagespeedCacheDays: 30,
  jobConcurrency: 2,
  workerTickMs: 1000,
  minConfidenceDefault: 0.6,
  smokeRecordLimit: 200,
  maxRecordsDefault: 5000,
  cityPopulationFloor: 5000,
  backupRetentionDays: 30,
  chainStateThreshold: 6,
  outscraperCostPer1k: 3.0,
  ingestBandPct: 0.4, // ±40% row-count band vs previous release fails the gate
};

export const MOCK_IDENTITY = { email: "dev@gemfieldconsulting.com", name: "Dev User" };

export function ensureDirs(): void {
  const dirs = [env.exportsDir(), env.backupsDir()];
  if (!env.databaseUrl()) dirs.push(env.pgliteDir());
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {
      // serverless filesystems are read-only outside /tmp — harmless there
    }
  }
}

export function isServerless(): boolean {
  return !!process.env.VERCEL;
}

/** Frozen clock in mock mode so fixtures, caches and tests are deterministic. */
export function now(): Date {
  if (env.mockMode && process.env.LEADFORGE_FROZEN_CLOCK) {
    return new Date(process.env.LEADFORGE_FROZEN_CLOCK);
  }
  return new Date();
}
