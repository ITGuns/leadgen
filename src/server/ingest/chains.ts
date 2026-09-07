import fs from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, chains } from "@/db/schema";
import { defaults, now } from "../config";
import { normalizeName } from "../normalize";

/** §4.2 — chain flag = known_chains.txt contains-match OR name in ≥N states. Flag, never delete. */

let chainListCache: string[] | null = null;
export function knownChainNames(): string[] {
  if (chainListCache) return chainListCache;
  const file = path.join(process.cwd(), "data", "known_chains.txt");
  chainListCache = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => normalizeName(l));
  return chainListCache;
}

export function isKnownChain(normalizedName: string): boolean {
  return knownChainNames().some((c) => normalizedName === c || normalizedName.includes(c));
}

export async function flagChains(): Promise<number> {
  const db = getDb();
  const ts = now().toISOString();
  let flagged = 0;

  // heuristic: same normalized name in ≥ N distinct states
  const multiState = await db
    .select({ name: businesses.normalizedName, states: sql<number>`count(distinct ${businesses.region})::int` })
    .from(businesses)
    .groupBy(businesses.normalizedName)
    .having(sql`count(distinct ${businesses.region}) >= ${defaults.chainStateThreshold}`);

  const toFlag = new Map<string, { source: string; stateCount: number | null }>();
  for (const m of multiState) toFlag.set(m.name, { source: "heuristic", stateCount: m.states });

  const allNames = await db
    .selectDistinct({ name: businesses.normalizedName })
    .from(businesses)
    .where(eq(businesses.chain, false));
  for (const { name } of allNames) {
    if (!toFlag.has(name) && isKnownChain(name)) toFlag.set(name, { source: "list", stateCount: null });
  }

  const names = [...toFlag.keys()];
  for (let c = 0; c < names.length; c += 200) {
    const chunk = names.slice(c, c + 200);
    await db.transaction(async (tx) => {
      for (const name of chunk) {
        const meta = toFlag.get(name)!;
        await tx
          .insert(chains)
          .values({ nameNormalized: name, source: meta.source, stateCount: meta.stateCount, flaggedAt: ts })
          .onConflictDoNothing();
      }
      const rows = await tx
        .update(businesses)
        .set({ chain: true, updatedAt: ts })
        .where(inArray(businesses.normalizedName, chunk))
        .returning({ id: businesses.id });
      flagged += rows.length;
    });
  }
  return flagged;
}
