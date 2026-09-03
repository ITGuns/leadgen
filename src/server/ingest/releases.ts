import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { releases } from "@/db/schema";
import { now } from "../config";

export function ensureReleaseRow(source: "overture" | "fsq", releaseId: string, states: string[]) {
  const db = getDb();
  const existing = db
    .select()
    .from(releases)
    .where(and(eq(releases.source, source), eq(releases.releaseId, releaseId)))
    .get();
  if (existing) {
    if (existing.status === "failed") {
      db.update(releases).set({ status: "pending", error: null }).where(eq(releases.id, existing.id)).run();
    }
    return existing;
  }
  return db
    .insert(releases)
    .values({ source, releaseId, states, startedAt: now().toISOString() })
    .returning()
    .get();
}

export function activeRelease(source: "overture" | "fsq") {
  return getDb()
    .select()
    .from(releases)
    .where(and(eq(releases.source, source), eq(releases.status, "active")))
    .orderBy(desc(releases.id))
    .get();
}

export function activateRelease(source: "overture" | "fsq", id: number, gateReport?: unknown): void {
  const db = getDb();
  db.transaction(() => {
    const current = activeRelease(source);
    if (current && current.id !== id) {
      db.update(releases).set({ status: "previous" }).where(eq(releases.id, current.id)).run();
    }
    db.update(releases)
      .set({ status: "active", gateReport: gateReport ?? null, finishedAt: now().toISOString() })
      .where(eq(releases.id, id))
      .run();
  });
}

export function failRelease(id: number, gateReport: unknown): void {
  getDb()
    .update(releases)
    .set({ status: "failed", gateReport, error: "ingest gate failed", finishedAt: now().toISOString() })
    .where(eq(releases.id, id))
    .run();
}

export function previousRelease(source: "overture" | "fsq") {
  return getDb()
    .select()
    .from(releases)
    .where(and(eq(releases.source, source), eq(releases.status, "previous")))
    .orderBy(desc(releases.id))
    .get();
}
