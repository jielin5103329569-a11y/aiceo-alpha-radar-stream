ALTER TABLE "shadow_learning_price_observations"
  ADD COLUMN IF NOT EXISTS "context_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "shadow_learning_outcomes"
  ADD COLUMN IF NOT EXISTS "stage_outcome" jsonb;