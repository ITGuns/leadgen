import { withAuth } from "@/server/auth";
import { cancelCampaign, getCampaign, pauseCampaign, resumeCampaign, startCampaign } from "@/server/campaigns";

export const POST = withAuth(async (req, identity, ctx) => {
  const { id } = await ctx.params;
  const campaignId = Number(id);
  if (!getCampaign(campaignId)) return Response.json({ error: "not found" }, { status: 404 });
  const { action } = (await req.json()) as { action?: string };
  switch (action) {
    case "run":
      return Response.json({ campaign: startCampaign(campaignId, identity.email) });
    case "pause":
      pauseCampaign(campaignId, identity.email);
      return Response.json({ ok: true });
    case "resume":
      resumeCampaign(campaignId, identity.email);
      return Response.json({ ok: true });
    case "cancel":
      cancelCampaign(campaignId, identity.email);
      return Response.json({ ok: true });
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
});
