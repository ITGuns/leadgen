import { sql } from "drizzle-orm";
import { initDb } from "@/db/client";
import { businesses } from "@/db/schema";
import { ensureDirs, env, isServerless } from "./config";
import { registerAllHandlers } from "./jobs/handlers";
import { startCron } from "./jobs/cron";
import { enqueueJob, getWorker } from "./jobs/worker";

/** D13 — one boot path for dev/prod, called from instrumentation.ts. HMR-safe.
 * D19 — on Vercel there is no resident process: handlers are registered but the
 * interval worker/cron never start; Vercel Cron drives /api/jobs/tick instead. */

type G = typeof globalThis & { __leadforgeBootPromise?: Promise<void> };
const g = globalThis as G;

export async function boot(): Promise<void> {
  if (!g.__leadforgeBootPromise) g.__leadforgeBootPromise = doBoot();
  return g.__leadforgeBootPromise;
}

async function doBoot(): Promise<void> {
  ensureDirs();
  const db = await initDb(); // opens + migrates
  registerAllHandlers();
  if (!isServerless()) {
    (await getWorker()).start();
    startCron();

    // Mock mode seeds itself so a fresh checkout has data to demo against (§4.7).
    if (env.mockMode) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(businesses);
      if ((row?.n ?? 0) === 0) {
        await enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { dedupe: true, maxAttempts: 1 });
      }
    }
  }
  console.log(
    `[leadforge] boot ok · mock=${env.mockMode ? "1" : "0"} · serverless=${isServerless() ? "1" : "0"} · db=${env.databaseUrl() ? "postgres" : `pglite:${env.pgliteDir()}`}`,
  );
}
