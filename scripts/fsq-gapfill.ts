/**
 * Foursquare gap-fill for already-loaded states, then conflation (chain).
 * Run from a workstation (native DuckDB) after the Overture load — fills missing
 * phones/websites/emails on matched businesses (C4 matcher, G1d never-merge rule).
 *
 *   MOCK_MODE=0 FSQ_RELEASE=2026-08-11 HF_TOKEN=hf_… \
 *     DATABASE_URL=<pooler url> [DUCKDB_HTTP_PROXY=127.0.0.1:8118] \
 *     npx tsx scripts/fsq-gapfill.ts DE [FL …]
 */
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { getDb, initDb } from "@/db/client";
import { businesses, placesFsq, jobs } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

const states = process.argv.slice(2).filter((s) => /^[A-Za-z]{2}$/.test(s)).map((s) => s.toUpperCase());
if (!states.length) {
  console.error("usage: npx tsx scripts/fsq-gapfill.ts DE [FL …]");
  process.exit(1);
}

(async () => {
  await initDb();
  registerAllHandlers();
  // revive a failed checkpointed run (keeps per-state progress) before enqueueing
  const payload = { states, chain: true };
  await getDb()
    .update(jobs)
    .set({ status: "pending", attempts: 0, lastError: null, runAfter: null })
    .where(and(eq(jobs.type, "ingest_fsq"), eq(jobs.status, "failed"), sql`${jobs.payload} = ${JSON.stringify(payload)}::jsonb`));
  await enqueueJob("ingest_fsq", payload, { maxAttempts: 5, dedupe: true });
  const worker = new Worker(1, 250);
  console.log(`FSQ gap-fill for ${states.join(", ")} — streaming the gated HF parquet; this can take a while`);
  await worker.drain(4 * 3600_000);
  const [f] = await getDb().select({ n: sql<number>`count(*)::int` }).from(placesFsq);
  const [m] = await getDb().select({ n: sql<number>`count(*)::int` }).from(placesFsq).where(sql`matched_gers_id IS NOT NULL`);
  const [pf] = await getDb().select({ n: sql<number>`count(*)::int` }).from(businesses).where(sql`phone_source = 'fsq'`);
  const [wf] = await getDb().select({ n: sql<number>`count(*)::int` }).from(businesses).where(sql`website_source = 'fsq'`);
  console.log(`fsq rows: ${f.n} · matched: ${m.n} · phones filled: ${pf.n} · websites filled: ${wf.n}`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
