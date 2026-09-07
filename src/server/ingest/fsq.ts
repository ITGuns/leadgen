import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { placesFsq } from "@/db/schema";
import { env, now } from "../config";
import { effectiveSecret } from "../secure-store";
import type { JobContext } from "../jobs/registry";
import { JobStopped } from "../jobs/registry";
import { queryJson, withDuck } from "./duck";
import { activateRelease, ensureReleaseRow } from "./releases";

/**
 * FSQ OS Places extract — v1 uses it ONLY as phone/website gap-fill on matched
 * Overture records (§4.0), so the extract is a flat slice per state.
 *
 * Access (probed live 2026-09-06, superseding the procurement guide's "anonymous"):
 * the old public S3 bucket now serves only LICENSE/NOTICE; distribution is the gated
 * HF dataset `foursquare/fsq-os-places` (free account, gated=auto → instant approval,
 * needs HF_TOKEN). Canonical path per its README:
 *   hf://datasets/foursquare/fsq-os-places/release/dt=<RELEASE>/places/parquet/*.parquet
 * Column names below are verified against Foursquare's Places OS schema docs.
 */

const HF_DATASET_BASE = "hf://datasets/foursquare/fsq-os-places/release";

export function fsqSourcePath(): string {
  if (env.mockMode) return path.join(process.cwd(), "fixtures", "mock", "places_fsq.parquet");
  const base = env.fsqBaseUrl();
  if (base) return base.endsWith(".parquet") ? base : `${base.replace(/\/$/, "")}/*.parquet`;
  const release = env.fsqRelease();
  if (!release) throw new Error("set FSQ_RELEASE (e.g. 2026-08-11) or FSQ_BASE_URL, plus HF_TOKEN (BLOCKERS B6)");
  return `${HF_DATASET_BASE}/dt=${release}/places/parquet/*.parquet`;
}
export function fsqReleaseId(): string {
  return env.mockMode ? "mock-2026-09" : env.fsqRelease() || "unpinned";
}

export function fsqSelectSql(source: string, state: string): string {
  const src = source.replaceAll("'", "''");
  if (env.mockMode) {
    return `
      SELECT fsq_place_id, name, tel, website, email, address, locality, region, postcode,
             latitude, longitude
      FROM read_parquet('${src}')
      WHERE region = '${state}' AND country = 'US'`;
  }
  // real fsq-os-places shape: date-partitioned, region/country columns, closed-place flag
  return `
    SELECT fsq_place_id, name, tel, website, email, address, locality, region, postcode,
           latitude, longitude
    FROM read_parquet('${src}', hive_partitioning=1)
    WHERE region = '${state}' AND country = 'US' AND date_closed IS NULL`;
}

type FsqRow = {
  fsq_place_id: string;
  name: string | null;
  tel: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  locality: string | null;
  region: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** FSQ is OPTIONAL gap-fill (§4.0): in real mode without access configured, the
 * extract skips gracefully and the chain continues to conflation — a missing free
 * HF token must never block the monthly ingest. */
export async function fsqConfigured(): Promise<boolean> {
  if (env.mockMode) return true;
  if (env.fsqBaseUrl()) return true; // custom mirror needs no token
  return !!(env.fsqRelease() && (await effectiveSecret("hf_token", env.hfToken())));
}

export async function runFsqExtract(ctx: JobContext): Promise<void> {
  const db = getDb();
  const payload = (ctx.job.payload ?? {}) as { states?: string[]; chain?: boolean };
  const states = payload.states ?? ["TX", "FL", "GA"];
  if (!(await fsqConfigured())) {
    await ctx.checkpoint({
      skipped: true,
      reason: "FSQ gap-fill not configured (set FSQ_RELEASE + HF_TOKEN, or FSQ_BASE_URL — BLOCKERS B6); continuing without gap-fill",
    });
    if (payload.chain) {
      const { enqueueJob } = await import("../jobs/worker");
      await enqueueJob("conflate", {}, { dedupe: true });
    }
    return;
  }
  const releaseId = fsqReleaseId();
  const release = await ensureReleaseRow("fsq", releaseId, states);
  const progress = (ctx.job.progress ?? {}) as { stateIndex?: number; rowCounts?: Record<string, number> };
  const rowCounts: Record<string, number> = progress.rowCounts ?? {};

  await withDuck(async (conn) => {
    for (let i = progress.stateIndex ?? 0; i < states.length; i++) {
      if (ctx.shouldStop()) throw new JobStopped();
      const state = states[i];
      const rows = await queryJson<FsqRow>(conn, fsqSelectSql(fsqSourcePath(), state));
      const values = rows
        .filter((r) => r.fsq_place_id && r.name)
        .map((r) => ({
          fsqId: r.fsq_place_id,
          name: r.name!,
          tel: r.tel,
          website: r.website,
          email: r.email,
          street: r.address,
          city: r.locality,
          region: (r.region ?? state).replace(/^US-/, "").toUpperCase(),
          postal: r.postcode,
          lat: r.latitude,
          lng: r.longitude,
          releaseId,
        }));
      await db.transaction(async (tx) => {
        for (let c = 0; c < values.length; c += 300) {
          const chunk = values.slice(c, c + 300);
          await tx.delete(placesFsq).where(inArray(placesFsq.fsqId, chunk.map((v) => v.fsqId)));
          await tx.insert(placesFsq).values(chunk);
        }
      });
      rowCounts[state] = values.length;
      await ctx.checkpoint({ stateIndex: i + 1, rowCounts, at: now().toISOString() });
    }
  });

  // FSQ is gap-fill only — no band gate of its own; activate and hand off to conflation.
  await activateRelease("fsq", release.id, { rowCounts });
  if (payload.chain) {
    const { enqueueJob } = await import("../jobs/worker");
    await enqueueJob("conflate", {}, { dedupe: true });
  }
}
