import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, releases } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/worker";

export const GET = withAuth(async () => {
  const db = getDb();
  return Response.json({
    releases: db.select().from(releases).orderBy(desc(releases.id)).limit(20).all(),
    recentJobs: db.select().from(jobs).orderBy(desc(jobs.id)).limit(25).all(),
  });
});

/** Monthly extract chain: overture → fsq → conflate (§4.0). Manual, release-pinned. */
export const POST = withAuth(async (req, identity) => {
  const { states } = (await req.json().catch(() => ({}))) as { states?: string[] };
  const job = enqueueJob(
    "ingest_overture",
    { states: states?.length ? states.map((s) => s.toUpperCase()) : ["TX", "FL", "GA"], chain: true },
    { dedupe: true, maxAttempts: 1 },
  );
  audit(identity.email, "ingest.run", { states, jobId: job.id });
  return Response.json({ job }, { status: 202 });
});
