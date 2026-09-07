import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, type CampaignEstimate, type campaigns } from "@/db/schema";
import { defaults } from "../config";
import { getAIProvider } from "../providers/ai";
import { candidateConditions } from "./query";
import { fanOutCities } from "./fanout";

/**
 * §1/§3.1 — run cost model, shown before every run and re-verified at plan time:
 * $0 baseline · + sites × ~$0.001 with Haiku on · + records × $0.003 with top-up on.
 * The Run button gates on estimate.totalUSD ≤ caps.budgetCapUSD.
 */

const TOP_UP_PER_QUERY_LIMIT = 50;

export async function estimateCampaign(campaign: typeof campaigns.$inferSelect): Promise<CampaignEstimate> {
  const db = getDb();
  const cond = candidateConditions(campaign);
  const cap = campaign.smoke ? defaults.smokeRecordLimit : campaign.caps.maxRecords;

  const [matchedRow] = await db.select({ n: sql<number>`count(*)::int` }).from(businesses).where(cond);
  const matched = matchedRow?.n ?? 0;
  const plannedRecords = Math.min(matched, cap);

  // AI owner extraction runs only on real-site candidates — count those precisely
  const [withSiteRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businesses)
    .where(sql`${cond} AND ${businesses.websiteClass} IN ('real_site', 'unknown')`);
  const withSite = withSiteRow?.n ?? 0;
  // rate of the provider that will actually run: real Haiku ≈ $0.001/site, mock = $0
  const aiSites = Math.min(withSite, plannedRecords);
  const aiUSD = campaign.aiOwnerExtraction ? round2(aiSites * (await getAIProvider()).costPerOwnerCallUSD) : 0;

  let topUpUSD = 0;
  let citiesFannedOut: number | undefined;
  if (campaign.topUp?.enabled) {
    const cities = await fanOutCities(campaign.states, { cityList: campaign.cityList });
    citiesFannedOut = cities.length;
    const queries = cities.length; // one free-text query per city (§4.1)
    const topUpRecords = Math.min(queries * TOP_UP_PER_QUERY_LIMIT, cap);
    // the run can never spend more than the top-up's own cap — estimate says so
    topUpUSD = round2(Math.min((topUpRecords / 1000) * defaults.outscraperCostPer1k, campaign.topUp.capUSD));
  }

  return {
    plannedRecords,
    baseUSD: 0,
    aiUSD,
    topUpUSD,
    totalUSD: round2(aiUSD + topUpUSD),
    citiesFannedOut,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { TOP_UP_PER_QUERY_LIMIT };
