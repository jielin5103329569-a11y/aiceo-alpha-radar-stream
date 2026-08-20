ALTER TABLE "shadow_learning_price_observations"
  ADD COLUMN IF NOT EXISTS "record_hash" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "shadow_learning_outcomes"
  ADD COLUMN IF NOT EXISTS "record_hash" text NOT NULL DEFAULT '';