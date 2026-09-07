import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { taxonomyMappings } from "@/db/schema";
import { now } from "../config";

/** Taxonomy catalog (derived from the release — D18) + niche→taxonomy proposals (§3.1). */

export type TaxonomyEntry = { code: string; label: string; parent: string };

let catalogCache: Map<string, TaxonomyEntry> | null = null;

export function taxonomyCatalog(): Map<string, TaxonomyEntry> {
  if (catalogCache) return catalogCache;
  const csv = fs.readFileSync(path.join(process.cwd(), "data", "overture_taxonomy.csv"), "utf8");
  const lines = csv.trim().split(/\r?\n/);
  const map = new Map<string, TaxonomyEntry>();
  for (const line of lines.slice(1)) {
    const [code, label, parent] = line.split(",");
    if (code) map.set(code.trim(), { code: code.trim(), label: (label ?? "").trim(), parent: (parent ?? "").trim() });
  }
  catalogCache = map;
  return map;
}

export function taxonomyResolves(code: string | null | undefined): boolean {
  if (!code) return false;
  return taxonomyCatalog().has(code);
}

export function normalizeNiche(niche: string): string {
  return niche.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

let curatedCache: Record<string, string[]> | null = null;
function curatedMappings(): Record<string, string[]> {
  if (curatedCache) return curatedCache;
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "niche_mappings.json"), "utf8"));
  delete raw._comment;
  curatedCache = raw as Record<string, string[]>;
  return curatedCache;
}

/** crude singular/plural folding for token matching */
function stem(w: string): string {
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("ers")) return w.slice(0, -1);
  if (w.endsWith("es")) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}

export type TaxonomyProposal = {
  codes: string[];
  source: "confirmed" | "curated" | "fuzzy" | "ai";
  autoApply: boolean; // previously human-confirmed niches auto-apply (§3.1)
};

/**
 * Proposal order: confirmed mapping (auto-applies) → curated file → fuzzy token match
 * against the catalog. The optional AI assist is merged by the caller (campaigns API)
 * so this module stays offline.
 */
export async function proposeTaxonomy(nicheRaw: string): Promise<TaxonomyProposal> {
  const db = getDb();
  const niche = normalizeNiche(nicheRaw);
  const [confirmed] = await db.select().from(taxonomyMappings).where(eq(taxonomyMappings.niche, niche)).limit(1);
  if (confirmed) return { codes: confirmed.taxonomySet, source: "confirmed", autoApply: true };

  const curated = curatedMappings();
  if (curated[niche]) return { codes: curated[niche], source: "curated", autoApply: false };
  // curated key variants: singular/plural fold
  const foldedNiche = niche.split(" ").map(stem).join(" ");
  for (const [key, codes] of Object.entries(curated)) {
    if (key.split(" ").map(stem).join(" ") === foldedNiche) return { codes, source: "curated", autoApply: false };
  }

  // fuzzy: stemmed token overlap against code + label words
  const tokens = new Set(niche.split(" ").map(stem).filter((w) => w.length > 2));
  const scored: { code: string; score: number }[] = [];
  for (const entry of taxonomyCatalog().values()) {
    const words = new Set(
      (entry.label.toLowerCase() + " " + entry.code.replaceAll("_", " ")).split(/\s+/).map(stem),
    );
    let overlap = 0;
    for (const t of tokens) if (words.has(t)) overlap++;
    if (overlap > 0) scored.push({ code: entry.code, score: overlap + (words.has([...tokens][0]) ? 0.1 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored.filter((s) => s.score >= Math.max(1, scored[0]?.score ?? 1)).slice(0, 4);
  return { codes: best.map((b) => b.code), source: "fuzzy", autoApply: false };
}

export async function confirmTaxonomy(nicheRaw: string, codes: string[], confirmedBy: string): Promise<void> {
  const db = getDb();
  const niche = normalizeNiche(nicheRaw);
  await db
    .insert(taxonomyMappings)
    .values({ niche, taxonomySet: codes, confirmedBy, confirmedAt: now().toISOString(), timesUsed: 1 })
    .onConflictDoUpdate({
      target: taxonomyMappings.niche,
      set: { taxonomySet: codes, confirmedBy, confirmedAt: now().toISOString(), timesUsed: sql`${taxonomyMappings.timesUsed} + 1` },
    });
}

export async function confirmedNicheCount(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(taxonomyMappings);
  return row?.n ?? 0;
}
