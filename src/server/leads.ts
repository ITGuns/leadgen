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

export function listLeads(f: LeadFilters) {
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
  if (f.tag) parts.push(sql`EXISTS (SELECT 1 FROM json_each(coalesce(${leads.tags}, '[]')) jt WHERE jt.value = ${f.tag})`);
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

  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(where)
      .get()?.n ?? 0;

  const rows = db
    .select({ lead: leads, business: businesses })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(where)
    .orderBy(order)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const dnc = loadSuppressionSets("dnc");
  const client = loadSuppressionSets("client");
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

export function getLeadDetail(id: number) {
  const db = getDb();
  const row = db
    .select({ lead: leads, business: businesses })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(eq(leads.id, id))
    .get();
  if (!row) return null;
  const leadNotes = db.select().from(notes).where(eq(notes.leadId, id)).orderBy(desc(notes.id)).all();
  const memberships = db
    .select({ id: campaigns.id, name: campaigns.name, addedAt: campaignLeads.addedAt, status: campaigns.status })
    .from(campaignLeads)
    .innerJoin(campaigns, eq(campaignLeads.campaignId, campaigns.id))
    .where(eq(campaignLeads.leadId, id))
    .all();
  const dnc = loadSuppressionSets("dnc");
  const client = loadSuppressionSets("client");
  return {
    ...row,
    notes: leadNotes,
    campaigns: memberships,
    dncSuppressed: isSuppressed(row.business, dnc),
    clientSuppressed: isSuppressed(row.business, client),
  };
}

const LEAD_STATUSES = ["new", "contacted", "interested", "not_interested", "dnc"] as const;

export function patchLead(
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
  db.update(leads).set(set).where(eq(leads.id, id)).run();
  if (patch.status === "dnc") audit(actor, "lead.dnc", { leadId: id });
  return getLeadDetail(id);
}

export function bulkPatchLeads(ids: number[], patch: { status?: string; assignee?: string | null; tags?: string[] }, actor: string): number {
  let n = 0;
  for (const id of ids.slice(0, 1000)) {
    patchLead(id, patch, actor);
    n++;
  }
  audit(actor, "lead.bulk", { count: n, patch });
  return n;
}

export function addNote(leadId: number, author: string, body: string) {
  return getDb()
    .insert(notes)
    .values({ leadId, author, body: body.slice(0, 4000), createdAt: now().toISOString() })
    .returning()
    .get();
}

export function dashboardStats() {
  const db = getDb();
  const one = <T>(q: { get(): T | undefined }, dflt: T): T => q.get() ?? dflt;
  const businessCount = one(db.select({ n: sql<number>`count(*)` }).from(businesses), { n: 0 }).n;
  const leadCount = one(db.select({ n: sql<number>`count(*)` }).from(leads), { n: 0 }).n;
  const byStatus = db.select({ status: leads.status, n: sql<number>`count(*)` }).from(leads).groupBy(leads.status).all();
  const hotLeads = one(db.select({ n: sql<number>`count(*)` }).from(leads).where(sql`score >= 80`), { n: 0 }).n;
  const ownersFound = one(db.select({ n: sql<number>`count(*)` }).from(leads).where(sql`owner_name IS NOT NULL`), { n: 0 }).n;
  const recentAudit = db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(8).all();
  return { businessCount, leadCount, byStatus, hotLeads, ownersFound, recentAudit };
}
