import crypto from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns, intents, spendLedger } from "@/db/schema";
import { env, now } from "./config";
import { getSetting } from "./settings";

/** CONTRACTS C10 — cost safety. Guard before EVERY billable call; intent before submit. */

export class BudgetExceededError extends Error {
  constructor(public scope: "campaign" | "monthly", public wouldSpendUSD: number, public capUSD: number) {
    super(`${scope} budget exceeded: would spend $${wouldSpendUSD.toFixed(2)} against cap $${capUSD.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

export function queryHash(provider: string, query: unknown): string {
  return crypto.createHash("sha256").update(provider + "\n" + JSON.stringify(query)).digest("hex");
}

/** Idempotent: returns the existing intent for an identical (provider, query). */
export async function recordIntent(provider: string, query: unknown, campaignId: number | null, estCostUSD: number) {
  const db = getDb();
  const hash = queryHash(provider, query);
  const existing = (await db.select().from(intents).where(eq(intents.queryHash, hash)).limit(1))[0];
  if (existing) return existing;
  const ts = now().toISOString();
  const [row] = await db
    .insert(intents)
    .values({ provider, queryHash: hash, query, campaignId, estCostUSD, createdAt: ts, updatedAt: ts })
    .returning();
  return row;
}

export async function updateIntent(id: number, patch: Partial<typeof intents.$inferInsert>): Promise<void> {
  await getDb()
    .update(intents)
    .set({ ...patch, updatedAt: now().toISOString() })
    .where(eq(intents.id, id));
}

export async function campaignSpendUSD(campaignId: number): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${spendLedger.amountUSD}), 0)::float` })
    .from(spendLedger)
    .where(eq(spendLedger.campaignId, campaignId));
  return row?.total ?? 0;
}

export async function monthSpendUSD(): Promise<number> {
  const monthStart = now().toISOString().slice(0, 7) + "-01";
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${spendLedger.amountUSD}), 0)::float` })
    .from(spendLedger)
    .where(and(gte(spendLedger.createdAt, monthStart), eq(spendLedger.kind, "actual")));
  return row?.total ?? 0;
}

export async function monthlyCeilingUSD(): Promise<number> {
  return getSetting<number>("monthlySpendCeilingUSD", env.monthlySpendCeilingUSD());
}

/**
 * Throws before the call if spending `nextCallUSD` more would exceed the campaign cap
 * or the monthly ceiling. Overshoot is bounded by one call/page (G6 invariant).
 */
export async function budgetGuard(campaignId: number, nextCallUSD: number): Promise<void> {
  if (nextCallUSD <= 0) return;
  // runs before EVERY billable call — one round trip of wall time, not four
  const [[campaign], spent, ceiling, monthSpent] = await Promise.all([
    getDb().select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1),
    campaignSpendUSD(campaignId),
    monthlyCeilingUSD(),
    monthSpendUSD(),
  ]);
  if (!campaign) throw new Error(`budgetGuard: campaign ${campaignId} not found`);
  const cap = campaign.caps.budgetCapUSD;
  if (spent + nextCallUSD > cap) throw new BudgetExceededError("campaign", spent + nextCallUSD, cap);
  if (monthSpent + nextCallUSD > ceiling) throw new BudgetExceededError("monthly", monthSpent + nextCallUSD, ceiling);
}

export async function recordSpend(
  provider: string,
  campaignId: number | null,
  amountUSD: number,
  kind: "actual" | "estimated",
  detail?: string,
): Promise<void> {
  if (amountUSD === 0) return;
  const db = getDb();
  await db
    .insert(spendLedger)
    .values({ provider, campaignId, amountUSD, kind, detail, createdAt: now().toISOString() });
  if (campaignId != null) {
    await db
      .update(campaigns)
      .set({ spendUSD: sql`${campaigns.spendUSD} + ${amountUSD}` })
      .where(eq(campaigns.id, campaignId));
  }
}
