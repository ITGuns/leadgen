import path from "node:path";
import fs from "node:fs";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { env } from "@/server/config";

/**
 * D19 — one Postgres schema, two drivers:
 *  · DATABASE_URL set  → node-postgres (pg) Pool against the Supabase TRANSACTION
 *    pooler. NOT postgres-js: it wedges permanently when 3+ zero-parameter queries
 *    (count(*) selects compile to exactly that) run concurrently on a shared
 *    connection — reproduced against Supavisor with prepare on AND off. pg checks a
 *    connection out per query and never interleaves, so concurrency is safe.
 *  · otherwise         → PGlite (in-process WASM Postgres) under .data/pg — keyless
 *    local dev, CI, and the Docker volume all keep working with zero accounts
 * Migrations run once at init; racing cold starts on a shared database are
 * resolved by the migrator's idempotence + one delayed retry (advisory locks are
 * unusable through the transaction pooler — session scope doesn't survive it).
 */

export type DB = PgliteDatabase<typeof schema>;

const MIGRATIONS = { migrationsFolder: path.join(process.cwd(), "drizzle") };

type G = typeof globalThis & { __lfDb?: DB; __lfDbInit?: Promise<DB> };
const g = globalThis as G;

async function open(): Promise<DB> {
  const url = env.databaseUrl();
  if (url) {
    const pool = new Pool({
      connectionString: url,
      max: process.env.VERCEL ? 10 : 5, // one Fluid instance serves many concurrent requests
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 15_000,
    });
    // an idle pooled client's connection error (network blip, pooler recycle) emits
    // on the pool — without a listener that's an uncaught exception and the process dies
    pool.on("error", (err) => console.error("[leadforge] idle pg client error:", err.message));
    const db = drizzleNodePg(pool, { schema }) as unknown as DB;
    // NO advisory lock here: session-scoped locks are unusable through the Supabase
    // TRANSACTION pooler — lock and unlock land on different pooled server
    // connections, the lock never releases, and every later cold start hangs on it.
    // Racing cold starts are instead handled by the migrator's own idempotence:
    // the loser errors on the winner's DDL, waits, and retries against the now-
    // recorded migration hashes.
    try {
      await migrateNodePg(db as never, MIGRATIONS);
    } catch {
      await new Promise((r) => setTimeout(r, 2500));
      await migrateNodePg(db as never, MIGRATIONS);
    }
    return db;
  }
  const dir = env.pgliteDir();
  fs.mkdirSync(dir, { recursive: true });
  const pglite = new PGlite(dir);
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, MIGRATIONS);
  // Flush freshly-created (still-empty) relation files to the FS backend NOW: without
  // this, a read of an untouched table can 58P01 ("could not open file") if heavy
  // first writes to other tables land before the first automatic checkpoint.
  await pglite.exec("CHECKPOINT");
  return db;
}

export async function initDb(): Promise<DB> {
  if (g.__lfDb) return g.__lfDb;
  if (!g.__lfDbInit) {
    // clear the cached promise on rejection — otherwise one transient connect
    // failure at cold start poisons the warm instance for its entire lifetime
    g.__lfDbInit = open().catch((err) => {
      g.__lfDbInit = undefined;
      throw err;
    });
  }
  g.__lfDb = await g.__lfDbInit;
  return g.__lfDb;
}

/** Synchronous accessor — boot()/tests await initDb() first, so query sites stay tidy. */
export function getDb(): DB {
  if (!g.__lfDb) throw new Error("database not initialized — await initDb() (boot does this before serving)");
  return g.__lfDb;
}

/** Test helper: swap the singleton for an isolated in-memory PGlite database. */
export async function openTestDatabase(): Promise<DB> {
  const pglite = new PGlite(); // in-memory
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, MIGRATIONS);
  g.__lfDb = db;
  g.__lfDbInit = Promise.resolve(db);
  return db;
}

export function isSharedDatabase(): boolean {
  return !!env.databaseUrl();
}

export { schema };
