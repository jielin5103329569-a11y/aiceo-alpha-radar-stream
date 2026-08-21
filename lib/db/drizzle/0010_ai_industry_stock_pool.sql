CREATE TABLE "ai_industry_pool_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_version" varchar(80) NOT NULL,
	"catalog_hash" varchar(128) NOT NULL,
	"active_count" integer NOT NULL,
	"historical_distinct_count" integer NOT NULL,
	"capacity" integer NOT NULL,
	"capacity_state" varchar(32) NOT NULL,
	"reference_authorization_state" varchar(32) NOT NULL,
	"reference_reason" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_industry_pool_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"security_identifier" varchar(128),
	"categories" jsonb NOT NULL,
	"membership_state" varchar(32) NOT NULL,
	"sector_review_state" varchar(48) NOT NULL,
	"entry_reason" text NOT NULL,
	"exit_reason" text,
	"strategy_version" varchar(80) NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_industry_pool_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(180) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_industry_reference_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_identifier" varchar(128) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"successful_lookup_count" integer DEFAULT 0 NOT NULL,
	"last_outcome" varchar(48) NOT NULL,
	"last_reason" text NOT NULL,
	"first_requested_at" timestamp with time zone NOT NULL,
	"last_requested_at" timestamp with time zone NOT NULL,
	"last_successful_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_industry_pool_snapshots_catalog_hash_unique" ON "ai_industry_pool_snapshots" USING btree ("catalog_hash");
--> statement-breakpoint
CREATE INDEX "ai_industry_pool_snapshots_generated_at_idx" ON "ai_industry_pool_snapshots" USING btree ("generated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_industry_pool_members_symbol_unique" ON "ai_industry_pool_members" USING btree ("symbol");
--> statement-breakpoint
CREATE INDEX "ai_industry_pool_members_state_idx" ON "ai_industry_pool_members" USING btree ("membership_state","last_observed_at");
--> statement-breakpoint
CREATE INDEX "ai_industry_pool_members_identifier_idx" ON "ai_industry_pool_members" USING btree ("security_identifier");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_industry_pool_events_event_key_unique" ON "ai_industry_pool_events" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX "ai_industry_pool_events_symbol_occurred_idx" ON "ai_industry_pool_events" USING btree ("symbol","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_industry_reference_usage_identifier_unique" ON "ai_industry_reference_usage" USING btree ("security_identifier");
--> statement-breakpoint
CREATE INDEX "ai_industry_reference_usage_outcome_idx" ON "ai_industry_reference_usage" USING btree ("last_outcome","last_requested_at");