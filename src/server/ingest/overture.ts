import fs from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { placesOverture, releases } from "@/db/schema";
import { env, now } from "../config";
import type { JobContext } from "../jobs/registry";
import { JobStopped } from "../jobs/registry";
import { queryJson, withDuck } from "./duck";
import { runOvertureGate } from "./gate";
import { activateRelease, ensureReleaseRow, failRelease } from "./releases";

/**
 * DECISIONS D9 — the extract SQL targets the September-2026 Overture Places schema
 * (`taxonomy` replaced the deprecated `categories`; nested names/addresses/bbox).
 * Release bumps are verified HERE. Query discipline (§4.0): bbox pre-filter first
 * (predicate pushdown), region-code select (`US-TX` or `TX`), bbox-only fallback for
 * records lacking an address (polygon refinement deferred — DECISIONS D16).
 */

type Bbox = { xmin: number; xmax: number; ymin: number; ymax: number };

let bboxCache: Record<string, Bbox> | null = null;
export function stateBbox(state: string): Bbox {
  if (!bboxCache) {
    bboxCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "state_bboxes.json"), "utf8"));
    delete (bboxCache as Record<string, unknown>)._comment;
  }
  const b = bboxCache![state];
  if (!b) throw new Error(`no bbox for state ${state}`);
  return b;
}

export function overtureSourcePath(): string {
  if (env.mockMode) return path.join(process.cwd(), "fixtures", "mock", "places_overture.parquet");
  const release = env.overtureRelease();
  if (!release) throw new Error("OVERTURE_RELEASE is not set (BLOCKERS B5)");
  return `${env.overtureBaseUrl()}/${release}/theme=places/type=place/*`;
}

export function overtureReleaseId(): string {
  return env.mockMode ? "mock-2026-09" : env.overtureRelease();
}

export function overtureSelectSql(source: string, state: string): string {
  const b = stateBbox(state);
  return `
    SELECT
      id,
      names."primary"        AS name,
      taxonomy."primary"     AS taxonomy_primary,
      taxonomy.alternates    AS taxonomy_alternates,
      confidence,
      operating_status,
      phones, websites, socials, emails,
      addresses[1].freeform  AS street,
      addresses[1].locality  AS city,
      addresses[1].region    AS region,
      addresses[1].postcode  AS postal,
      (bbox.xmin + bbox.xmax) / 2.0 AS lng,
      (bbox.ymin + bbox.ymax) / 2.0 AS lat
    FROM read_parquet('${source.replaceAll("'", "''")}', hive_partitioning=1)
    WHERE bbox.xmin >= ${b.xmin} AND bbox.xmax <= ${b.xmax}
      AND bbox.ymin >= ${b.ymin} AND bbox.ymax <= ${b.ymax}
      AND (
        addresses[1].region IN ('${state}', 'US-${state}')
        OR (addresses[1].region IS NULL AND coalesce(addresses[1].country, 'US') = 'US')
      )`;
}

export type OvertureRow = {
  id: string;
  name: string | null;
  taxonomy_primary: string | null;
  taxonomy_alternates: string[] | null;
  confidence: number | null;
  operating_status: string | null;
  phones: string[] | null;
  websites: string[] | null;
  socials: string[] | null;
  emails: string[] | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  lng: number | null;
  lat: number | null;
};

export function normalizeRegion(region: string | null, fallback: string): string {
  if (!region) return fallback;
  return region.replace(/^US-/, "").toUpperCase();
}

/** Extract the given states for the pinned release into places_overture. Resumable per state. */
export async function runOvertureExtract(ctx: JobContext): Promise<void> {
  const db = getDb();
  const payload = (ctx.job.payload ?? {}) as { states?: string[]; chain?: boolean };
  const states = payload.states ?? ["TX", "FL", "GA"];
  const releaseId = overtureReleaseId();
  const release = await ensureReleaseRow("overture", releaseId, states);
  const progress = (ctx.job.progress ?? {}) as { stateIndex?: number; rowCounts?: Record<string, number> };
  const rowCounts: Record<string, number> = progress.rowCounts ?? {};

  await withDuck(async (conn) => {
    for (let i = progress.stateIndex ?? 0; i < states.length; i++) {
      if (ctx.shouldStop()) throw new JobStopped();
      const state = states[i];
      const rows = await queryJson<OvertureRow>(conn, overtureSelectSql(overtureSourcePath(), state));
      const ts = now().toISOString();
      const values = rows
        .filter((r) => r.id && r.name)
        .map((r) => ({
          gersId: r.id,
          name: r.name!,
          phones: r.phones ?? [],
          websites: r.websites ?? [],
          socials: r.socials ?? [],
          emails: r.emails ?? [],
          street: r.street,
          city: r.city,
          region: normalizeRegion(r.region, state),
          postal: r.postal,
          lat: r.lat,
          lng: r.lng,
          taxonomyPrimary: r.taxonomy_primary,
          taxonomyAlternates: r.taxonomy_alternates ?? [],
          confidence: r.confidence,
          operatingStatus: r.operating_status ?? "unknown",
          releaseId,
        }));
      // Staging semantics: latest-wins per GERS id (delete+insert, chunked). A gate-failed
      // release never reaches conflation, so `businesses` stays on the previous release.
      await db.transaction(async (tx) => {
        for (let c = 0; c < values.length; c += 500) {
          const chunk = values.slice(c, c + 500);
          await tx.delete(placesOverture).where(inArray(placesOverture.gersId, chunk.map((v) => v.gersId)));
          await tx.insert(placesOverture).values(chunk);
        }
      });
      rowCounts[state] = values.length;
      await ctx.checkpoint({ stateIndex: i + 1, rowCounts, at: ts });
    }
  });

  await db.update(releases).set({ rowCounts }).where(eq(releases.id, release.id));
  const gate = await runOvertureGate(releaseId, states, rowCounts);
  if (!gate.pass) {
    await failRelease(release.id, gate);
    throw new Error(`ingest gate FAILED for overture ${releaseId}: ${gate.failures.join("; ")} — previous release kept active`);
  }
  await activateRelease("overture", release.id, gate);
  await ctx.checkpoint({ gate });

  if (payload.chain) {
    const { enqueueJob } = await import("../jobs/worker");
    await enqueueJob("ingest_fsq", { states, chain: true }, { dedupe: true });
  }
}

/** Row count sanity for the definition-of-done spot check. */
export async function overtureRowCount(releaseId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(placesOverture)
    .where(eq(placesOverture.releaseId, releaseId));
  return row?.n ?? 0;
}
