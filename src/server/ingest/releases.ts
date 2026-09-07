import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { releases } from "@/db/schema";
import { now } from "../config";

export async function ensureReleaseRow(source: "overture" | "fsq", releaseId: string, states: string[]) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(releases)
    .where(and(eq(releases.source, source), eq(releases.releaseId, releaseId)))
    .limit(1);
  if (existing) {
    if (existing.status === "failed") {
      await db.update(releases).set({ status: "pending", error: null }).where(eq(releases.id, existing.id));
    }
    return existing;
  }
  const [row] = await db
    .insert(releases)
    .values({ source, releaseId, states, startedAt: now().toISOString() })
    .returning();
  return row;
}

export async function activeRelease(source: "overture" | "fsq") {
  const [row] = await getDb()
    .select()
    .from(releases)
    .where(and(eq(releases.source, source), eq(releases.status, "active")))
    .orderBy(desc(releases.id))
    .limit(1);
  return row;
}

export async function activateRelease(source: "overture" | "fsq", id: number, gateReport?: unknown): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(releases)
      .where(and(eq(releases.source, source), eq(releases.status, "active")))
      .orderBy(desc(releases.id))
      .limit(1);
    if (current && current.id !== id) {
      await tx.update(releases).set({ status: "previous" }).where(eq(releases.id, current.id));
    }
    await tx
      .update(releases)
      .set({ status: "active", gateReport: gateReport ?? null, finishedAt: now().toISOString() })
      .where(eq(releases.id, id));
  });
}

export async function failRelease(id: number, gateReport: unknown): Promise<void> {
  await getDb()
    .update(releases)
    .set({ status: "failed", gateReport, error: "ingest gate failed", finishedAt: now().toISOString() })
    .where(eq(releases.id, id));
}

export async function previousRelease(source: "overture" | "fsq") {
  const [row] = await getDb()
    .select()
    .from(releases)
    .where(and(eq(releases.source, source), eq(releases.status, "previous")))
    .orderBy(desc(releases.id))
    .limit(1);
  return row;
}
