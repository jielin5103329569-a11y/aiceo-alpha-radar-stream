CREATE TABLE IF NOT EXISTS "runtime_supervisor_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_key" varchar(160) NOT NULL,
  "component" varchar(64) NOT NULL,
  "reason_code" varchar(96) NOT NULL,
  "severity" varchar(16) NOT NULL,
  "state" varchar(16) NOT NULL,
  "first_detected_at" timestamp with time zone NOT NULL,
  "last_observed_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "evidence" jsonb NOT NULL,
  "last_recovery" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runtime_supervisor_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_key" varchar(160) NOT NULL,
  "component" varchar(64) NOT NULL,
  "reason_code" varchar(96) NOT NULL,
  "event" varchar(40) NOT NULL,
  "severity" varchar(16) NOT NULL,
  "reason" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "recovery" jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_supervisor_incident_key_unique" ON "runtime_supervisor_incidents" USING btree ("incident_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_supervisor_incidents_state_observed_idx" ON "runtime_supervisor_incidents" USING btree ("state", "last_observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_supervisor_incidents_component_observed_idx" ON "runtime_supervisor_incidents" USING btree ("component", "last_observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_supervisor_audit_incident_occurred_idx" ON "runtime_supervisor_audit" USING btree ("incident_key", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_supervisor_audit_occurred_idx" ON "runtime_supervisor_audit" USING btree ("occurred_at");