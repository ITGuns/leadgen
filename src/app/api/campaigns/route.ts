import { withAuth } from "@/server/auth";
import { CampaignInputSchema, createCampaign, listCampaigns } from "@/server/campaigns";

export const GET = withAuth(async () => {
  return Response.json({ campaigns: listCampaigns() });
});

export const POST = withAuth(async (req, identity) => {
  const body = CampaignInputSchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const campaign = createCampaign(body.data, identity.email);
  return Response.json({ campaign }, { status: 201 });
});
