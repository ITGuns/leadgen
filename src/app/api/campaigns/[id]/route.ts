import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { intents } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { campaignSpendUSD } from "@/server/budget";
import { getCampaign } from "@/server/campaigns";
import { attachedCount } from "@/server/pipeline/run";

export const GET = withAuth(async (_req, _identity, ctx) => {
  const { id } = await ctx.params;
  const campaign = await getCampaign(Number(id));
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });
  const [rows, leadCount, spendUSD] = await Promise.all([
    getDb().select().from(intents).where(eq(intents.campaignId, campaign.id)),
    attachedCount(campaign.id),
    campaignSpendUSD(campaign.id),
  ]);
  return Response.json({
    campaign,
    leadCount,
    spendUSD,
    stalledIntents: rows.filter((i) => i.status === "stalled"),
  });
});
