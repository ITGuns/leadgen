import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

/** All timestamps are ISO-8601 UTC strings. All *Json columns are typed JSON in text. */

// ---------- settings / releases / raw places ----------

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }),
  updatedAt: text("updated_at").notNull(),
});

export const releases = sqliteTable(
  "releases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(), // 'overture' | 'fsq'
    releaseId: text("release_id").notNull(),
    status: text("status").notNull().default("pending"), // pending|active|previous|failed
    states: text("states", { mode: "json" }).$type<string[]>(),
    rowCounts: text("row_counts", { mode: "json" }).$type<Record<string, number>>(),
    gateReport: text("gate_report", { mode: "json" }),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [uniqueIndex("releases_source_release").on(t.source, t.releaseId)],
);

export const placesOverture = sqliteTable(
  "places_overture",
  {
    gersId: text("gers_id").primaryKey(),
    name: text("name").notNull(),
    phones: text("phones", { mode: "json" }).$type<string[]>(),
    websites: text("websites", { mode: "json" }).$type<string[]>(),
    socials: text("socials", { mode: "json" }).$type<string[]>(),
    emails: text("emails", { mode: "json" }).$type<string[]>(),
    street: text("street"),
    city: text("city"),
    region: text("region"), // 'TX'
    postal: text("postal"),
    lat: real("lat"),
    lng: real("lng"),
    taxonomyPrimary: text("taxonomy_primary"),
    taxonomyAlternates: text("taxonomy_alternates", { mode: "json" }).$type<string[]>(),
    confidence: real("confidence"),
    operatingStatus: text("operating_status"),
    releaseId: text("release_id").notNull(),
  },
  (t) => [index("po_region").on(t.region), index("po_taxonomy").on(t.taxonomyPrimary)],
);

export const placesFsq = sqliteTable(
  "places_fsq",
  {
    fsqId: text("fsq_id").primaryKey(),
    name: text("name").notNull(),
    tel: text("tel"),
    website: text("website"),
    email: text("email"),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    lat: real("lat"),
    lng: real("lng"),
    matchedGersId: text("matched_gers_id"),
    releaseId: text("release_id").notNull(),
  },
  (t) => [index("pf_region").on(t.region)],
);

// ---------- conflated businesses + leads ----------

export type BusinessSources = {
  overture?: { release: string };
  fsq?: { release: string; fsqId: string };
  outscraper?: { placeId?: string; intentId?: number };
  conflicts?: { field: string; kept: string; other: string; otherSource: string }[];
};

export const businesses = sqliteTable(
  "businesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gersId: text("gers_id"),
    identityKey: text("identity_key").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    phone: text("phone"),
    phoneSource: text("phone_source"),
    websiteRaw: text("website_raw"),
    websiteNormalized: text("website_normalized"),
    websiteSource: text("website_source"),
    websiteClass: text("website_class").notNull().default("unknown"),
    socials: text("socials", { mode: "json" }).$type<string[]>(),
    emails: text("emails", { mode: "json" }).$type<string[]>(),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    lat: real("lat"),
    lng: real("lng"),
    taxonomyPrimary: text("taxonomy_primary"),
    taxonomyAlternates: text("taxonomy_alternates", { mode: "json" }).$type<string[]>(),
    confidence: real("confidence"),
    operatingStatus: text("operating_status"),
    chain: integer("chain", { mode: "boolean" }).notNull().default(false),
    sources: text("sources", { mode: "json" }).$type<BusinessSources>(),
    firstSeenRelease: text("first_seen_release"),
    lastSeenRelease: text("last_seen_release"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("biz_identity").on(t.identityKey),
    uniqueIndex("biz_gers").on(t.gersId),
    index("biz_region").on(t.region),
    index("biz_taxonomy").on(t.taxonomyPrimary),
    index("biz_phone").on(t.phone),
    index("biz_domain").on(t.websiteNormalized),
    index("biz_normname").on(t.normalizedName),
  ],
);

export type ScoreReason = { chip: string; points: number; detail?: string };
export type WebsiteCheck = {
  finalUrl?: string;
  httpStatus?: number;
  ok: boolean;
  ssl?: boolean;
  redirectedToSocial?: boolean;
  builder?: string | null;
  copyrightYear?: number | null;
  hasContactForm?: boolean;
  hasBooking?: boolean;
  hasClickToCall?: boolean;
  hasViewportMeta?: boolean;
  htmlBytes?: number;
  error?: string;
  fetchedAt: string;
};

export const leads = sqliteTable(
  "leads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    score: integer("score"),
    scoreReasons: text("score_reasons", { mode: "json" }).$type<ScoreReason[]>(),
    websiteCheck: text("website_check", { mode: "json" }).$type<WebsiteCheck>(),
    pagespeed: text("pagespeed", { mode: "json" }).$type<{ mobileScore: number; lcpMs: number; fetchedAt: string }>(),
    ownerName: text("owner_name"),
    ownerRole: text("owner_role"),
    ownerEvidence: text("owner_evidence"),
    ownerConfidence: text("owner_confidence"), // 'high' | 'low'
    ownerSource: text("owner_source"), // 'heuristic' | 'ai' | 'outscraper'
    ownerCheckedAt: text("owner_checked_at"), // set after an extraction attempt (idempotency cursor)
    status: text("status").notNull().default("new"), // new|contacted|interested|not_interested|dnc
    assignee: text("assignee"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    lastVerifiedAt: text("last_verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("leads_business").on(t.businessId),
    index("leads_status").on(t.status),
    index("leads_score").on(t.score),
  ],
);

// ---------- campaigns ----------

export type CampaignFilters = {
  hasWebsite: "any" | "yes" | "no";
  minConfidence: number;
  hasPhone: boolean;
  operatingOnly: boolean;
  sources: ("overture" | "fsq" | "outscraper")[];
  excludeChains: boolean;
  includeContactless: boolean;
};
export type CampaignCaps = { maxRecords: number; budgetCapUSD: number };
export type CampaignTopUp = { enabled: boolean; provider: "outscraper"; capUSD: number };
export type CampaignEstimate = {
  plannedRecords: number;
  baseUSD: number;
  aiUSD: number;
  topUpUSD: number;
  totalUSD: number;
  citiesFannedOut?: number;
};

export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  niche: text("niche").notNull(),
  confirmedTaxonomy: text("confirmed_taxonomy", { mode: "json" }).$type<string[]>().notNull(),
  states: text("states", { mode: "json" }).$type<string[]>().notNull(),
  cityList: text("city_list", { mode: "json" }).$type<string[]>(),
  filters: text("filters", { mode: "json" }).$type<CampaignFilters>().notNull(),
  caps: text("caps", { mode: "json" }).$type<CampaignCaps>().notNull(),
  smoke: integer("smoke", { mode: "boolean" }).notNull().default(false),
  aiOwnerExtraction: integer("ai_owner_extraction", { mode: "boolean" }).notNull().default(false),
  topUp: text("top_up", { mode: "json" }).$type<CampaignTopUp>(),
  status: text("status").notNull().default("draft"), // draft|running|paused|completed|canceled|failed
  pauseRequested: integer("pause_requested", { mode: "boolean" }).notNull().default(false),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  currentStage: text("current_stage"),
  releaseOverture: text("release_overture"),
  releaseFsq: text("release_fsq"),
  estimate: text("estimate", { mode: "json" }).$type<CampaignEstimate>(),
  spendUSD: real("spend_usd").notNull().default(0),
  stageCounts: text("stage_counts", { mode: "json" }).$type<Record<string, number>>(),
  stageErrors: text("stage_errors", { mode: "json" }).$type<Record<string, number>>(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const campaignLeads = sqliteTable(
  "campaign_leads",
  {
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    addedAt: text("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.leadId] }), index("cl_lead").on(t.leadId)],
);

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("notes_lead").on(t.leadId)],
);

// ---------- jobs / intents / spend ----------

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }),
    status: text("status").notNull().default("pending"), // pending|running|completed|failed|canceled
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    progress: text("progress", { mode: "json" }),
    campaignId: integer("campaign_id"),
    runAfter: text("run_after"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
  },
  (t) => [index("jobs_status").on(t.status, t.runAfter), index("jobs_campaign").on(t.campaignId)],
);

export const intents = sqliteTable(
  "intents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    queryHash: text("query_hash").notNull(),
    query: text("query", { mode: "json" }),
    campaignId: integer("campaign_id"),
    status: text("status").notNull().default("planned"), // planned|submitted|fetched|abandoned|stalled
    providerJobId: text("provider_job_id"),
    estCostUSD: real("est_cost_usd").notNull().default(0),
    actualCostUSD: real("actual_cost_usd"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("intents_hash").on(t.queryHash), index("intents_campaign").on(t.campaignId)],
);

export const spendLedger = sqliteTable(
  "spend_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    campaignId: integer("campaign_id"),
    amountUSD: real("amount_usd").notNull(),
    kind: text("kind").notNull(), // 'actual' | 'estimated'
    detail: text("detail"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("spend_campaign").on(t.campaignId), index("spend_created").on(t.createdAt)],
);

export const quotaUsage = sqliteTable(
  "quota_usage",
  {
    provider: text("provider").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD UTC
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.day] })],
);

// ---------- suppression / audit / taxonomy / caches ----------

export const suppressions = sqliteTable(
  "suppressions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(), // 'client' | 'dnc'
    phone: text("phone"),
    domain: text("domain"),
    note: text("note"),
    source: text("source"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("sup_kind_phone").on(t.kind, t.phone), uniqueIndex("sup_kind_domain").on(t.kind, t.domain)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: text("detail", { mode: "json" }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_created").on(t.createdAt)],
);

export const taxonomyMappings = sqliteTable("taxonomy_mappings", {
  niche: text("niche").primaryKey(), // normalized
  taxonomySet: text("taxonomy_set", { mode: "json" }).$type<string[]>().notNull(),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: text("confirmed_at").notNull(),
  timesUsed: integer("times_used").notNull().default(0),
});

export const pagespeedCache = sqliteTable("pagespeed_cache", {
  domain: text("domain").primaryKey(),
  mobileScore: integer("mobile_score").notNull(),
  lcpMs: integer("lcp_ms").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

export const chains = sqliteTable("chains", {
  nameNormalized: text("name_normalized").primaryKey(),
  source: text("source").notNull(), // 'list' | 'heuristic'
  stateCount: integer("state_count"),
  flaggedAt: text("flagged_at").notNull(),
});

// ---------- exports ----------

export type ExportParams = {
  campaignId?: number;
  filters?: Record<string, unknown>;
  columns: string[];
  includeExcluded: boolean; // include DNC / not_interested (audit-logged)
  leadIds?: number[];
  toDrive?: boolean;
  driveSubfolder?: string; // §3.5 optional per-campaign subfolder (created under the configured folder)
};

export const exportsTable = sqliteTable(
  "exports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    format: text("format").notNull(), // 'xlsx' | 'csv'
    params: text("params", { mode: "json" }).$type<ExportParams>().notNull(),
    status: text("status").notNull().default("pending"), // pending|running|completed|failed
    path: text("path"),
    rowCount: integer("row_count"),
    driveLink: text("drive_link"),
    requestedBy: text("requested_by").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("exports_created").on(t.createdAt)],
);
