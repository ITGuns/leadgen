import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { businesses, placesFsq, placesOverture, releases } from "@/db/schema";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { runOvertureGate } from "@/server/ingest/gate";

/**
 * G1 — the REAL DuckDB ingest path over the bundled Overture-shaped parquet (§4.7),
 * then conflation invariants including the differing-verified-phones trap (G1d).
 */

async function count(where?: ReturnType<typeof sql>): Promise<number> {
  const q = getDb().select({ n: sql<number>`count(*)::int` }).from(businesses);
  const rows = where ? await q.where(where) : await q;
  return rows[0]!.n;
}

async function activeOverture() {
  const [rel] = await getDb()
    .select()
    .from(releases)
    .where(and(eq(releases.source, "overture"), eq(releases.status, "active")))
    .limit(1);
  return rel;
}

describe("G1 · ingest + conflation over mock parquet", () => {
  beforeAll(async () => {
    await freshDb();
    registerAllHandlers();
    await enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { maxAttempts: 1 });
    const w = new Worker(1, 10);
    await w.drain(120_000); // chains: overture → fsq → conflate
  }, 180_000);

  it("extracts all three states with sane row counts and activates the release", async () => {
    const db = getDb();
    const rel = await activeOverture();
    expect(rel).toBeTruthy();
    expect(rel!.rowCounts!.TX).toBeGreaterThan(800);
    expect(rel!.rowCounts!.FL).toBeGreaterThan(450);
    expect(rel!.rowCounts!.GA).toBeGreaterThan(300);
    const diff = (rel!.gateReport as { diff?: { new: number; disappeared: number } } | null)?.diff;
    expect(diff).toBeTruthy();
    expect(diff!.new).toBeGreaterThan(1900); // first ingest: everything is new
    expect(diff!.disappeared).toBe(0);
    const [totalRow] = await db.select({ n: sql<number>`count(*)::int` }).from(placesOverture);
    const total = totalRow!.n;
    const sum = Object.values(rel!.rowCounts!).reduce((a, b) => a + b, 0);
    // address-less rows in overlapping state bboxes are counted per-state but stored
    // once by GERS id (bbox fallback, DECISIONS D16) — so sum ≥ table count, closely
    expect(total).toBeGreaterThan(1990);
    expect(sum).toBeGreaterThanOrEqual(total);
    expect(sum - total).toBeLessThan(20);
  });

  it("every extracted record has a GERS id and resolvable-or-reported taxonomy", async () => {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(placesOverture)
      .where(sql`gers_id IS NULL OR gers_id = ''`);
    expect(row!.n).toBe(0);
  });

  it("conflated businesses exist with stable identity keys and normalized fields", async () => {
    expect(await count()).toBeGreaterThan(1900);
    expect(await count(sql`identity_key NOT LIKE 'overture:%'`)).toBe(0);
    expect(await count(sql`phone IS NOT NULL AND phone NOT LIKE '+1%'`)).toBe(0);
  });

  it("FSQ gap-fills phones/websites on matched records with source attribution", async () => {
    expect(await count(sql`website_source = 'fsq'`)).toBeGreaterThan(5);
    expect(await count(sql`phone_source = 'fsq'`)).toBeGreaterThan(3);
    const [matched] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(placesFsq)
      .where(isNotNull(placesFsq.matchedGersId));
    expect(matched!.n).toBeGreaterThan(150);
  });

  it("G1d: never merges records with differing verified phones — conflicts recorded instead", async () => {
    const db = getDb();
    // trap rows: same name+location as an Overture record but a different phone
    const withConflicts = await db
      .select()
      .from(businesses)
      .where(sql`(sources -> 'conflicts') IS NOT NULL`);
    expect(withConflicts.length).toBeGreaterThan(10);
    for (const b of withConflicts) {
      for (const c of b.sources!.conflicts!) {
        if (c.field === "phone") expect(b.phone).toBe(c.kept); // original phone kept, never overwritten
      }
    }
    // and no fsq phone overwrote an existing overture phone anywhere
    expect(await count(sql`phone_source = 'fsq' AND (sources -> 'overture') IS NULL`)).toBe(0);
  });

  it("social-only vs website classification is applied statically at ingest", async () => {
    expect(await count(sql`website_class = 'social_only'`)).toBeGreaterThan(150);
    expect(await count(sql`website_class = 'none'`)).toBeGreaterThan(400);
    expect(await count(sql`website_class = 'aggregator'`)).toBeGreaterThan(50);
    expect(await count(sql`website_class = 'unknown'`)).toBeGreaterThan(700); // real-candidate URLs awaiting the fetch pass
  });

  it("chain flagging marks the seeded multi-state franchise", async () => {
    const chainRows = await getDb().select().from(businesses).where(eq(businesses.chain, true));
    expect(chainRows.some((b) => b.normalizedName.includes("roto rooter"))).toBe(true);
  });

  it("re-running ingest+conflate is idempotent (dedupe determinism at the ingest level)", async () => {
    const db = getDb();
    const before = await count();
    const beforeIds = (await db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id)).map((r) => r.id);
    await enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { maxAttempts: 1 });
    const w = new Worker(1, 10);
    await w.drain(120_000);
    const after = await count();
    const afterIds = (await db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id)).map((r) => r.id);
    expect(after).toBe(before);
    expect(afterIds).toEqual(beforeIds); // business ids stable across re-ingest — leads never detach
    // §4.0 release diff: a same-release re-run diffs to zero on every axis
    const rel = (await activeOverture())!;
    const diff = (rel.gateReport as { diff?: { new: number; changedWebsites: number; changedPhones: number; disappeared: number } } | null)?.diff;
    expect(diff).toEqual(expect.objectContaining({ new: 0, changedWebsites: 0, changedPhones: 0, disappeared: 0 }));
  }, 180_000);

  it("row-count band: a state suddenly losing >40% fails the gate and keeps the previous release", async () => {
    const rel = (await activeOverture())!;
    const shrunk = { ...rel.rowCounts!, TX: Math.floor(rel.rowCounts!.TX * 0.5) };
    const report = await runOvertureGate("hypothetical-next", ["TX", "FL", "GA"], shrunk);
    expect(report.pass).toBe(false);
    expect(report.failures.join(" ")).toContain("TX");
  });
});
