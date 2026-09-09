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
import { businesses, releases } from "@/db/schema";
import { sql } from "drizzle-orm";

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
  await enqueueJob("ingest_overture", { states, chain: true }, { maxAttempts: 1, dedupe: true });
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
