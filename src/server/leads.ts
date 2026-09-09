import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, businesses, campaignLeads, campaigns, leads, notes } from "@/db/schema";
import { audit } from "./audit";
import { now } from "./config";
import { loadSuppressionSets, isSuppressed } from "./suppression";

/** §3.4 — leads workspace queries. Leads are global; campaign membership is history. */

export type LeadFilters = {
  q?: string;
  status?: string[];
  states?: string[];
  minScore?: number;
  campaignId?: number;
  hasWebsite?: "yes" | "no";
  ownerFound?: boolean;
  assignee?: string;
  tag?: string;
  sort?: "score" | "name" | "state" | "updated";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export async function listLeads(f: LeadFilters) {
  const db = getDb();
  const parts: SQL[] = [sql`1=1`];
  if (f.q) {
    const like = `%${f.q.toLowerCase()}%`;
    parts.push(
      sql`(lower(${businesses.name}) LIKE ${like} OR lower(coalesce(${businesses.city}, '')) LIKE ${like} OR coalesce(${businesses.phone}, '') LIKE ${like} OR lower(coalesce(${leads.ownerName}, '')) LIKE ${like})`,
    );
  }
  if (f.status?.length) parts.push(sql`${leads.status} IN (${sql.join(f.status.map((s) => sql`${s}`), sql`, `)})`);
  if (f.states?.length)
    parts.push(sql`${businesses.region} IN (${sql.join(f.states.map((s) => sql`${s.toUpperCase()}`), sql`, `)})`);
  if (f.minScore != null) parts.push(sql`coalesce(${leads.score}, -1) >= ${f.minScore}`);
  if (f.hasWebsite === "yes") parts.push(sql`${businesses.websiteClass} = 'real_site'`);
  if (f.hasWebsite === "no") parts.push(sql`${businesses.websiteClass} IN ('none','social_only','aggregator','parked','dead')`);
  if (f.ownerFound === true) parts.push(sql`${leads.ownerName} IS NOT NULL`);
  if (f.ownerFound === false) parts.push(sql`${leads.ownerName} IS NULL`);
  if (f.assignee) parts.push(sql`${leads.assignee} = ${f.assignee}`);
  if (f.tag) parts.push(sql`coalesce(${leads.tags}, '[]'::jsonb) ? ${f.tag}::text`);
  if (f.campaignId) {
    parts.push(
      sql`EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = ${leads.id} AND cl.campaign_id = ${f.campaignId})`,
    );
  }
  const where = and(...parts)!;

  const order =
    f.sort === "name"
      ? sql`${businesses.normalizedName} ${f.dir === "desc" ? sql`DESC` : sql`ASC`}`
      : f.sort === "state"
        ? sql`${businesses.region} ${f.dir === "desc" ? sql`DESC` : sql`ASC`}, coalesce(${leads.score}, -1) DESC`
        : f.sort === "updated"
          ? sql`${leads.updatedAt} ${f.dir === "asc" ? sql`ASC` : sql`DESC`}`
          : sql`coalesce(${leads.score}, -1) ${f.dir === "asc" ? sql`ASC` : sql`DESC`}, ${leads.id} ASC`;

  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);

  // one round trip's worth of wall time, not four — latency matters on a remote DB
  const [[totalRow], rows, dnc, client] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(where),
    db
      .select({ lead: leads, business: businesses })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    loadSuppressionSets("dnc"),
    loadSuppressionSets("client"),
  ]);
  const total = totalRow?.n ?? 0;
  return {
    total,
    page,
    pageSize,
    rows: rows.map(({ lead, business }) => ({
      lead,
      business,
      dncSuppressed: isSuppressed(business, dnc),
      clientSuppressed: isSuppressed(business, client),
    })),
  };
}

export async function getLeadDetail(id: number) {
  const db = getDb();
  const [row] = await db
    .select({ lead: leads, business: businesses })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(eq(leads.id, id))
    .limit(1);
  if (!row) return null;
  const [leadNotes, memberships, dnc, client] = await Promise.all([
    db.select().from(notes).where(eq(notes.leadId, id)).orderBy(desc(notes.id)),
    db
      .select({ id: campaigns.id, name: campaigns.name, addedAt: campaignLeads.addedAt, status: campaigns.status })
      .from(campaignLeads)
      .innerJoin(campaigns, eq(campaignLeads.campaignId, campaigns.id))
      .where(eq(campaignLeads.leadId, id)),
    loadSuppressionSets("dnc"),
    loadSuppressionSets("client"),
  ]);
  return {
    ...row,
    notes: leadNotes,
    campaigns: memberships,
    dncSuppressed: isSuppressed(row.business, dnc),
    clientSuppressed: isSuppressed(row.business, client),
  };
}

const LEAD_STATUSES = ["new", "contacted", "interested", "not_interested", "dnc"] as const;

export async function patchLead(
  id: number,
  patch: { status?: string; assignee?: string | null; tags?: string[] },
  actor: string,
) {
  const db = getDb();
  const set: Partial<typeof leads.$inferInsert> = { updatedAt: now().toISOString() };
  if (patch.status !== undefined) {
    if (!LEAD_STATUSES.includes(patch.status as (typeof LEAD_STATUSES)[number])) throw new Error("bad status");
    set.status = patch.status;
  }
  if (patch.assignee !== undefined) set.assignee = patch.assignee || null;
  if (patch.tags !== undefined) set.tags = patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20);
  await db.update(leads).set(set).where(eq(leads.id, id));
  if (patch.status === "dnc") await audit(actor, "lead.dnc", { leadId: id });
  return getLeadDetail(id);
}

export async function bulkPatchLeads(
  ids: number[],
  patch: { status?: string; assignee?: string | null; tags?: string[] },
  actor: string,
): Promise<number> {
  let n = 0;
  for (const id of ids.slice(0, 1000)) {
    await patchLead(id, patch, actor);
    n++;
  }
  await audit(actor, "lead.bulk", { count: n, patch });
  return n;
}

export async function addNote(leadId: number, author: string, body: string) {
  const [row] = await getDb()
    .insert(notes)
    .values({ leadId, author, body: body.slice(0, 4000), createdAt: now().toISOString() })
    .returning();
  return row;
}

export async function dashboardStats() {
  const db = getDb();
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [businessCount, leadCount, byStatus, hotLeads, ownersFound, recentAudit] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)::int` }).from(businesses)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(leads)),
    db.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.status),
    count(db.select({ n: sql<number>`count(*)::int` }).from(leads).where(sql`score >= 80`)),
    count(db.select({ n: sql<number>`count(*)::int` }).from(leads).where(sql`owner_name IS NOT NULL`)),
    db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(8),
  ]);
  return { businessCount, leadCount, byStatus, hotLeads, ownersFound, recentAudit };
}
