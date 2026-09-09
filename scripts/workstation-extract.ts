/**
 * §4.0 / D19 — the monthly Overture/FSQ extract NEVER runs on Vercel (native DuckDB).
 * Run it from any workstation, pointed straight at the shared database:
 *
 *   MOCK_MODE=0 OVERTURE_RELEASE=2026-08-19.0 \
 *     DATABASE_URL='postgresql://…pooler.supabase.com:5432/postgres' \
 *     npx tsx scripts/workstation-extract.ts TX FL GA
 *
 * The extract streams the public parquet through DuckDB and writes conflated rows
 * directly into Supabase — nothing to copy afterwards. Without DATABASE_URL it fills
 * the local PGlite dir (.data/pg) for local/Docker runs instead.
 */
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { ensureDirs } from "@/server/config";
import { getDb, initDb } from "@/db/client";
import { businesses, jobs, releases } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

const states = process.argv.slice(2).filter((s) => /^[A-Za-z]{2}$/.test(s)).map((s) => s.toUpperCase());
if (!states.length) {
  console.error("usage: npx tsx scripts/workstation-extract.ts TX FL GA …");
  process.exit(1);
}

(async () => {
  ensureDirs();
  await initDb();
  registerAllHandlers();
  const worker = new Worker(1, 250);
  console.log(`extracting ${states.join(", ")} — this streams the public parquet; expect minutes per state`);
  // a prior FAILED run keeps its checkpoint (per-state progress) — revive it rather
  // than enqueueing a fresh job that would re-extract everything from state one
  const payload = { states, chain: true };
  await getDb()
    .update(jobs)
    .set({ status: "pending", attempts: 0, lastError: null, runAfter: null })
    .where(and(eq(jobs.type, "ingest_overture"), eq(jobs.status, "failed"), sql`${jobs.payload} = ${JSON.stringify(payload)}::jsonb`));
  await enqueueJob("ingest_overture", payload, { maxAttempts: 5, dedupe: true });
  await worker.drain(6 * 3600_000);
  const rel = await getDb().select().from(releases);
  const [countRow] = await getDb().select({ n: sql<number>`count(*)::int` }).from(businesses);
  console.log("releases:", rel.map((r) => `${r.source}:${r.releaseId}:${r.status}`).join(" · "));
  console.log(`businesses conflated: ${countRow?.n ?? 0}`);
  console.log(`done → ${process.env.DATABASE_URL ? "shared database (Supabase)" : "local PGlite"}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
