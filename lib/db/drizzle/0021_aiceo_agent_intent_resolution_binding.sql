ALTER TABLE "aiceo_agent_runs"
  ADD COLUMN IF NOT EXISTS "intent_resolution_confirmation_id" uuid
  REFERENCES "aiceo_intent_confirmations"("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_agent_run_intent_resolution_confirmation_unique"
  ON "aiceo_agent_runs" ("intent_resolution_confirmation_id")
  WHERE "intent_resolution_confirmation_id" IS NOT NULL;