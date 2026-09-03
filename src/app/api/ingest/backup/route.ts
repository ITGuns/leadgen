import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/worker";

export const POST = withAuth(async (_req, identity) => {
  const job = enqueueJob("backup", {}, { dedupe: true });
  audit(identity.email, "backup.manual", { jobId: job.id });
  return Response.json({ job }, { status: 202 });
});
