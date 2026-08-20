ALTER TABLE "alert_records"
  ADD COLUMN IF NOT EXISTS "sector" varchar(160);
--> statement-breakpoint
ALTER TABLE "alert_records"
  ADD COLUMN IF NOT EXISTS "industry" varchar(160);