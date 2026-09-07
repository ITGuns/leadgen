import { withAuth } from "@/server/auth";
import { cancelCampaign, getCampaign, pauseCampaign, resumeCampaign, retryErrors, startCampaign } from "@/server/campaigns";
import { kickJobsAfterResponse } from "@/server/jobs/kick";

export const POST = withAuth(async (req, identity, ctx) => {
  const { id } = await ctx.params;
  const campaignId = Number(id);
  if (!(await getCampaign(campaignId))) return Response.json({ error: "not found" }, { status: 404 });
  const { action } = (await req.json()) as { action?: string };
  switch (action) {
    case "run": {
      const campaign = await startCampaign(campaignId, identity.email);
      kickJobsAfterResponse();
      return Response.json({ campaign });
    }
    case "pause":
      await pauseCampaign(campaignId, identity.email);
      return Response.json({ ok: true });
    case "resume":
      await resumeCampaign(campaignId, identity.email);
      kickJobsAfterResponse();
      return Response.json({ ok: true });
    case "cancel":
      await cancelCampaign(campaignId, identity.email);
      return Response.json({ ok: true });
    case "retry_errors": {
      const result = await retryErrors(campaignId, identity.email);
      kickJobsAfterResponse();
      return Response.json({ ok: true, ...result });
    }
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
});
