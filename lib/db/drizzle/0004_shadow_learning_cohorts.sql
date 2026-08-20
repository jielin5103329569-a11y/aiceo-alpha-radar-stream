ALTER TABLE "shadow_learning_triggers"
  ADD COLUMN IF NOT EXISTS "cohort_key" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "shadow_learning_triggers"
  ADD COLUMN IF NOT EXISTS "cohort_eligibility_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shadow_learning_triggers_cohort_idx"
  ON "shadow_learning_triggers" ("cohort_key");