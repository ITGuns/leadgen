/**
 * Emits fixtures/golden/score.json — G4 golden set. Expected bands come from the
 * CONTRACTS C8 SPEC, not from running the engine (no self-fulfilling goldens).
 * Regenerate only when the band spec itself changes: npm run golden:score
 */
import fs from "node:fs";
import path from "node:path";

type Case = {
  desc: string;
  input: {
    websiteClass: string;
    mobileScore?: number | null;
    check?: {
      builder?: string | null;
      ssl?: boolean;
      copyrightYear?: number | null;
      hasViewportMeta?: boolean;
      hasContactForm?: boolean;
      ok: boolean;
      fetchedAt: string;
    } | null;
  };
  band: [number, number];
};

const AT = "2026-09-03T12:00:00.000Z";
const cases: Case[] = [];
const check = (over: Partial<NonNullable<Case["input"]["check"]>>) => ({
  ok: true,
  ssl: true,
  builder: "custom",
  copyrightYear: 2024,
  hasViewportMeta: true,
  hasContactForm: true,
  fetchedAt: AT,
  ...over,
});

// ---- no-real-website bases ⇒ ≥90 (spec: "no website → 95" family) ----
for (const [cls, desc] of [
  ["none", "no website at all"], ["none", "no website, phone only"],
  ["dead", "DNS-dead host"], ["dead", "connection-refused host"],
  ["parked", "GoDaddy parked page"], ["parked", "domain-for-sale lander"],
  ["aggregator", "Yelp listing as only site"], ["aggregator", "HomeAdvisor profile as site"],
  ["aggregator", "Angi company page as site"], ["dead", "shortener resolving to dead host"],
  ["parked", "sedo parking lander"],
] as const) {
  cases.push({ desc, input: { websiteClass: cls, check: null, mobileScore: null }, band: [90, 100] });
}
// ---- social-only ⇒ 80–89 ----
for (const desc of ["Facebook page only", "Instagram only", "Linktree only", "site redirects to Facebook"]) {
  cases.push({ desc: `social_only: ${desc}`, input: { websiteClass: "social_only", check: null, mobileScore: null }, band: [80, 89] });
}
// ---- builder + poor mobile ⇒ 60–80 ----
const builders = ["wix", "godaddy", "weebly", "wordpress", "duda"];
for (const b of builders) {
  for (const mobile of [15, 25, 35, 45]) {
    cases.push({
      desc: `${b} site, mobile ${mobile}, dated`,
      input: {
        websiteClass: "real_site",
        mobileScore: mobile,
        check: check({ builder: b, copyrightYear: 2018, hasViewportMeta: mobile > 30, hasContactForm: mobile > 25, ssl: mobile > 20 }),
      },
      band: [60, 80],
    });
  }
}
// worst-case pile-on stays inside the band ceiling
cases.push({
  desc: "wix, mobile 12, no ssl, © 2015, no viewport, no form (worst real site)",
  input: { websiteClass: "real_site", mobileScore: 12, check: check({ builder: "wix", ssl: false, copyrightYear: 2015, hasViewportMeta: false, hasContactForm: false }) },
  band: [60, 80],
});
cases.push({
  desc: "godaddy, mobile 29, no form",
  input: { websiteClass: "real_site", mobileScore: 29, check: check({ builder: "godaddy", hasContactForm: false, copyrightYear: 2019 }) },
  band: [60, 80],
});
cases.push({
  desc: "weebly, mobile 44, no viewport",
  input: { websiteClass: "real_site", mobileScore: 44, check: check({ builder: "weebly", hasViewportMeta: false, copyrightYear: 2020 }) },
  band: [60, 80],
});
// ---- decent sites ⇒ 20–40 ----
for (const mobile of [50, 55, 60, 65, 70, 75]) {
  cases.push({
    desc: `custom site, mobile ${mobile}, current`,
    input: { websiteClass: "real_site", mobileScore: mobile, check: check({ copyrightYear: 2024 }) },
    band: [20, 40],
  });
}
cases.push({ desc: "custom, mobile 62, no contact form", input: { websiteClass: "real_site", mobileScore: 62, check: check({ hasContactForm: false }) }, band: [20, 40] });
cases.push({ desc: "custom, mobile 58, older copyright", input: { websiteClass: "real_site", mobileScore: 58, check: check({ copyrightYear: 2022 }) }, band: [20, 40] });
cases.push({ desc: "custom, mobile 71, no ssl", input: { websiteClass: "real_site", mobileScore: 71, check: check({ ssl: false }) }, band: [20, 40] });
cases.push({ desc: "custom, mobile 55, © 2021 + no form", input: { websiteClass: "real_site", mobileScore: 55, check: check({ copyrightYear: 2021, hasContactForm: false }) }, band: [20, 41] });
cases.push({ desc: "custom, pagespeed unavailable, current", input: { websiteClass: "real_site", mobileScore: null, check: check({}) }, band: [20, 45] });
cases.push({ desc: "custom, pagespeed unavailable, no form", input: { websiteClass: "real_site", mobileScore: null, check: check({ hasContactForm: false }) }, band: [20, 45] });
// ---- strong sites ⇒ <20 ----
for (const [mobile, year] of [[82, 2026], [86, 2025], [90, 2026], [95, 2026], [88, 2026], [93, 2025], [84, 2026], [97, 2026]] as const) {
  cases.push({
    desc: `strong custom site, mobile ${mobile}, © ${year}`,
    input: { websiteClass: "real_site", mobileScore: mobile, check: check({ copyrightYear: year }) },
    band: [0, 19],
  });
}
// ---- builder with good mobile: mid-band, better than poor-mobile builders, worse than strong customs ----
for (const [b, mobile] of [["squarespace", 82], ["squarespace", 74], ["shopify", 85], ["wordpress", 78]] as const) {
  cases.push({
    desc: `${b} site, decent mobile ${mobile}`,
    input: { websiteClass: "real_site", mobileScore: mobile, check: check({ builder: b, copyrightYear: 2025 }) },
    band: [30, 55],
  });
}

const out = path.join(process.cwd(), "fixtures", "golden");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "score.json"), JSON.stringify({ frozenClock: AT, cases }, null, 1));
console.log(`wrote ${cases.length} score golden cases`);
if (cases.length < 60) {
  console.error("SPEC VIOLATION: golden set must have 60+ fixtures");
  process.exit(1);
}
