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
export function recordIntent(provider: string, query: unknown, campaignId: number | null, estCostUSD: number) {
  const db = getDb();
  const hash = queryHash(provider, query);
  const existing = db.select().from(intents).where(eq(intents.queryHash, hash)).get();
  if (existing) return existing;
  const ts = now().toISOString();
  return db
    .insert(intents)
    .values({ provider, queryHash: hash, query, campaignId, estCostUSD, createdAt: ts, updatedAt: ts })
    .returning()
    .get();
}

export function updateIntent(id: number, patch: Partial<typeof intents.$inferInsert>): void {
  getDb()
    .update(intents)
    .set({ ...patch, updatedAt: now().toISOString() })
    .where(eq(intents.id, id))
    .run();
}

export function campaignSpendUSD(campaignId: number): number {
  const row = getDb()
    .select({ total: sql<number>`coalesce(sum(${spendLedger.amountUSD}), 0)` })
    .from(spendLedger)
    .where(eq(spendLedger.campaignId, campaignId))
    .get();
  return row?.total ?? 0;
}

export function monthSpendUSD(): number {
  const monthStart = now().toISOString().slice(0, 7) + "-01";
  const row = getDb()
    .select({ total: sql<number>`coalesce(sum(${spendLedger.amountUSD}), 0)` })
    .from(spendLedger)
    .where(and(gte(spendLedger.createdAt, monthStart), eq(spendLedger.kind, "actual")))
    .get();
  return row?.total ?? 0;
}

export function monthlyCeilingUSD(): number {
  return getSetting<number>("monthlySpendCeilingUSD", env.monthlySpendCeilingUSD());
}

/**
 * Throws before the call if spending `nextCallUSD` more would exceed the campaign cap
 * or the monthly ceiling. Overshoot is bounded by one call/page (G6 invariant).
 */
export function budgetGuard(campaignId: number, nextCallUSD: number): void {
  if (nextCallUSD <= 0) return;
  const campaign = getDb().select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
  if (!campaign) throw new Error(`budgetGuard: campaign ${campaignId} not found`);
  const cap = campaign.caps.budgetCapUSD;
  const spent = campaignSpendUSD(campaignId);
  if (spent + nextCallUSD > cap) throw new BudgetExceededError("campaign", spent + nextCallUSD, cap);
  const ceiling = monthlyCeilingUSD();
  const monthSpent = monthSpendUSD();
  if (monthSpent + nextCallUSD > ceiling) throw new BudgetExceededError("monthly", monthSpent + nextCallUSD, ceiling);
}

export function recordSpend(
  provider: string,
  campaignId: number | null,
  amountUSD: number,
  kind: "actual" | "estimated",
  detail?: string,
): void {
  if (amountUSD === 0) return;
  const db = getDb();
  db.insert(spendLedger)
    .values({ provider, campaignId, amountUSD, kind, detail, createdAt: now().toISOString() })
    .run();
  if (campaignId != null) {
    db.update(campaigns)
      .set({ spendUSD: sql`${campaigns.spendUSD} + ${amountUSD}` })
      .where(eq(campaigns.id, campaignId))
      .run();
  }
}
