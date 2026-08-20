CREATE TABLE "autonomous_operations_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_key" varchar(160),
	"event" varchar(48) NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autonomous_operations_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_key" varchar(160) NOT NULL,
	"title" varchar(200) NOT NULL,
	"owner_module" varchar(120) NOT NULL,
	"implementation_key" varchar(160) NOT NULL,
	"state" varchar(32) NOT NULL,
	"depends_on" jsonb NOT NULL,
	"resource_claims" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"retry_base_delay_ms" integer NOT NULL,
	"execution_timeout_ms" integer NOT NULL,
	"next_run_at" timestamp with time zone,
	"run_id" varchar(200),
	"lease_expires_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"checkpoint" jsonb,
	"verification_evidence" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "autonomous_operations_audit_work_occurred_idx" ON "autonomous_operations_audit" USING btree ("work_key","occurred_at");
--> statement-breakpoint
CREATE INDEX "autonomous_operations_audit_occurred_idx" ON "autonomous_operations_audit" USING btree ("occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "autonomous_operations_work_key_unique" ON "autonomous_operations_work_items" USING btree ("work_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "autonomous_operations_implementation_key_unique" ON "autonomous_operations_work_items" USING btree ("implementation_key");
--> statement-breakpoint
CREATE INDEX "autonomous_operations_work_state_next_run_idx" ON "autonomous_operations_work_items" USING btree ("state","next_run_at");