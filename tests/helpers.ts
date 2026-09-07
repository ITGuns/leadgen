import { openTestDatabase, type DB } from "@/db/client";

/** In-memory PGlite database, migrated and registered as the active DB for the suite. */
export async function freshDb(): Promise<{ db: DB }> {
  const db = await openTestDatabase();
  return { db };
}
