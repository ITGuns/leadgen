CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gers_id` text,
	`identity_key` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`phone` text,
	`phone_source` text,
	`website_raw` text,
	`website_normalized` text,
	`website_source` text,
	`website_class` text DEFAULT 'unknown' NOT NULL,
	`socials` text,
	`emails` text,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`lat` real,
	`lng` real,
	`taxonomy_primary` text,
	`taxonomy_alternates` text,
	`confidence` real,
	`operating_status` text,
	`chain` integer DEFAULT false NOT NULL,
	`sources` text,
	`first_seen_release` text,
	`last_seen_release` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `biz_identity` ON `businesses` (`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `biz_gers` ON `businesses` (`gers_id`);--> statement-breakpoint
CREATE INDEX `biz_region` ON `businesses` (`region`);--> statement-breakpoint
CREATE INDEX `biz_taxonomy` ON `businesses` (`taxonomy_primary`);--> statement-breakpoint
CREATE INDEX `biz_phone` ON `businesses` (`phone`);--> statement-breakpoint
CREATE INDEX `biz_domain` ON `businesses` (`website_normalized`);--> statement-breakpoint
CREATE INDEX `biz_normname` ON `businesses` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `campaign_leads` (
	`campaign_id` integer NOT NULL,
	`lead_id` integer NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`campaign_id`, `lead_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cl_lead` ON `campaign_leads` (`lead_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`niche` text NOT NULL,
	`confirmed_taxonomy` text NOT NULL,
	`states` text NOT NULL,
	`city_list` text,
	`filters` text NOT NULL,
	`caps` text NOT NULL,
	`smoke` integer DEFAULT false NOT NULL,
	`ai_owner_extraction` integer DEFAULT false NOT NULL,
	`top_up` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`pause_requested` integer DEFAULT false NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`current_stage` text,
	`release_overture` text,
	`release_fsq` text,
	`estimate` text,
	`spend_usd` real DEFAULT 0 NOT NULL,
	`stage_counts` text,
	`stage_errors` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `chains` (
	`name_normalized` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`state_count` integer,
	`flagged_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`format` text NOT NULL,
	`params` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`path` text,
	`row_count` integer,
	`drive_link` text,
	`requested_by` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `exports_created` ON `exports` (`created_at`);--> statement-breakpoint
CREATE TABLE `intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`query_hash` text NOT NULL,
	`query` text,
	`campaign_id` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`provider_job_id` text,
	`est_cost_usd` real DEFAULT 0 NOT NULL,
	`actual_cost_usd` real,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intents_hash` ON `intents` (`query_hash`);--> statement-breakpoint
CREATE INDEX `intents_campaign` ON `intents` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`last_error` text,
	`progress` text,
	`campaign_id` integer,
	`run_after` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`heartbeat_at` text
);
--> statement-breakpoint
CREATE INDEX `jobs_status` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_campaign` ON `jobs` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`score` integer,
	`score_reasons` text,
	`website_check` text,
	`pagespeed` text,
	`owner_name` text,
	`owner_role` text,
	`owner_evidence` text,
	`owner_confidence` text,
	`owner_source` text,
	`status` text DEFAULT 'new' NOT NULL,
	`assignee` text,
	`tags` text,
	`last_verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_business` ON `leads` (`business_id`);--> statement-breakpoint
CREATE INDEX `leads_status` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_score` ON `leads` (`score`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notes_lead` ON `notes` (`lead_id`);--> statement-breakpoint
CREATE TABLE `pagespeed_cache` (
	`domain` text PRIMARY KEY NOT NULL,
	`mobile_score` integer NOT NULL,
	`lcp_ms` integer NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `places_fsq` (
	`fsq_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tel` text,
	`website` text,
	`email` text,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`lat` real,
	`lng` real,
	`matched_gers_id` text,
	`release_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pf_region` ON `places_fsq` (`region`);--> statement-breakpoint
CREATE TABLE `places_overture` (
	`gers_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phones` text,
	`websites` text,
	`socials` text,
	`emails` text,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`lat` real,
	`lng` real,
	`taxonomy_primary` text,
	`taxonomy_alternates` text,
	`confidence` real,
	`operating_status` text,
	`release_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `po_region` ON `places_overture` (`region`);--> statement-breakpoint
CREATE INDEX `po_taxonomy` ON `places_overture` (`taxonomy_primary`);--> statement-breakpoint
CREATE TABLE `quota_usage` (
	`provider` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `day`)
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`release_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`states` text,
	`row_counts` text,
	`gate_report` text,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_source_release` ON `releases` (`source`,`release_id`);--> statement-breakpoint
CREATE TABLE `spend_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`campaign_id` integer,
	`amount_usd` real NOT NULL,
	`kind` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spend_campaign` ON `spend_ledger` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `spend_created` ON `spend_ledger` (`created_at`);--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`phone` text,
	`domain` text,
	`note` text,
	`source` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sup_kind_phone` ON `suppressions` (`kind`,`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `sup_kind_domain` ON `suppressions` (`kind`,`domain`);--> statement-breakpoint
CREATE TABLE `taxonomy_mappings` (
	`niche` text PRIMARY KEY NOT NULL,
	`taxonomy_set` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`times_used` integer DEFAULT 0 NOT NULL
);
