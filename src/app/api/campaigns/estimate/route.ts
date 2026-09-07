import type { campaigns } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { CampaignInputSchema } from "@/server/campaigns";
import { estimateCampaign } from "@/server/pipeline/estimate";
import { topUpAvailable } from "@/server/providers/listings";
import { aiAvailable, getAIProvider } from "@/server/providers/ai";

/** Live cost estimate for the builder — Run stays disabled until it fits the cap (§3.1). */
export const POST = withAuth(async (req) => {
  const body = CampaignInputSchema.omit({ name: true }).extend({ name: CampaignInputSchema.shape.name.optional() }).safeParse(
    await req.json(),
  );
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const pseudo = {
    ...body.data,
    id: 0,
    name: body.data.name ?? "estimate",
    cityList: body.data.cityList ?? null,
    topUp: body.data.topUp ?? null,
  } as unknown as typeof campaigns.$inferSelect;
  const estimate = await estimateCampaign(pseudo);
  return Response.json({
    estimate,
    topUpAvailable: await topUpAvailable(),
    aiAvailable: await aiAvailable(),
    aiRateUSD: (await getAIProvider()).costPerOwnerCallUSD,
    fitsCap: estimate.totalUSD <= body.data.caps.budgetCapUSD,
  });
});
