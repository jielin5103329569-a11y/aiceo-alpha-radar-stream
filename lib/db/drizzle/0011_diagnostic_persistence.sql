ALTER TABLE "runtime_supervisor_incidents" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'runtime' NOT NULL;
--> statement-breakpoint
ALTER TABLE "runtime_supervisor_incidents" ADD COLUMN IF NOT EXISTS "diagnostic_payload" jsonb;
--> statement-breakpoint
ALTER TABLE "runtime_supervisor_audit" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'runtime' NOT NULL;
--> statement-breakpoint
ALTER TABLE "runtime_supervisor_audit" ADD COLUMN IF NOT EXISTS "diagnostic_payload" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_supervisor_incidents_source_observed_idx" ON "runtime_supervisor_incidents" USING btree ("source", "last_observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_supervisor_audit_source_occurred_idx" ON "runtime_supervisor_audit" USING btree ("source", "occurred_at");