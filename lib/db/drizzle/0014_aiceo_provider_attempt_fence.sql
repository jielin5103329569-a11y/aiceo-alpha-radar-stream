ALTER TABLE "aiceo_tasks"
  ADD COLUMN IF NOT EXISTS "provider_attempt_id" uuid,
  ADD COLUMN IF NOT EXISTS "provider_attempt_deadline_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "aiceo_tasks_provider_attempt_deadline_idx"
  ON "aiceo_tasks" ("provider_attempt_deadline_at")
  WHERE "state" = 'RUNNING' AND "provider_attempt_id" IS NOT NULL;