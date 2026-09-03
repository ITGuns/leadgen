import { eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { placesOverture } from "@/db/schema";
import { defaults } from "../config";
import { taxonomyResolves } from "./taxonomy";
import { activeRelease, previousRelease } from "./releases";

/**
 * CONTRACTS C11 G1 — ingest gate, measured never claimed:
 *  a) per-state row counts within ±band of the previous active release
 *  b) every record has a GERS id (structurally guaranteed by PK, verified anyway)
 *  c) taxonomy values resolve against the bundled taxonomy file (≤2% unresolved tolerated,
 *     to survive minor catalog lag; the report lists the unresolved values either way)
 *  d) differing-verified-phone merge protection is enforced (and tested) in conflate.ts
 */

export type GateReport = {
  pass: boolean;
  failures: string[];
  warnings: string[];
  perState: Record<string, { rows: number; previousRows?: number; deltaPct?: number }>;
  unresolvedTaxonomy: { value: string; count: number }[];
  unresolvedPct: number;
};

export function runOvertureGate(releaseId: string, states: string[], rowCounts: Record<string, number>): GateReport {
  const db = getDb();
  const failures: string[] = [];
  const warnings: string[] = [];
  const perState: GateReport["perState"] = {};

  // compare against the previous release, or the still-active one when re-ingesting a new release over it
  const act = activeRelease("overture");
  const prev = (act && act.releaseId !== releaseId ? act : undefined) ?? previousRelease("overture");

  for (const state of states) {
    const rows = rowCounts[state] ?? 0;
    const entry: GateReport["perState"][string] = { rows };
    if (rows === 0) failures.push(`${state}: 0 rows extracted`);
    const prevRows = prev?.rowCounts?.[state];
    if (prevRows && prevRows > 0) {
      const deltaPct = (rows - prevRows) / prevRows;
      entry.previousRows = prevRows;
      entry.deltaPct = Math.round(deltaPct * 1000) / 10;
      if (Math.abs(deltaPct) > defaults.ingestBandPct) {
        failures.push(`${state}: row count ${rows} vs previous ${prevRows} (${entry.deltaPct}%) outside ±${defaults.ingestBandPct * 100}% band`);
      }
    }
    perState[state] = entry;
  }

  const missingGers = db
    .select({ n: sql<number>`count(*)` })
    .from(placesOverture)
    .where(or(isNull(placesOverture.gersId), eq(placesOverture.gersId, "")))
    .get();
  if (missingGers?.n) failures.push(`${missingGers.n} records missing a GERS id`);

  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(placesOverture)
    .where(eq(placesOverture.releaseId, releaseId))
    .get()?.n ?? 0;
  const taxCounts = db
    .select({ v: placesOverture.taxonomyPrimary, n: sql<number>`count(*)` })
    .from(placesOverture)
    .where(eq(placesOverture.releaseId, releaseId))
    .groupBy(placesOverture.taxonomyPrimary)
    .all();
  const unresolvedTaxonomy = taxCounts
    .filter((t) => t.v != null && !taxonomyResolves(t.v))
    .map((t) => ({ value: t.v!, count: t.n }))
    .sort((a, b) => b.count - a.count);
  const unresolvedCount = unresolvedTaxonomy.reduce((s, t) => s + t.count, 0);
  const unresolvedPct = total ? unresolvedCount / total : 0;
  if (unresolvedPct > 0.02) {
    failures.push(
      `${(unresolvedPct * 100).toFixed(1)}% of records carry taxonomy values missing from data/overture_taxonomy.csv (top: ${unresolvedTaxonomy
        .slice(0, 5)
        .map((t) => t.value)
        .join(", ")}) — drop in the pinned release's taxonomy file (BLOCKERS B5)`,
    );
  } else if (unresolvedCount > 0) {
    warnings.push(`${unresolvedCount} records with unresolved taxonomy (≤2% tolerance)`);
  }

  return { pass: failures.length === 0, failures, warnings, perState, unresolvedTaxonomy: unresolvedTaxonomy.slice(0, 20), unresolvedPct };
}
