import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/** Postgres dialect (D19: Supabase in production, PGlite locally/CI — one schema).
 *  All timestamps are ISO-8601 UTC strings. All JSON columns are typed jsonb. */

// ---------- settings / releases / raw places ----------

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: text("updated_at").notNull(),
});

/** AES-256-GCM payloads under APP_SECRET (D8-revised: serverless has no persistent
 *  volume, so the encrypted blobs live in this table — values never stored plaintext). */
export const secureConfig = pgTable("secure_config", {
  name: text("name").primaryKey(),
  payload: text("payload").notNull(), // base64(iv|tag|ciphertext)
  updatedAt: text("updated_at").notNull(),
});

export const releases = pgTable(
  "releases",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // 'overture' | 'fsq'
    releaseId: text("release_id").notNull(),
    status: text("status").notNull().default("pending"), // pending|active|previous|failed
    states: jsonb("states").$type<string[]>(),
    rowCounts: jsonb("row_counts").$type<Record<string, number>>(),
    gateReport: jsonb("gate_report"),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [uniqueIndex("releases_source_release").on(t.source, t.releaseId)],
);

export const placesOverture = pgTable(
  "places_overture",
  {
    gersId: text("gers_id").primaryKey(),
    name: text("name").notNull(),
    phones: jsonb("phones").$type<string[]>(),
    websites: jsonb("websites").$type<string[]>(),
    socials: jsonb("socials").$type<string[]>(),
    emails: jsonb("emails").$type<string[]>(),
    street: text("street"),
    city: text("city"),
    region: text("region"), // 'TX'
    postal: text("postal"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    taxonomyPrimary: text("taxonomy_primary"),
    taxonomyAlternates: jsonb("taxonomy_alternates").$type<string[]>(),
    confidence: doublePrecision("confidence"),
    operatingStatus: text("operating_status"),
    releaseId: text("release_id").notNull(),
  },
  (t) => [index("po_region").on(t.region), index("po_taxonomy").on(t.taxonomyPrimary)],
);

export const placesFsq = pgTable(
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
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
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

export const businesses = pgTable(
  "businesses",
  {
    id: serial("id").primaryKey(),
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
    socials: jsonb("socials").$type<string[]>(),
    emails: jsonb("emails").$type<string[]>(),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    taxonomyPrimary: text("taxonomy_primary"),
    taxonomyAlternates: jsonb("taxonomy_alternates").$type<string[]>(),
    confidence: doublePrecision("confidence"),
    operatingStatus: text("operating_status"),
    chain: boolean("chain").notNull().default(false),
    sources: jsonb("sources").$type<BusinessSources>(),
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

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    score: integer("score"),
    scoreReasons: jsonb("score_reasons").$type<ScoreReason[]>(),
    websiteCheck: jsonb("website_check").$type<WebsiteCheck>(),
    pagespeed: jsonb("pagespeed").$type<{ mobileScore: number; lcpMs: number; fetchedAt: string }>(),
    ownerName: text("owner_name"),
    ownerRole: text("owner_role"),
    ownerEvidence: text("owner_evidence"),
    ownerConfidence: text("owner_confidence"), // 'high' | 'low'
    ownerSource: text("owner_source"), // 'heuristic' | 'ai' | 'outscraper'
    ownerCheckedAt: text("owner_checked_at"),
    status: text("status").notNull().default("new"), // new|contacted|interested|not_interested|dnc
    assignee: text("assignee"),
    tags: jsonb("tags").$type<string[]>(),
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

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  niche: text("niche").notNull(),
  confirmedTaxonomy: jsonb("confirmed_taxonomy").$type<string[]>().notNull(),
  states: jsonb("states").$type<string[]>().notNull(),
  cityList: jsonb("city_list").$type<string[]>(),
  filters: jsonb("filters").$type<CampaignFilters>().notNull(),
  caps: jsonb("caps").$type<CampaignCaps>().notNull(),
  smoke: boolean("smoke").notNull().default(false),
  aiOwnerExtraction: boolean("ai_owner_extraction").notNull().default(false),
  topUp: jsonb("top_up").$type<CampaignTopUp>(),
  status: text("status").notNull().default("draft"), // draft|running|paused|completed|canceled|failed
  pauseRequested: boolean("pause_requested").notNull().default(false),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  currentStage: text("current_stage"),
  releaseOverture: text("release_overture"),
  releaseFsq: text("release_fsq"),
  estimate: jsonb("estimate").$type<CampaignEstimate>(),
  spendUSD: doublePrecision("spend_usd").notNull().default(0),
  stageCounts: jsonb("stage_counts").$type<Record<string, number>>(),
  stageErrors: jsonb("stage_errors").$type<Record<string, number>>(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const campaignLeads = pgTable(
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

export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
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

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    status: text("status").notNull().default("pending"), // pending|running|completed|failed|canceled
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    progress: jsonb("progress"),
    campaignId: integer("campaign_id"),
    runAfter: text("run_after"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
  },
  (t) => [index("jobs_status").on(t.status, t.runAfter), index("jobs_campaign").on(t.campaignId)],
);

export const intents = pgTable(
  "intents",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    queryHash: text("query_hash").notNull(),
    query: jsonb("query"),
    campaignId: integer("campaign_id"),
    status: text("status").notNull().default("planned"), // planned|submitted|fetched|abandoned|stalled
    providerJobId: text("provider_job_id"),
    estCostUSD: doublePrecision("est_cost_usd").notNull().default(0),
    actualCostUSD: doublePrecision("actual_cost_usd"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("intents_hash").on(t.queryHash), index("intents_campaign").on(t.campaignId)],
);

export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    campaignId: integer("campaign_id"),
    amountUSD: doublePrecision("amount_usd").notNull(),
    kind: text("kind").notNull(), // 'actual' | 'estimated'
    detail: text("detail"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("spend_campaign").on(t.campaignId), index("spend_created").on(t.createdAt)],
);

export const quotaUsage = pgTable(
  "quota_usage",
  {
    provider: text("provider").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD UTC
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.day] })],
);

// ---------- suppression / audit / taxonomy / caches ----------

export const suppressions = pgTable(
  "suppressions",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // 'client' | 'dnc'
    phone: text("phone"),
    domain: text("domain"),
    note: text("note"),
    source: text("source"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("sup_kind_phone").on(t.kind, t.phone), uniqueIndex("sup_kind_domain").on(t.kind, t.domain)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_created").on(t.createdAt)],
);

export const taxonomyMappings = pgTable("taxonomy_mappings", {
  niche: text("niche").primaryKey(), // normalized
  taxonomySet: jsonb("taxonomy_set").$type<string[]>().notNull(),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: text("confirmed_at").notNull(),
  timesUsed: integer("times_used").notNull().default(0),
});

export const pagespeedCache = pgTable("pagespeed_cache", {
  domain: text("domain").primaryKey(),
  mobileScore: integer("mobile_score").notNull(),
  lcpMs: integer("lcp_ms").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

export const chains = pgTable("chains", {
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

export const exportsTable = pgTable(
  "exports",
  {
    id: serial("id").primaryKey(),
    format: text("format").notNull(), // 'xlsx' | 'csv'
    params: jsonb("params").$type<ExportParams>().notNull(),
    status: text("status").notNull().default("pending"), // pending|running|completed|failed
    path: text("path"), // local path, or 'supabase:<object-path>' when stored in Supabase Storage
    rowCount: integer("row_count"),
    driveLink: text("drive_link"),
    requestedBy: text("requested_by").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("exports_created").on(t.createdAt)],
);
