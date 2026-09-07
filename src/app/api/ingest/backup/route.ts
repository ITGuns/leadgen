import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/worker";
import { kickJobsAfterResponse } from "@/server/jobs/kick";

export const POST = withAuth(async (_req, identity) => {
  const job = await enqueueJob("backup", {}, { dedupe: true });
  await audit(identity.email, "backup.manual", { jobId: job.id });
  kickJobsAfterResponse();
  return Response.json({ job }, { status: 202 });
});
