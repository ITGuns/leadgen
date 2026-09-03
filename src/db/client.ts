import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";
import { env } from "@/server/config";

export type DB = BetterSQLite3Database<typeof schema>;

/** Open a database at `file`, apply pragmas + migrations. Used by the app singleton and by tests. */
export function openDatabase(file: string): { db: DB; sqlite: Database.Database } {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, sqlite };
}

type G = typeof globalThis & { __leadforgeDb?: { db: DB; sqlite: Database.Database } };
const g = globalThis as G;

export function getDb(): DB {
  if (!g.__leadforgeDb) g.__leadforgeDb = openDatabase(env.databasePath());
  return g.__leadforgeDb.db;
}
export function getSqlite(): Database.Database {
  getDb();
  return g.__leadforgeDb!.sqlite;
}

/** Test helper: swap the singleton for an isolated in-memory database. */
export function useTestDatabase(): { db: DB; sqlite: Database.Database } {
  const opened = openDatabase(":memory:");
  g.__leadforgeDb = opened;
  return opened;
}

export { schema };
