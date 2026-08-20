ALTER TABLE "alert_records"
  ADD COLUMN IF NOT EXISTS "sector_leader_context" jsonb;