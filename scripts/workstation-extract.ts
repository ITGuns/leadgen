/**
 * §4.0 alternative: run the monthly Overture/FSQ extract on an office machine when the
 * VPS is under 4 GB RAM, then ship the resulting SQLite file to the server.
 *
 * Usage:
 *   MOCK_MODE=0 OVERTURE_RELEASE=2026-08-19.0 DATABASE_PATH=./out/leadforge.db \
 *     npx tsx scripts/workstation-extract.ts TX FL GA
 *
 * Then, on the server (app stopped so WAL is settled):
 *   scp ./out/leadforge.db server:/tmp/ && ssh server \
 *     'docker compose stop leadforge && cp /tmp/leadforge.db /var/lib/docker/volumes/…/leadforge.db && docker compose start leadforge'
 * (or simply re-run this script pointing DATABASE_PATH at the mounted volume)
 */
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { ensureDirs } from "@/server/config";
import { getDb } from "@/db/client";
import { businesses, releases } from "@/db/schema";
import { sql } from "drizzle-orm";

const states = process.argv.slice(2).filter((s) => /^[A-Za-z]{2}$/.test(s)).map((s) => s.toUpperCase());
if (!states.length) {
  console.error("usage: npx tsx scripts/workstation-extract.ts TX FL GA …");
  process.exit(1);
}

(async () => {
  ensureDirs();
  registerAllHandlers();
  const worker = new Worker(1, 250);
  console.log(`extracting ${states.join(", ")} — this streams the public parquet; expect minutes per state`);
  enqueueJob("ingest_overture", { states, chain: true }, { maxAttempts: 1 });
  await worker.drain(6 * 3600_000);
  const rel = getDb().select().from(releases).all();
  const count = getDb().select({ n: sql<number>`count(*)` }).from(businesses).get()!.n;
  console.log("releases:", rel.map((r) => `${r.source}:${r.releaseId}:${r.status}`).join(" · "));
  console.log(`businesses conflated: ${count}`);
  console.log(`done → ${process.env.DATABASE_PATH ?? "./.data/leadforge.db"}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
