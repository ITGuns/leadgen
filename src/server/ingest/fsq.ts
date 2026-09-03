import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { placesFsq } from "@/db/schema";
import { env, now } from "../config";
import type { JobContext } from "../jobs/registry";
import { JobStopped } from "../jobs/registry";
import { queryJson, withDuck } from "./duck";
import { activateRelease, ensureReleaseRow } from "./releases";

/**
 * FSQ OS Places extract — v1 uses it ONLY as phone/website gap-fill on matched
 * Overture records (§4.0), so the extract is a flat slice per state. Column names
 * target the published fsq-os-places parquet; verify on release bump (BLOCKERS B6).
 */

export function fsqSourcePath(): string {
  if (env.mockMode) return path.join(process.cwd(), "fixtures", "mock", "places_fsq.parquet");
  const base = env.fsqBaseUrl();
  if (!base) throw new Error("FSQ_BASE_URL is not set (BLOCKERS B6)");
  return base.endsWith(".parquet") ? base : `${base.replace(/\/$/, "")}/*.parquet`;
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

export async function runFsqExtract(ctx: JobContext): Promise<void> {
  const db = getDb();
  const payload = (ctx.job.payload ?? {}) as { states?: string[]; chain?: boolean };
  const states = payload.states ?? ["TX", "FL", "GA"];
  const releaseId = fsqReleaseId();
  const release = ensureReleaseRow("fsq", releaseId, states);
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
      db.transaction(() => {
        for (let c = 0; c < values.length; c += 300) {
          const chunk = values.slice(c, c + 300);
          db.delete(placesFsq)
            .where(sql`${placesFsq.fsqId} IN (${sql.join(chunk.map((v) => sql`${v.fsqId}`), sql`, `)})`)
            .run();
          db.insert(placesFsq).values(chunk).run();
        }
      });
      rowCounts[state] = values.length;
      ctx.checkpoint({ stateIndex: i + 1, rowCounts, at: now().toISOString() });
    }
  });

  // FSQ is gap-fill only — no band gate of its own; activate and hand off to conflation.
  activateRelease("fsq", release.id, { rowCounts });
  if (payload.chain) {
    const { enqueueJob } = await import("../jobs/worker");
    enqueueJob("conflate", {}, { dedupe: true });
  }
}
