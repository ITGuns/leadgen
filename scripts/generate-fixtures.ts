/**
 * Generates the mock-mode parquet fixtures (§4.7): an Overture-shaped places file
 * (~2k rows, TX/FL/GA, Sept-2026 schema with `taxonomy`, nested names/addresses/bbox)
 * and an FSQ-shaped file (~500 rows) engineered to exercise every conflation path,
 * including the never-merge-differing-phones trap. Deterministic (seeded RNG).
 *
 * Mock websites use `{slug}.lf-{profile}.test` domains; the MockFetcher and
 * MockPageSpeed derive behavior from the profile token (DECISIONS D14).
 *
 * Run: npm run fixtures
 */
import { DuckDBInstance } from "@duckdb/node-api";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "fixtures", "mock");
const TMP = path.join(OUT_DIR, "_tmp");

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;

const STATES: Record<string, { n: number; areas: string[]; cities: { c: string; lat: number; lng: number; zip: string }[] }> = {
  TX: {
    n: 1000,
    areas: ["512", "737", "214", "972", "713", "281", "210", "817"],
    cities: [
      { c: "Austin", lat: 30.3005, lng: -97.7522, zip: "78701" },
      { c: "Dallas", lat: 32.7935, lng: -96.7667, zip: "75201" },
      { c: "Houston", lat: 29.786, lng: -95.3885, zip: "77002" },
      { c: "San Antonio", lat: 29.4632, lng: -98.5238, zip: "78205" },
      { c: "Fort Worth", lat: 32.7817, lng: -97.3474, zip: "76102" },
      { c: "Round Rock", lat: 30.5254, lng: -97.666, zip: "78664" },
      { c: "Waco", lat: 31.5601, lng: -97.186, zip: "76701" },
    ],
  },
  FL: {
    n: 600,
    areas: ["305", "407", "813", "561", "904"],
    cities: [
      { c: "Miami", lat: 25.784, lng: -80.2101, zip: "33130" },
      { c: "Orlando", lat: 28.4773, lng: -81.337, zip: "32801" },
      { c: "Tampa", lat: 27.9945, lng: -82.4447, zip: "33602" },
      { c: "Jacksonville", lat: 30.3322, lng: -81.6749, zip: "32202" },
      { c: "Sarasota", lat: 27.3387, lng: -82.5432, zip: "34236" },
    ],
  },
  GA: {
    n: 400,
    areas: ["404", "678", "912", "770"],
    cities: [
      { c: "Atlanta", lat: 33.7628, lng: -84.422, zip: "30303" },
      { c: "Savannah", lat: 32.0286, lng: -81.1821, zip: "31401" },
      { c: "Macon", lat: 32.8065, lng: -83.6974, zip: "31201" },
      { c: "Athens", lat: 33.9508, lng: -83.3689, zip: "30601" },
    ],
  },
};

// REAL Overture taxonomy codes (derived from release 2026-08-19.0 — see data/.taxonomy-derivation.json)
const TAXONOMIES = [
  "roofing", "ceiling_and_roofing_repair_and_service", "hvac_service", "water_heater_installation_repair",
  "plumbing", "septic_service", "electrician", "landscaping", "lawn_service", "tree_service",
  "pest_control_service", "pressure_washing", "cleaning_service", "carpet_cleaning",
  "junk_removal_and_hauling", "mover", "key_and_locksmith", "garage_door_service", "fence_and_gate_sales_service",
  "masonry_concrete", "foundation_repair", "painting", "flooring_contractor",
  "contractor", "altering_and_remodeling_contractor", "handyman", "gutter_service", "pool_and_hot_tub_service",
  "automotive_repair", "towing_service", "auto_detailing", "general_dentistry", "chiropractic", "veterinarian",
  "barber", "hair_salon", "restaurant", "personal_injury_law", "accountant", "attorney_or_law_firm",
];
const SERVICE_WORD: Record<string, string> = {
  roofing: "Roofing", ceiling_and_roofing_repair_and_service: "Roof Repair", hvac_service: "Air & Heat",
  water_heater_installation_repair: "Water Heaters", plumbing: "Plumbing",
  septic_service: "Septic", electrician: "Electric", landscaping: "Landscaping",
  lawn_service: "Lawn Care", tree_service: "Tree Service", pest_control_service: "Pest Control",
  pressure_washing: "Pressure Washing", cleaning_service: "Cleaning",
  carpet_cleaning: "Carpet Care", junk_removal_and_hauling: "Junk Removal", mover: "Movers",
  key_and_locksmith: "Locksmith", garage_door_service: "Garage Doors", fence_and_gate_sales_service: "Fencing",
  masonry_concrete: "Concrete", foundation_repair: "Foundation Repair",
  painting: "Painting", flooring_contractor: "Flooring", contractor: "Construction",
  altering_and_remodeling_contractor: "Remodeling", handyman: "Handyman", gutter_service: "Gutters",
  pool_and_hot_tub_service: "Pools", automotive_repair: "Auto Repair", towing_service: "Towing",
  auto_detailing: "Detailing", general_dentistry: "Dental", chiropractic: "Chiropractic",
  veterinarian: "Veterinary", barber: "Barbers", hair_salon: "Salon", restaurant: "Kitchen",
  personal_injury_law: "Law", accountant: "Accounting", attorney_or_law_firm: "Legal",
};
const FIRST = ["Jim", "Maria", "Dale", "Rosa", "Hank", "Tina", "Carlos", "Peggy", "Walt", "June", "Ray", "Dot", "Gus", "Lena", "Bud", "Ida"];
const LAST = ["Baker", "Nguyen", "Ortiz", "Miller", "Hayes", "Kowalski", "Trujillo", "Bennett", "Ferris", "Delgado", "Yoder", "Pruett", "Marsh", "Okafor"];
const ADJ = ["Lone Star", "Sunshine", "Peach State", "Reliable", "Premier", "All Pro", "Family", "Elite", "Budget", "Rapid", "Heritage", "Blue Sky"];

// real-site profiles → MockFetcher/MockPageSpeed behavior (weights within the 50% "has a website URL" bucket)
const REAL_PROFILES: [string, number][] = [
  ["custom-good", 0.2], ["custom-old", 0.1], ["sq-decent", 0.14], ["wp-poor", 0.16],
  ["wix-noviewport", 0.14], ["gd-old", 0.12], ["weebly-poor", 0.08],
  ["parked", 0.03], ["dead", 0.02], ["fbredir", 0.01],
];
function pickRealProfile(): string {
  let r = rnd();
  for (const [name, w] of REAL_PROFILES) {
    if (r < w) return name;
    r -= w;
  }
  return "custom-good";
}

type Row = Record<string, unknown>;
const overtureRows: Row[] = [];
const usedSlugs = new Set<string>();

let gersCounter = 1000;
function gers(): string {
  return `08f2a5${(gersCounter++).toString(16).padStart(10, "0")}${Math.floor(rnd() * 0xffff).toString(16).padStart(4, "0")}`;
}
function phoneFor(areas: string[]): string {
  const area = pick(areas);
  const exch = String(2 + Math.floor(rnd() * 8)) + String(Math.floor(rnd() * 10)) + String(Math.floor(rnd() * 10));
  const line = String(Math.floor(rnd() * 10000)).padStart(4, "0");
  return `+1${area}${exch}${line}`;
}
function slugify(s: string): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  let slug = base;
  let i = 2;
  while (usedSlugs.has(slug)) slug = `${base}${i++}`;
  usedSlugs.add(slug);
  return slug;
}

for (const [state, cfg] of Object.entries(STATES)) {
  for (let i = 0; i < cfg.n; i++) {
    const taxonomy = pick(TAXONOMIES);
    const svc = SERVICE_WORD[taxonomy];
    const city = pick(cfg.cities);
    const style = rnd();
    const name =
      style < 0.3 ? `${pick(FIRST)}'s ${svc}` :
      style < 0.55 ? `${city.c} ${svc} ${pick(["Co", "Pros", "Experts", "Solutions"])}` :
      style < 0.8 ? `${pick(LAST)} Family ${svc}` : `${pick(ADJ)} ${svc}`;
    const slug = slugify(name);

    const kind = rnd(); // none .30 | social .12 | aggregator .06 | shortener .02 | real .50
    let websites: string[] | null = null;
    let socials: string[] | null = null;
    if (kind < 0.3) {
      /* none */
    } else if (kind < 0.42) {
      socials = [`https://www.facebook.com/${slug}`];
      if (chance(0.3)) socials.push(`https://www.instagram.com/${slug}`);
    } else if (kind < 0.48) {
      websites = [pick([`https://www.yelp.com/biz/${slug}`, `https://www.homeadvisor.com/rated.${slug}.html`, `https://www.angi.com/companylist/${slug}.htm`])];
    } else if (kind < 0.5) {
      websites = [`https://bit.ly/${slug.slice(0, 8)}`];
    } else {
      const profile = pickRealProfile();
      websites = [`https://www.${slug}.lf-${profile}.test`];
      if (chance(0.25)) socials = [`https://www.facebook.com/${slug}`];
    }

    const hasAddress = chance(0.97);
    const lat = city.lat + (rnd() - 0.5) * 0.2;
    const lng = city.lng + (rnd() - 0.5) * 0.2;
    overtureRows.push({
      id: gers(),
      names: { primary: name },
      taxonomy: { primary: taxonomy, alternates: chance(0.3) ? [pick(TAXONOMIES)] : [] },
      confidence: Math.round((0.35 + rnd() * 0.63) * 100) / 100,
      operating_status: rnd() < 0.93 ? "open" : rnd() < 0.7 ? "closed" : "unknown",
      phones: chance(0.68) ? [phoneFor(cfg.areas)] : null,
      websites,
      socials,
      emails: chance(0.25) ? [`info@${slug}.lf-mail.test`] : null,
      addresses: hasAddress
        ? [{ freeform: `${100 + Math.floor(rnd() * 9900)} ${pick(["Main St", "Oak Ave", "Ranch Rd", "Commerce Dr", "Pecan Ln"])}`, locality: city.c, region: `US-${state}`, postcode: city.zip, country: "US" }]
        : null,
      bbox: { xmin: lng, xmax: lng, ymin: lat, ymax: lat },
    });
  }
}

// A handful of deterministic multi-state "chains" for the §4.2 heuristic (same name in ≥6 states worth of rows here → seeded via list instead; keep 1 cross-state name for conflation sanity)
for (const state of ["TX", "FL", "GA"]) {
  const cfg = STATES[state];
  const city = cfg.cities[0];
  overtureRows.push({
    id: gers(),
    names: { primary: "Roto Rooter Plumbing" },
    taxonomy: { primary: "plumbing", alternates: [] },
    confidence: 0.95,
    operating_status: "open",
    phones: [phoneFor(cfg.areas)],
    websites: ["https://www.rotorooter.com"],
    socials: null,
    emails: null,
    addresses: [{ freeform: "1 Franchise Way", locality: city.c, region: `US-${state}`, postcode: city.zip, country: "US" }],
    bbox: { xmin: city.lng, xmax: city.lng, ymin: city.lat, ymax: city.lat },
  });
}

// ---------- FSQ rows engineered against the Overture universe ----------
const fsqRows: Row[] = [];
let fsqCounter = 1;
const fsqId = () => `fsq_${(fsqCounter++).toString().padStart(6, "0")}`;
const ovSample = (predicate: (r: Row) => boolean, n: number): Row[] => {
  const matches = overtureRows.filter(predicate);
  const out: Row[] = [];
  for (let i = 0; i < matches.length && out.length < n; i++) if (chance(0.7)) out.push(matches[i]);
  return out;
};
const regionOf = (r: Row) => ((r.addresses as { region: string }[] | null)?.[0]?.region ?? "US-TX").replace("US-", "");
const cityOf = (r: Row) => (r.addresses as { locality: string }[] | null)?.[0]?.locality ?? "Austin";
const zipOf = (r: Row) => (r.addresses as { postcode: string }[] | null)?.[0]?.postcode ?? "78701";

// 1) phone-match rows (~200): same phone; ~40% carry a website Overture lacks (gap-fill), name slightly varied
for (const ov of ovSample((r) => Array.isArray(r.phones) && (r.phones as string[]).length > 0, 200)) {
  const nm = (ov.names as { primary: string }).primary;
  fsqRows.push({
    fsq_place_id: fsqId(),
    name: chance(0.5) ? nm : `${nm} ${pick(["LLC", "Inc", ""])}`.trim(),
    tel: (ov.phones as string[])[0],
    website: !ov.websites && chance(0.4) ? `https://www.${slugify(nm + "fsq")}.lf-wp-poor.test` : null,
    email: chance(0.15) ? `contact@${slugify(nm + "mail")}.lf-mail.test` : null,
    address: "matched by phone",
    locality: cityOf(ov),
    region: regionOf(ov),
    postcode: zipOf(ov),
    latitude: (ov.bbox as { ymin: number }).ymin + 0.0001,
    longitude: (ov.bbox as { xmin: number }).xmin + 0.0001,
    country: "US",
  });
}
// 2) domain-match rows (~50): same website, no phone
for (const ov of ovSample((r) => Array.isArray(r.websites) && (r.websites as string[])[0]?.includes(".lf-"), 50)) {
  fsqRows.push({
    fsq_place_id: fsqId(), name: (ov.names as { primary: string }).primary, tel: null,
    website: (ov.websites as string[])[0], email: null, address: "matched by domain",
    locality: cityOf(ov), region: regionOf(ov), postcode: zipOf(ov),
    latitude: (ov.bbox as { ymin: number }).ymin - 0.0002, longitude: (ov.bbox as { xmin: number }).xmin - 0.0002, country: "US",
  });
}
// 3) name+location matches (~60): same name, <50m, no phone/domain — some add a phone Overture lacks
for (const ov of ovSample((r) => !r.phones && !r.websites, 60)) {
  const st = regionOf(ov);
  fsqRows.push({
    fsq_place_id: fsqId(), name: (ov.names as { primary: string }).primary,
    tel: chance(0.5) ? phoneFor(STATES[st]?.areas ?? ["512"]) : null,
    website: null, email: null, address: "matched by name+loc",
    locality: cityOf(ov), region: st, postcode: zipOf(ov),
    latitude: (ov.bbox as { ymin: number }).ymin + 0.0002, // ~22m north
    longitude: (ov.bbox as { xmin: number }).xmin, country: "US",
  });
}
// 4) conflicting-phone traps (~40): same name+location but a DIFFERENT phone than Overture's verified one → must NOT merge (G1d)
for (const ov of ovSample((r) => Array.isArray(r.phones) && (r.phones as string[]).length > 0, 40)) {
  const st = regionOf(ov);
  fsqRows.push({
    fsq_place_id: fsqId(), name: (ov.names as { primary: string }).primary,
    tel: phoneFor(STATES[st]?.areas ?? ["512"]),
    website: null, email: null, address: "conflicting phone trap",
    locality: cityOf(ov), region: st, postcode: zipOf(ov),
    latitude: (ov.bbox as { ymin: number }).ymin + 0.0001, longitude: (ov.bbox as { xmin: number }).xmin, country: "US",
  });
}
// 5) unmatched (~150)
for (let i = 0; i < 150; i++) {
  const state = pick(Object.keys(STATES));
  const cfg = STATES[state];
  const city = pick(cfg.cities);
  const nm = `${pick(ADJ)} ${pick(["Notary", "Courier", "Vending", "Upholstery", "Engraving", "Alterations"])} ${pick(["Shop", "Services", ""])}`.trim();
  fsqRows.push({
    fsq_place_id: fsqId(), name: nm, tel: chance(0.6) ? phoneFor(cfg.areas) : null,
    website: chance(0.2) ? `https://www.${slugify(nm)}.lf-sq-decent.test` : null, email: null,
    address: `${100 + Math.floor(rnd() * 900)} Side St`, locality: city.c, region: state, postcode: city.zip,
    latitude: city.lat + (rnd() - 0.5) * 0.3, longitude: city.lng + (rnd() - 0.5) * 0.3, country: "US",
  });
}

// ---------- write parquet via DuckDB ----------
async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const ovJsonl = path.join(TMP, "overture.jsonl");
  const fsqJsonl = path.join(TMP, "fsq.jsonl");
  fs.writeFileSync(ovJsonl, overtureRows.map((r) => JSON.stringify(r)).join("\n"));
  fs.writeFileSync(fsqJsonl, fsqRows.map((r) => JSON.stringify(r)).join("\n"));

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const q = (p: string) => p.replaceAll("'", "''");

  await conn.run(`COPY (
    SELECT * FROM read_json('${q(ovJsonl)}', format='newline_delimited', columns={
      id: 'VARCHAR',
      names: 'STRUCT("primary" VARCHAR)',
      taxonomy: 'STRUCT("primary" VARCHAR, alternates VARCHAR[])',
      confidence: 'DOUBLE',
      operating_status: 'VARCHAR',
      phones: 'VARCHAR[]', websites: 'VARCHAR[]', socials: 'VARCHAR[]', emails: 'VARCHAR[]',
      addresses: 'STRUCT(freeform VARCHAR, locality VARCHAR, region VARCHAR, postcode VARCHAR, country VARCHAR)[]',
      bbox: 'STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE)'
    })
  ) TO '${q(path.join(OUT_DIR, "places_overture.parquet"))}' (FORMAT PARQUET)`);

  await conn.run(`COPY (
    SELECT * FROM read_json('${q(fsqJsonl)}', format='newline_delimited', columns={
      fsq_place_id: 'VARCHAR', name: 'VARCHAR', tel: 'VARCHAR', website: 'VARCHAR', email: 'VARCHAR',
      address: 'VARCHAR', locality: 'VARCHAR', region: 'VARCHAR', postcode: 'VARCHAR',
      latitude: 'DOUBLE', longitude: 'DOUBLE', country: 'VARCHAR'
    })
  ) TO '${q(path.join(OUT_DIR, "places_fsq.parquet"))}' (FORMAT PARQUET)`);

  const check = await (await conn.run(`SELECT (SELECT count(*) FROM '${q(path.join(OUT_DIR, "places_overture.parquet"))}') ov,
      (SELECT count(*) FROM '${q(path.join(OUT_DIR, "places_fsq.parquet"))}') fsq`)).getRows();
  console.log(`fixtures written: overture=${check[0][0]} fsq=${check[0][1]} → ${OUT_DIR}`);
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
