/**
 * Emits fixtures/golden/owner.json — G5 golden set (40+ cases incl. must-not-extract
 * traps). Expectations are authored here from the §3.3 rules, never from running the
 * extractor. Regenerate: npm run golden:owner
 */
import fs from "node:fs";
import path from "node:path";

type Case = {
  id: string;
  businessName: string;
  pageUrl: string;
  pageText: string;
  expect: { ownerName: string | null; confidence?: "high" | "low" };
};

const cases: Case[] = [];
let n = 0;
const add = (businessName: string, pageUrl: string, pageText: string, expect: Case["expect"], tag: string) =>
  cases.push({ id: `${String(++n).padStart(2, "0")}-${tag}`, businessName, pageUrl, pageText, expect });

// ---------- positives ----------
add("Jim's Roofing", "https://x.test/about", "Welcome to Jim's Roofing. Jim Baker, Owner, has repaired roofs across Austin since 2001.", { ownerName: "Jim Baker", confidence: "high" }, "comma-owner");
add("Nguyen Plumbing", "https://x.test/about", "About our company. Owner: Maria Nguyen. We fix leaks fast.", { ownerName: "Maria Nguyen", confidence: "high" }, "role-colon");
add("Acme Roofing", "https://x.test/", "Acme Roofing was founded by Dale Ortiz in 2003 and remains family-run.", { ownerName: "Dale Ortiz", confidence: "high" }, "founded-by");
add("Delgado Detailing", "https://x.test/about", "Meet Rosa Delgado — proprietor and lead detailer.", { ownerName: "Rosa Delgado", confidence: "high" }, "em-dash-proprietor");
add("Hank's Plumbing", "https://x.test/", "Hank Miller is the owner of Hank's Plumbing and answers every call himself.", { ownerName: "Hank Miller", confidence: "high" }, "is-the-owner");
add("Hayes Electric", "https://x.test/team", "As principal, Tina Hayes oversees every job Hayes Electric takes on.", { ownerName: "Tina Hayes", confidence: "high" }, "principal");
add("Trujillo Concrete", "https://x.test/about", "Trujillo Concrete is owned and operated by Carlos Trujillo.", { ownerName: "Carlos Trujillo", confidence: "high" }, "owned-operated");
add("The Fix Shop", "https://x.test/about", "Peggy Kowalski, co-owner, started The Fix Shop out of her garage.", { ownerName: "Peggy Kowalski", confidence: "high" }, "co-owner");
add("Ferris Towing", "https://x.test/about", "Walt Ferris — Owner-Operator. Available 24/7 for Ferris Towing calls.", { ownerName: "Walt Ferris", confidence: "high" }, "owner-operator");
add("Yoder Bakery", "https://x.test/our-story", "June Yoder, founder, still bakes every morning at Yoder Bakery.", { ownerName: "June Yoder", confidence: "high" }, "founder-comma");
add("Marsh Movers", "https://x.test/about", "Ray T. Marsh, Owner, personally leads every Marsh Movers crew.", { ownerName: "Ray T. Marsh", confidence: "high" }, "middle-initial");
add("O'Leary Cleaning", "https://x.test/about", "Dot O'Leary, Owner, founded O'Leary Cleaning with one vacuum and a bus pass.", { ownerName: "Dot O'Leary", confidence: "high" }, "apostrophe-name");
add("Sunrise HVAC", "https://x.test/about", "Our story. Gus Delgado, Owner. Sunrise HVAC serves the metro area.", { ownerName: "Gus Delgado", confidence: "high" }, "about-page-tie");
add(
  "Lone Star Pest", "https://x.test/about",
  "Lone Star Pest — Bud Pruett, Owner. Now with 12 locations across Texas, Oklahoma, and Louisiana.",
  { ownerName: "Bud Pruett", confidence: "low" }, "multi-location-low",
);
add(
  "Blue Sky Pools", "https://x.test/about",
  "Serving Austin, Dallas, and Houston with pool care. Ida Okafor, Owner, leads Blue Sky Pools.",
  { ownerName: "Ida Okafor", confidence: "low" }, "serving-cities-low",
);
add(
  "Bennett Lawn Care", "https://x.test/",
  "Bennett Lawn Care has mowed the east side for twenty years. Every estimate is free and every crew is insured, because that is how a neighborhood company should run. Lena Bennett-Cruz, Owner, walks each property herself before quoting.",
  { ownerName: "Lena Bennett-Cruz", confidence: "high" }, "long-text-window",
);

// ---------- must-not-extract traps ----------
add("Smith Roofing", "https://x.test/", '"Great work on our roof!" — John Smith, Google review ★★★★★', { ownerName: null }, "trap-reviewer");
add("Rapid Rooter", "https://x.test/about", "Sandra Pickens says: five stars, highly recommend Rapid Rooter to everyone!", { ownerName: null }, "trap-reviewer-2");
add("Local Handyman Co", "https://x.test/", '"The owner Frank Wells was fantastic" — review left by a Yelp customer.', { ownerName: null }, "trap-owner-in-review");
add("Aire Serv of Waco", "https://x.test/about", "Aire Serv is a proud franchise. Neighborly franchise CEO Mike Bidwell congratulated local teams this year.", { ownerName: null }, "trap-franchise-ceo");
add("Budget Fencing", "https://x.test/about", "MegaFence is a national franchise network. MegaFence founder Bill Grand opened the 500th franchise location in 2024.", { ownerName: null }, "trap-franchise-founder");
add("Pecan Cafe", "https://x.test/", "Website designed by Chad Malone Creative. All rights reserved.", { ownerName: null }, "trap-designer-credit");
add("Heritage Painting", "https://x.test/", "Site built by Jane Doe Design Co — powered by Squarespace.", { ownerName: null }, "trap-built-by");
add("Elite Movers", "https://x.test/team", "Our team: Bob Jones, Alice Ray, Sam Hill, and six licensed movers ready to help.", { ownerName: null }, "trap-roster-no-role");
add("Ortega Logistics", "https://x.test/about", "Frank Ortega, CEO, joined in 2019 after a decade in freight.", { ownerName: null }, "trap-ceo-only");
add("May Consulting", "https://x.test/about", "Linda May, President, speaks regularly at industry events.", { ownerName: null }, "trap-president-only");
add("Acme Roofing", "https://x.test/", "Acme Roofing, owner of the best reputation in town, serves three counties.", { ownerName: null }, "trap-bizname-as-name");
add("Empty Site LLC", "https://x.test/", "", { ownerName: null }, "trap-empty");
add("Plain Brochure Co", "https://x.test/", "Quality service since 1998. Call today for a free estimate. Fully insured and bonded.", { ownerName: null }, "trap-no-names");
add("Marsh Movers", "https://x.test/", "Voted best movers by Gazette readers — Journal Staff, 2025 awards edition.", { ownerName: null }, "trap-award-byline");

// ---------- systematic role × format permutations ----------
const perms: [string, string, (n: string, r: string, b: string) => string][] = [
  ["fmt-comma", "Owner", (nm, r, b) => `${b} quality since 2010. ${nm}, ${r}, treats every customer like family at ${b}.`],
  ["fmt-colon", "Founder", (nm, r, b) => `${b} — about us. ${r}: ${nm}. Licensed and insured.`],
  ["fmt-founded", "Founder", (nm, _r, b) => `${b} was founded by ${nm} after fifteen years in the trade.`],
  ["fmt-is-the", "Proprietor", (nm, r, b) => `${nm} is the ${r.toLowerCase()} of ${b} and a lifelong local.`],
];
const names = ["Omar Reyes", "Faye Whitaker", "Cole Branson", "Nina Petrov"];
const bizzes = ["Reyes Radiators", "Whitaker Wells", "Branson Blinds", "Petrov Paving"];
for (let i = 0; i < 4; i++) {
  for (const [tag, role, fmt] of perms.slice(0, i === 3 ? 4 : 3)) {
    add(bizzes[i], "https://x.test/about", fmt(names[i], role, bizzes[i]), { ownerName: names[i], confidence: "high" }, `${tag}-${role.toLowerCase()}`);
  }
}

const out = path.join(process.cwd(), "fixtures", "golden");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "owner.json"), JSON.stringify({ cases }, null, 1));
console.log(`wrote ${cases.length} owner golden cases (${cases.filter((c) => c.expect.ownerName === null).length} traps)`);
if (cases.length < 40) {
  console.error("SPEC VIOLATION: owner golden set must have 40+ fixtures");
  process.exit(1);
}
