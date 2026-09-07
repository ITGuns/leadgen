CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"gers_id" text,
	"identity_key" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"phone" text,
	"phone_source" text,
	"website_raw" text,
	"website_normalized" text,
	"website_source" text,
	"website_class" text DEFAULT 'unknown' NOT NULL,
	"socials" jsonb,
	"emails" jsonb,
	"street" text,
	"city" text,
	"region" text,
	"postal" text,
	"lat" double precision,
	"lng" double precision,
	"taxonomy_primary" text,
	"taxonomy_alternates" jsonb,
	"confidence" double precision,
	"operating_status" text,
	"chain" boolean DEFAULT false NOT NULL,
	"sources" jsonb,
	"first_seen_release" text,
	"last_seen_release" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"campaign_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"added_at" text NOT NULL,
	CONSTRAINT "campaign_leads_campaign_id_lead_id_pk" PRIMARY KEY("campaign_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"confirmed_taxonomy" jsonb NOT NULL,
	"states" jsonb NOT NULL,
	"city_list" jsonb,
	"filters" jsonb NOT NULL,
	"caps" jsonb NOT NULL,
	"smoke" boolean DEFAULT false NOT NULL,
	"ai_owner_extraction" boolean DEFAULT false NOT NULL,
	"top_up" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"pause_requested" boolean DEFAULT false NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"current_stage" text,
	"release_overture" text,
	"release_fsq" text,
	"estimate" jsonb,
	"spend_usd" double precision DEFAULT 0 NOT NULL,
	"stage_counts" jsonb,
	"stage_errors" jsonb,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"started_at" text,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"name_normalized" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"state_count" integer,
	"flagged_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"format" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"path" text,
	"row_count" integer,
	"drive_link" text,
	"requested_by" text NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"query_hash" text NOT NULL,
	"query" jsonb,
	"campaign_id" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"provider_job_id" text,
	"est_cost_usd" double precision DEFAULT 0 NOT NULL,
	"actual_cost_usd" double precision,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"progress" jsonb,
	"campaign_id" integer,
	"run_after" text,
	"created_at" text NOT NULL,
	"started_at" text,
	"finished_at" text,
	"heartbeat_at" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"score" integer,
	"score_reasons" jsonb,
	"website_check" jsonb,
	"pagespeed" jsonb,
	"owner_name" text,
	"owner_role" text,
	"owner_evidence" text,
	"owner_confidence" text,
	"owner_source" text,
	"owner_checked_at" text,
	"status" text DEFAULT 'new' NOT NULL,
	"assignee" text,
	"tags" jsonb,
	"last_verified_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagespeed_cache" (
	"domain" text PRIMARY KEY NOT NULL,
	"mobile_score" integer NOT NULL,
	"lcp_ms" integer NOT NULL,
	"fetched_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places_fsq" (
	"fsq_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tel" text,
	"website" text,
	"email" text,
	"street" text,
	"city" text,
	"region" text,
	"postal" text,
	"lat" double precision,
	"lng" double precision,
	"matched_gers_id" text,
	"release_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places_overture" (
	"gers_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phones" jsonb,
	"websites" jsonb,
	"socials" jsonb,
	"emails" jsonb,
	"street" text,
	"city" text,
	"region" text,
	"postal" text,
	"lat" double precision,
	"lng" double precision,
	"taxonomy_primary" text,
	"taxonomy_alternates" jsonb,
	"confidence" double precision,
	"operating_status" text,
	"release_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"provider" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quota_usage_provider_day_pk" PRIMARY KEY("provider","day")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"release_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"states" jsonb,
	"row_counts" jsonb,
	"gate_report" jsonb,
	"error" text,
	"started_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "secure_config" (
	"name" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"campaign_id" integer,
	"amount_usd" double precision NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"phone" text,
	"domain" text,
	"note" text,
	"source" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_mappings" (
	"niche" text PRIMARY KEY NOT NULL,
	"taxonomy_set" jsonb NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" text NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "biz_identity" ON "businesses" USING btree ("identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "biz_gers" ON "businesses" USING btree ("gers_id");--> statement-breakpoint
CREATE INDEX "biz_region" ON "businesses" USING btree ("region");--> statement-breakpoint
CREATE INDEX "biz_taxonomy" ON "businesses" USING btree ("taxonomy_primary");--> statement-breakpoint
CREATE INDEX "biz_phone" ON "businesses" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "biz_domain" ON "businesses" USING btree ("website_normalized");--> statement-breakpoint
CREATE INDEX "biz_normname" ON "businesses" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "cl_lead" ON "campaign_leads" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "exports_created" ON "exports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intents_hash" ON "intents" USING btree ("query_hash");--> statement-breakpoint
CREATE INDEX "intents_campaign" ON "intents" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "jobs_status" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_campaign" ON "jobs" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_business" ON "leads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "leads_status" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_score" ON "leads" USING btree ("score");--> statement-breakpoint
CREATE INDEX "notes_lead" ON "notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "pf_region" ON "places_fsq" USING btree ("region");--> statement-breakpoint
CREATE INDEX "po_region" ON "places_overture" USING btree ("region");--> statement-breakpoint
CREATE INDEX "po_taxonomy" ON "places_overture" USING btree ("taxonomy_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_source_release" ON "releases" USING btree ("source","release_id");--> statement-breakpoint
CREATE INDEX "spend_campaign" ON "spend_ledger" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "spend_created" ON "spend_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sup_kind_phone" ON "suppressions" USING btree ("kind","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "sup_kind_domain" ON "suppressions" USING btree ("kind","domain");