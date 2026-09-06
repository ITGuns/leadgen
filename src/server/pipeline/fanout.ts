import fs from "node:fs";
import path from "node:path";
import { defaults } from "../config";
import { getSetting } from "../settings";

/**
 * §4.1 — city fan-out for the PAID TOP-UP ONLY (free campaigns query locally and need
 * no fan-out). SimpleMaps US Cities (CC-BY-4.0, starter subset bundled — BLOCKERS B9),
 * parsed by header so the full download drops in unchanged. Population floor default
 * 5,000 (settings-tunable) orders a state into a few hundred meaningful queries.
 */

export type City = { city: string; stateId: string; lat: number; lng: number; population: number };

let cityCache: City[] | null = null;

export function loadCities(): City[] {
  if (cityCache) return cityCache;
  const csv = fs.readFileSync(path.join(process.cwd(), "data", "us_cities.csv"), "utf8");
  const lines = csv.trim().split(/\r?\n/);
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const idx = {
    city: header.indexOf("city"),
    stateId: header.indexOf("state_id"),
    lat: header.indexOf("lat"),
    lng: header.indexOf("lng"),
    population: header.indexOf("population"),
  };
  if (idx.city < 0 || idx.stateId < 0 || idx.population < 0) {
    throw new Error("data/us_cities.csv missing required columns (city, state_id, population)");
  }
  cityCache = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    return {
      city: cols[idx.city],
      stateId: cols[idx.stateId],
      lat: parseFloat(cols[idx.lat] ?? "0"),
      lng: parseFloat(cols[idx.lng] ?? "0"),
      population: parseInt(cols[idx.population] ?? "0", 10) || 0,
    };
  }).filter((c) => c.city && c.stateId);
  return cityCache;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Cities for the given states above the population floor, largest first.
 * ZIP entries in the city list refine the free local pull only (query.ts); the paid
 * fan-out queries by city name, so ZIPs are ignored here rather than zeroing it out. */
export function fanOutCities(states: string[], opts?: { cityList?: string[] | null }): City[] {
  const floor = getSetting<number>("cityPopulationFloor", defaults.cityPopulationFloor);
  const stateSet = new Set(states.map((s) => s.toUpperCase()));
  let cities = loadCities().filter((c) => stateSet.has(c.stateId.toUpperCase()) && c.population >= floor);
  const wanted = new Set(
    (opts?.cityList ?? []).map((c) => c.toLowerCase().trim()).filter((c) => c && !/^\d{5}$/.test(c)),
  );
  if (wanted.size) cities = cities.filter((c) => wanted.has(c.city.toLowerCase()));
  return cities.sort((a, b) => b.population - a.population);
}
