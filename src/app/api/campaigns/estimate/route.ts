import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, type campaigns } from "@/db/schema";
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
  const [estimate, availableStates, topUp, ai] = await Promise.all([
    estimateCampaign(pseudo),
    // which states actually hold data — the builder disables Run + explains when a
    // selected state has nothing loaded (0-record campaigns confused operators)
    getDb()
      .select({ region: sql<string>`region`, n: sql<number>`count(*)::int` })
      .from(businesses)
      .groupBy(sql`region`),
    topUpAvailable(),
    aiAvailable(),
  ]);
  return Response.json({
    estimate,
    availableStates: availableStates.filter((s) => s.region),
    topUpAvailable: topUp,
    aiAvailable: ai,
    aiRateUSD: (await getAIProvider()).costPerOwnerCallUSD,
    fitsCap: estimate.totalUSD <= body.data.caps.budgetCapUSD,
  });
});
