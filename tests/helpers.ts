import { openTestDatabase, type DB } from "@/db/client";
import type Database from "better-sqlite3";

export function freshDb(): { db: DB; sqlite: Database.Database } {
  return openTestDatabase();
}
