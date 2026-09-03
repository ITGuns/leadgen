import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { WebsiteCheck } from "@/db/schema";
import type { WebsiteClass } from "@/server/classify";
import { computeScore } from "@/server/scoring/score";

/** G4 — 60+ fixture sites → expected score band. Rubric changes must keep this green. */

type GoldenCase = {
  desc: string;
  input: { websiteClass: WebsiteClass; mobileScore?: number | null; check?: WebsiteCheck | null };
  band: [number, number];
};
const golden = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "fixtures", "golden", "score.json"), "utf8"),
) as { cases: GoldenCase[] };

describe("G4 · score rubric golden set", () => {
  it("has 60+ cases", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(60);
  });

  for (const c of golden.cases) {
    it(`${c.desc} → [${c.band[0]}, ${c.band[1]}]`, () => {
      const { score, reasons } = computeScore(c.input);
      expect(score, `reasons: ${reasons.map((r) => r.chip).join(" · ")}`).toBeGreaterThanOrEqual(c.band[0]);
      expect(score, `reasons: ${reasons.map((r) => r.chip).join(" · ")}`).toBeLessThanOrEqual(c.band[1]);
      expect(reasons.length).toBeGreaterThan(0); // every score explains itself with chips
    });
  }

  it("ordering invariants: no-site > social-only > worst real > decent > strong", () => {
    const at = "2026-09-03T12:00:00.000Z";
    const none = computeScore({ websiteClass: "none" }).score;
    const social = computeScore({ websiteClass: "social_only" }).score;
    const worstReal = computeScore({
      websiteClass: "real_site",
      mobileScore: 10,
      check: { ok: true, ssl: false, builder: "wix", copyrightYear: 2015, hasViewportMeta: false, hasContactForm: false, fetchedAt: at },
    }).score;
    const decent = computeScore({
      websiteClass: "real_site",
      mobileScore: 65,
      check: { ok: true, ssl: true, builder: "custom", copyrightYear: 2024, hasViewportMeta: true, hasContactForm: true, fetchedAt: at },
    }).score;
    const strong = computeScore({
      websiteClass: "real_site",
      mobileScore: 93,
      check: { ok: true, ssl: true, builder: "custom", copyrightYear: 2026, hasViewportMeta: true, hasContactForm: true, fetchedAt: at },
    }).score;
    expect(none).toBeGreaterThan(social);
    expect(social).toBeGreaterThan(worstReal);
    expect(worstReal).toBeGreaterThan(decent);
    expect(decent).toBeGreaterThan(strong);
  });

  it("chips carry filled-in details", () => {
    const { reasons } = computeScore({
      websiteClass: "real_site",
      mobileScore: 31,
      check: { ok: true, ssl: true, builder: "godaddy", copyrightYear: 2016, hasViewportMeta: true, hasContactForm: true, fetchedAt: "2026-09-03T12:00:00.000Z" },
    });
    const chips = reasons.map((r) => r.chip);
    expect(chips).toContain("Built on godaddy");
    expect(chips).toContain("Mobile score 31");
    expect(chips).toContain("© 2016");
  });
});
