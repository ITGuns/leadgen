import path from "node:path";
import fs from "node:fs";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { env } from "@/server/config";

/**
 * D19 — one Postgres schema, two drivers:
 *  · DATABASE_URL set  → postgres-js against Supabase (use the transaction pooler URL;
 *    prepared statements disabled for pooler compatibility, small pool for serverless)
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
    const client = postgres(url, {
      prepare: false, // Supabase transaction pooler compatibility
      max: process.env.VERCEL ? 1 : 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
    const db = drizzlePostgres(client, { schema }) as unknown as DB;
    // NO advisory lock here: session-scoped locks are unusable through the Supabase
    // TRANSACTION pooler — lock and unlock land on different pooled server
    // connections, the lock never releases, and every later cold start hangs on it.
    // Racing cold starts are instead handled by the migrator's own idempotence:
    // the loser errors on the winner's DDL, waits, and retries against the now-
    // recorded migration hashes.
    try {
      await migratePostgres(db as never, MIGRATIONS);
    } catch {
      await new Promise((r) => setTimeout(r, 2500));
      await migratePostgres(db as never, MIGRATIONS);
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
  if (!g.__lfDbInit) g.__lfDbInit = open();
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
