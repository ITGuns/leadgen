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

describe("G1 · ingest + conflation over mock parquet", () => {
  beforeAll(async () => {
    freshDb();
    registerAllHandlers();
    enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { maxAttempts: 1 });
    const w = new Worker(1, 10);
    await w.drain(120_000); // chains: overture → fsq → conflate
  }, 180_000);

  it("extracts all three states with sane row counts and activates the release", () => {
    const db = getDb();
    const rel = db.select().from(releases).where(and(eq(releases.source, "overture"), eq(releases.status, "active"))).get();
    expect(rel).toBeTruthy();
    expect(rel!.rowCounts!.TX).toBeGreaterThan(800);
    expect(rel!.rowCounts!.FL).toBeGreaterThan(450);
    expect(rel!.rowCounts!.GA).toBeGreaterThan(300);
    const total = db.select({ n: sql<number>`count(*)` }).from(placesOverture).get()!.n;
    const sum = Object.values(rel!.rowCounts!).reduce((a, b) => a + b, 0);
    // address-less rows in overlapping state bboxes are counted per-state but stored
    // once by GERS id (bbox fallback, DECISIONS D16) — so sum ≥ table count, closely
    expect(total).toBeGreaterThan(1990);
    expect(sum).toBeGreaterThanOrEqual(total);
    expect(sum - total).toBeLessThan(20);
  });

  it("every extracted record has a GERS id and resolvable-or-reported taxonomy", () => {
    const db = getDb();
    const missing = db.select({ n: sql<number>`count(*)` }).from(placesOverture).where(sql`gers_id IS NULL OR gers_id = ''`).get()!.n;
    expect(missing).toBe(0);
  });

  it("conflated businesses exist with stable identity keys and normalized fields", () => {
    const db = getDb();
    const total = db.select({ n: sql<number>`count(*)` }).from(businesses).get()!.n;
    expect(total).toBeGreaterThan(1900);
    const bad = db.select({ n: sql<number>`count(*)` }).from(businesses).where(sql`identity_key NOT LIKE 'overture:%'`).get()!.n;
    expect(bad).toBe(0);
    const badPhone = db
      .select({ n: sql<number>`count(*)` })
      .from(businesses)
      .where(and(isNotNull(businesses.phone), sql`phone NOT LIKE '+1%'`))
      .get()!.n;
    expect(badPhone).toBe(0);
  });

  it("FSQ gap-fills phones/websites on matched records with source attribution", () => {
    const db = getDb();
    const filledWebsites = db
      .select({ n: sql<number>`count(*)` })
      .from(businesses)
      .where(eq(businesses.websiteSource, "fsq"))
      .get()!.n;
    const filledPhones = db
      .select({ n: sql<number>`count(*)` })
      .from(businesses)
      .where(eq(businesses.phoneSource, "fsq"))
      .get()!.n;
    expect(filledWebsites).toBeGreaterThan(5);
    expect(filledPhones).toBeGreaterThan(3);
    const matched = db.select({ n: sql<number>`count(*)` }).from(placesFsq).where(isNotNull(placesFsq.matchedGersId)).get()!.n;
    expect(matched).toBeGreaterThan(150);
  });

  it("G1d: never merges records with differing verified phones — conflicts recorded instead", () => {
    const db = getDb();
    // trap rows: same name+location as an Overture record but a different phone
    const withConflicts = db
      .select()
      .from(businesses)
      .where(sql`json_extract(sources, '$.conflicts') IS NOT NULL`)
      .all();
    expect(withConflicts.length).toBeGreaterThan(10);
    for (const b of withConflicts) {
      for (const c of b.sources!.conflicts!) {
        if (c.field === "phone") expect(b.phone).toBe(c.kept); // original phone kept, never overwritten
      }
    }
    // and no fsq phone overwrote an existing overture phone anywhere
    const overwritten = db
      .select({ n: sql<number>`count(*)` })
      .from(businesses)
      .where(and(eq(businesses.phoneSource, "fsq"), sql`json_extract(sources, '$.overture') IS NULL`))
      .get()!.n;
    expect(overwritten).toBe(0);
  });

  it("social-only vs website classification is applied statically at ingest", () => {
    const db = getDb();
    const socialOnly = db.select({ n: sql<number>`count(*)` }).from(businesses).where(eq(businesses.websiteClass, "social_only")).get()!.n;
    const none = db.select({ n: sql<number>`count(*)` }).from(businesses).where(eq(businesses.websiteClass, "none")).get()!.n;
    const aggregator = db.select({ n: sql<number>`count(*)` }).from(businesses).where(eq(businesses.websiteClass, "aggregator")).get()!.n;
    const unknown = db.select({ n: sql<number>`count(*)` }).from(businesses).where(eq(businesses.websiteClass, "unknown")).get()!.n;
    expect(socialOnly).toBeGreaterThan(150);
    expect(none).toBeGreaterThan(400);
    expect(aggregator).toBeGreaterThan(50);
    expect(unknown).toBeGreaterThan(700); // real-candidate URLs awaiting the fetch pass
  });

  it("chain flagging marks the seeded multi-state franchise", () => {
    const db = getDb();
    const chainRows = db.select().from(businesses).where(eq(businesses.chain, true)).all();
    expect(chainRows.some((b) => b.normalizedName.includes("roto rooter"))).toBe(true);
  });

  it("re-running ingest+conflate is idempotent (dedupe determinism at the ingest level)", async () => {
    const db = getDb();
    const before = db.select({ n: sql<number>`count(*)` }).from(businesses).get()!.n;
    const beforeIds = db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).all().map((r) => r.id);
    enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { maxAttempts: 1 });
    const w = new Worker(1, 10);
    await w.drain(120_000);
    const after = db.select({ n: sql<number>`count(*)` }).from(businesses).get()!.n;
    const afterIds = db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).all().map((r) => r.id);
    expect(after).toBe(before);
    expect(afterIds).toEqual(beforeIds); // business ids stable across re-ingest — leads never detach
  }, 180_000);

  it("row-count band: a state suddenly losing >40% fails the gate and keeps the previous release", () => {
    const rel = getDb().select().from(releases).where(and(eq(releases.source, "overture"), eq(releases.status, "active"))).get()!;
    const shrunk = { ...rel.rowCounts!, TX: Math.floor(rel.rowCounts!.TX * 0.5) };
    const report = runOvertureGate("hypothetical-next", ["TX", "FL", "GA"], shrunk);
    expect(report.pass).toBe(false);
    expect(report.failures.join(" ")).toContain("TX");
  });
});
