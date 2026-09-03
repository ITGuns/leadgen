import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { confirmTaxonomy, proposeTaxonomy, taxonomyCatalog } from "@/server/ingest/taxonomy";

/** G2 — 30 niche phrases → expected taxonomy sets. Phrases deliberately include
 * variants NOT verbatim in the curated file, exercising normalization + folding + fuzzy. */

const GOLDEN: { phrase: string; mustInclude: string[]; mustExclude?: string[] }[] = [
  { phrase: "roofers", mustInclude: ["roofing_contractor"] },
  { phrase: "Roofing!", mustInclude: ["roofing_contractor"] },
  { phrase: "roof repair", mustInclude: ["roofing_contractor"], mustExclude: ["roofing_supply_store"] },
  { phrase: "HVAC", mustInclude: ["hvac_service"] },
  { phrase: "heating and cooling", mustInclude: ["hvac_service", "heating_contractor"] },
  { phrase: "AC repair", mustInclude: ["air_conditioning_contractor"] },
  { phrase: "plumbers", mustInclude: ["plumber"] },
  { phrase: "plumber", mustInclude: ["plumber"] },
  { phrase: "septic pumping", mustInclude: ["septic_system_service"] },
  { phrase: "electricians", mustInclude: ["electrician"] },
  { phrase: "electrician", mustInclude: ["electrician"] },
  { phrase: "landscapers", mustInclude: ["landscaping_service"] },
  { phrase: "lawn care", mustInclude: ["lawn_care_service"] },
  { phrase: "tree removal", mustInclude: ["tree_service"] },
  { phrase: "pest control", mustInclude: ["pest_control_service"] },
  { phrase: "exterminators", mustInclude: ["pest_control_service"] },
  { phrase: "pressure washing", mustInclude: ["pressure_washing_service"] },
  { phrase: "house cleaning", mustInclude: ["house_cleaning_service"] },
  { phrase: "carpet cleaning", mustInclude: ["carpet_cleaning_service"] },
  { phrase: "junk removal", mustInclude: ["junk_removal_service"] },
  { phrase: "movers", mustInclude: ["moving_company"] },
  { phrase: "moving company", mustInclude: ["moving_company"] },
  { phrase: "locksmiths", mustInclude: ["locksmith"] },
  { phrase: "garage door repair", mustInclude: ["garage_door_service"] },
  { phrase: "fence companies", mustInclude: ["fence_contractor"] },
  { phrase: "painters", mustInclude: ["painting_contractor"] },
  { phrase: "general contractors", mustInclude: ["general_contractor"] },
  { phrase: "handyman services", mustInclude: ["handyman_service"] },
  { phrase: "PI lawyer", mustInclude: ["personal_injury_lawyer"] },
  { phrase: "personal injury lawyers", mustInclude: ["personal_injury_lawyer"] },
  { phrase: "dentists", mustInclude: ["dentist"] },
  { phrase: "auto repair shops", mustInclude: ["auto_repair_shop"] },
];

describe("G2 · taxonomy mapping golden set (30+)", () => {
  beforeAll(() => freshDb());

  it("has 30+ phrases", () => expect(GOLDEN.length).toBeGreaterThanOrEqual(30));

  for (const g of GOLDEN) {
    it(`"${g.phrase}"`, () => {
      const proposal = proposeTaxonomy(g.phrase);
      for (const code of g.mustInclude) {
        expect(proposal.codes, `source=${proposal.source} codes=${proposal.codes.join(",")}`).toContain(code);
      }
      for (const code of g.mustExclude ?? []) {
        expect(proposal.codes).not.toContain(code);
      }
      // every proposed code resolves against the bundled catalog
      for (const code of proposal.codes) expect(taxonomyCatalog().has(code)).toBe(true);
    });
  }

  it("confirmed mappings auto-apply on later runs (§3.1)", () => {
    expect(proposeTaxonomy("roofers").autoApply).toBe(false);
    confirmTaxonomy("roofers", ["roofing_contractor", "roofing_service"], "dev@gemfieldconsulting.com");
    const again = proposeTaxonomy("Roofers");
    expect(again.autoApply).toBe(true);
    expect(again.source).toBe("confirmed");
    expect(again.codes).toEqual(["roofing_contractor", "roofing_service"]);
  });
});
