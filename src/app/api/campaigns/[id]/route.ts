import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { intents } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { campaignSpendUSD } from "@/server/budget";
import { getCampaign } from "@/server/campaigns";
import { attachedCount } from "@/server/pipeline/run";

export const GET = withAuth(async (_req, _identity, ctx) => {
  const { id } = await ctx.params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return Response.json({ error: "not found" }, { status: 404 });
  const campaign = await getCampaign(campaignId);
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });
  const [stalledIntents, leadCount, spendUSD] = await Promise.all([
    // filtered + bounded in SQL — the detail page polls this while running
    getDb().select().from(intents).where(and(eq(intents.campaignId, campaign.id), eq(intents.status, "stalled"))).limit(50),
    attachedCount(campaign.id),
    campaignSpendUSD(campaign.id),
  ]);
  return Response.json({ campaign, leadCount, spendUSD, stalledIntents });
});
