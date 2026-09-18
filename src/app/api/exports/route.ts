import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { exportsTable, jobs, type ExportParams } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { createExport } from "@/server/exports/run";
import { kickJobsAfterResponse } from "@/server/jobs/kick";
import { EXPORT_COLUMNS, DEFAULT_COLUMNS } from "@/server/exports/columns";

/** Reconcile orphans: an export whose job died outside the handler (e.g. worker
 * restarted before the handler existed) must not sit at 'pending' forever. */
async function reconcileOrphans(): Promise<void> {
  const db = getDb();
  const stuck = await db
    .select({ id: exportsTable.id, createdAt: exportsTable.createdAt })
    .from(exportsTable)
    .where(or(eq(exportsTable.status, "pending"), eq(exportsTable.status, "running")));
  if (!stuck.length) return; // the common case — this endpoint is polled
  // ONE query for all live export jobs, not one count per stuck row
  const liveJobs = await db
    .select({ exportId: sql<number>`(${jobs.payload} ->> 'exportId')::int` })
    .from(jobs)
    .where(and(eq(jobs.type, "export"), inArray(jobs.status, ["pending", "running"])));
  const live = new Set(liveJobs.map((j) => j.exportId));
  const cutoff = Date.now() - 30_000;
  const dead = stuck.filter((e) => !live.has(e.id) && new Date(e.createdAt).getTime() < cutoff).map((e) => e.id);
  if (dead.length) {
    await db
      .update(exportsTable)
      .set({ status: "failed", error: "export job died — re-create the export", finishedAt: new Date().toISOString() })
      .where(and(inArray(exportsTable.id, dead), inArray(exportsTable.status, ["pending", "running"])));
  }
}

export const GET = withAuth(async () => {
  await reconcileOrphans();
  return Response.json({
    exports: await getDb().select().from(exportsTable).orderBy(desc(exportsTable.id)).limit(50),
    availableColumns: EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header })),
    defaultColumns: DEFAULT_COLUMNS,
  });
});

export const POST = withAuth(async (req, identity) => {
  const body = (await req.json()) as {
    format?: "xlsx" | "csv";
    campaignId?: number;
    leadIds?: number[];
    columns?: string[];
    includeExcluded?: boolean;
    toDrive?: boolean;
    driveSubfolder?: string;
    filters?: Record<string, unknown>;
  };
  if (body.format !== "xlsx" && body.format !== "csv") return Response.json({ error: "format must be xlsx or csv" }, { status: 400 });
  const params: ExportParams = {
    campaignId: body.campaignId,
    leadIds: body.leadIds,
    columns: body.columns ?? [],
    includeExcluded: !!body.includeExcluded,
    filters: body.filters,
    toDrive: !!body.toDrive,
    driveSubfolder: body.toDrive && body.driveSubfolder?.trim() ? body.driveSubfolder.trim().slice(0, 80) : undefined,
  };
  const record = await createExport(params, body.format, identity.email);
  kickJobsAfterResponse();
  return Response.json({ export: record }, { status: 202 });
});
