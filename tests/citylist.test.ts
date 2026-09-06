import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { createCampaign, defaultFilters, type CampaignInput } from "@/server/campaigns";
import { estimateCampaign } from "@/server/pipeline/estimate";
import { fanOutCities } from "@/server/pipeline/fanout";

/** §3.1 — "optional city/ZIP list upload for precision": city names and 5-digit ZIPs
 * both narrow the free local pull; ZIPs are ignored by the paid fan-out (city-keyed). */

function input(cityList: string[] | null): CampaignInput {
  return {
    name: "geo precision", niche: "plumbers", confirmedTaxonomy: ["plumber", "electrician", "hvac_service"],
    states: ["TX"], cityList, filters: { ...defaultFilters(), excludeChains: false },
    caps: { maxRecords: 5000, budgetCapUSD: 0 }, smoke: false, aiOwnerExtraction: false, topUp: null,
  };
}

describe("city/ZIP list precision", () => {
  let all: number;
  beforeAll(async () => {
    freshDb();
    registerAllHandlers();
    enqueueJob("ingest_overture", { states: ["TX"], chain: true }, { maxAttempts: 1 });
    await new Worker(1, 10).drain(120_000);
    all = estimateCampaign(createCampaign(input(null), "t@g.com")).plannedRecords;
    expect(all).toBeGreaterThan(30);
  }, 180_000);

  it("city names narrow the pull", () => {
    const austin = estimateCampaign(createCampaign(input(["Austin"]), "t@g.com")).plannedRecords;
    expect(austin).toBeGreaterThan(0);
    expect(austin).toBeLessThan(all);
  });

  it("5-digit ZIPs match postal codes — same universe as the city they belong to (fixture: Austin=78701)", () => {
    const byCity = estimateCampaign(createCampaign(input(["austin"]), "t@g.com")).plannedRecords;
    const byZip = estimateCampaign(createCampaign(input(["78701"]), "t@g.com")).plannedRecords;
    expect(byZip).toBe(byCity);
  });

  it("mixed lists OR together", () => {
    const austin = estimateCampaign(createCampaign(input(["Austin"]), "t@g.com")).plannedRecords;
    const dallas = estimateCampaign(createCampaign(input(["Dallas"]), "t@g.com")).plannedRecords;
    const mixed = estimateCampaign(createCampaign(input(["78701", "Dallas"]), "t@g.com")).plannedRecords;
    expect(mixed).toBe(austin + dallas); // fixture cities are disjoint
  });

  it("fan-out uses city-name entries only and never zeroes out on ZIP-only lists", () => {
    const named = fanOutCities(["TX"], { cityList: ["Austin", "78701"] });
    expect(named.map((c) => c.city)).toEqual(["Austin"]);
    const zipOnly = fanOutCities(["TX"], { cityList: ["78701"] });
    expect(zipOnly.length).toBeGreaterThan(1); // falls back to the full state fan-out
  });
});
