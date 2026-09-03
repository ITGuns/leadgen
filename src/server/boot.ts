import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses } from "@/db/schema";
import { ensureDirs, env } from "./config";
import { registerAllHandlers } from "./jobs/handlers";
import { startCron } from "./jobs/cron";
import { enqueueJob, getWorker } from "./jobs/worker";

/** D13 — one boot path for dev/prod, called from instrumentation.ts. HMR-safe. */

type G = typeof globalThis & { __leadforgeBooted?: boolean };
const g = globalThis as G;

export function boot(): void {
  if (g.__leadforgeBooted) return;
  g.__leadforgeBooted = true;
  ensureDirs();
  const db = getDb(); // opens + migrates
  registerAllHandlers();
  getWorker().start();
  startCron();

  // Mock mode seeds itself so a fresh checkout has data to demo against (§4.7).
  if (env.mockMode) {
    const n = db.select({ n: sql<number>`count(*)` }).from(businesses).get()?.n ?? 0;
    if (n === 0) {
      enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { dedupe: true, maxAttempts: 1 });
    }
  }
  console.log(`[leadforge] boot ok · mock=${env.mockMode ? "1" : "0"} · db=${env.databasePath()}`);
}
