CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS "aiceo_memory_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "project_id" uuid NOT NULL,
  "content" text NOT NULL, "memory_layer" varchar(24) NOT NULL, "memory_type" varchar(24) NOT NULL,
  "cognitive_state" varchar(24) NOT NULL, "truth_level" varchar(24) NOT NULL DEFAULT 'unverified',
  "authority_level" varchar(24) NOT NULL, "source_actor_id" varchar(180) NOT NULL,
  "evidence_lineage" jsonb NOT NULL, "valid_from" timestamptz, "valid_until" timestamptz,
  "lifecycle" varchar(24) NOT NULL DEFAULT 'candidate', "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "aiceo_memory_candidate_project_idx" ON "aiceo_memory_candidates" ("project_id","created_at");
CREATE TABLE IF NOT EXISTS "aiceo_promoted_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "candidate_id" uuid NOT NULL UNIQUE,
  "project_id" uuid NOT NULL, "content" text NOT NULL, "memory_layer" varchar(24) NOT NULL,
  "memory_type" varchar(24) NOT NULL, "cognitive_state" varchar(24) NOT NULL, "truth_level" varchar(24) NOT NULL,
  "authority_level" varchar(24) NOT NULL, "evidence_lineage" jsonb NOT NULL, "valid_from" timestamptz,
  "valid_until" timestamptz, "promoted_by" varchar(180) NOT NULL, "production_authority" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "aiceo_promoted_memory_project_idx" ON "aiceo_promoted_memories" ("project_id","created_at");
ALTER TABLE "aiceo_memory_candidates" DROP CONSTRAINT IF EXISTS "aiceo_memory_candidate_id_project_unique";
ALTER TABLE "aiceo_memory_candidates" ADD CONSTRAINT "aiceo_memory_candidate_id_project_unique" UNIQUE ("id","project_id");
ALTER TABLE "aiceo_promoted_memories" ADD COLUMN IF NOT EXISTS "candidate_project_id" uuid;
UPDATE "aiceo_promoted_memories" SET "candidate_project_id" = "project_id" WHERE "candidate_project_id" IS NULL;
ALTER TABLE "aiceo_promoted_memories" ALTER COLUMN "candidate_project_id" SET NOT NULL;
ALTER TABLE "aiceo_promoted_memories" DROP CONSTRAINT IF EXISTS "aiceo_promoted_memory_candidate_project_fk";
ALTER TABLE "aiceo_promoted_memories" ADD CONSTRAINT "aiceo_promoted_memory_candidate_project_fk"
  FOREIGN KEY ("candidate_id","candidate_project_id") REFERENCES "aiceo_memory_candidates"("id","project_id") ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS "aiceo_memory_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "project_id" uuid NOT NULL, "candidate_id" uuid,
  "promoted_memory_id" uuid, "event_type" varchar(40) NOT NULL, "actor_id" varchar(180) NOT NULL,
  "actor_authority" varchar(24) NOT NULL, "payload" jsonb NOT NULL, "previous_hash" varchar(128),
  "event_hash" varchar(128) NOT NULL UNIQUE, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "aiceo_memory_event_project_idx" ON "aiceo_memory_events" ("project_id","created_at");
ALTER TABLE "aiceo_memory_candidates" DROP CONSTRAINT IF EXISTS "aiceo_memory_candidate_enum_check";
ALTER TABLE "aiceo_memory_candidates" ADD CONSTRAINT "aiceo_memory_candidate_enum_check" CHECK (
  memory_layer IN ('working','episodic','semantic','procedural','governance')
  AND memory_type IN ('observation','fact','interpretation','hypothesis','decision','rule')
  AND cognitive_state IN ('observation','fact','interpretation','hypothesis','decision','rule')
  AND truth_level IN ('unverified','supported','verified','owner_asserted')
  AND authority_level IN ('ordinary_agent','external_source','brain','owner','governance')
  AND lifecycle IN ('candidate','promoted','superseded','expired','rejected')
);
ALTER TABLE "aiceo_promoted_memories" ADD CONSTRAINT "aiceo_promoted_memory_no_production_check" CHECK ("production_authority" = false);
ALTER TABLE "aiceo_promoted_memories" DROP CONSTRAINT IF EXISTS "aiceo_promoted_memory_enum_check";
ALTER TABLE "aiceo_promoted_memories" ADD CONSTRAINT "aiceo_promoted_memory_enum_check" CHECK (
  memory_layer IN ('working','episodic','semantic','procedural','governance')
  AND memory_type IN ('observation','fact','interpretation','hypothesis','decision','rule')
  AND cognitive_state IN ('observation','fact','interpretation','hypothesis','decision','rule')
  AND truth_level IN ('unverified','supported','verified','owner_asserted')
  AND authority_level IN ('ordinary_agent','external_source','brain','owner','governance')
);
CREATE OR REPLACE FUNCTION reject_aiceo_memory_candidate_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.content IS DISTINCT FROM NEW.content
    OR OLD.memory_layer IS DISTINCT FROM NEW.memory_layer OR OLD.memory_type IS DISTINCT FROM NEW.memory_type
    OR OLD.cognitive_state IS DISTINCT FROM NEW.cognitive_state OR OLD.truth_level IS DISTINCT FROM NEW.truth_level
    OR OLD.authority_level IS DISTINCT FROM NEW.authority_level OR OLD.source_actor_id IS DISTINCT FROM NEW.source_actor_id
    OR OLD.evidence_lineage IS DISTINCT FROM NEW.evidence_lineage OR OLD.valid_from IS DISTINCT FROM NEW.valid_from
    OR OLD.valid_until IS DISTINCT FROM NEW.valid_until
  THEN RAISE EXCEPTION 'AICEO candidate content and provenance are immutable'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_candidate_immutable ON aiceo_memory_candidates;
CREATE TRIGGER aiceo_memory_candidate_immutable BEFORE UPDATE ON aiceo_memory_candidates FOR EACH ROW EXECUTE FUNCTION reject_aiceo_memory_candidate_mutation();
CREATE OR REPLACE FUNCTION reject_aiceo_memory_candidate_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AICEO candidates are append-only'; END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_candidate_no_delete ON aiceo_memory_candidates;
CREATE TRIGGER aiceo_memory_candidate_no_delete BEFORE DELETE ON aiceo_memory_candidates FOR EACH ROW EXECUTE FUNCTION reject_aiceo_memory_candidate_delete();
ALTER TABLE "aiceo_memory_candidates" DROP CONSTRAINT IF EXISTS "aiceo_memory_candidate_project_fk";
ALTER TABLE "aiceo_memory_candidates" ADD CONSTRAINT "aiceo_memory_candidate_project_fk"
  FOREIGN KEY ("project_id") REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT;
ALTER TABLE "aiceo_promoted_memories" DROP CONSTRAINT IF EXISTS "aiceo_promoted_memory_project_fk";
ALTER TABLE "aiceo_promoted_memories" ADD CONSTRAINT "aiceo_promoted_memory_project_fk"
  FOREIGN KEY ("project_id") REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT;
ALTER TABLE "aiceo_memory_events" DROP CONSTRAINT IF EXISTS "aiceo_memory_event_project_fk";
ALTER TABLE "aiceo_memory_events" ADD CONSTRAINT "aiceo_memory_event_project_fk"
  FOREIGN KEY ("project_id") REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION reject_aiceo_memory_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Promoted AICEO memory is immutable'; END; $$;
DROP TRIGGER IF EXISTS aiceo_promoted_memory_immutable ON aiceo_promoted_memories;
CREATE TRIGGER aiceo_promoted_memory_immutable BEFORE UPDATE OR DELETE ON aiceo_promoted_memories FOR EACH ROW EXECUTE FUNCTION reject_aiceo_memory_mutation();
CREATE OR REPLACE FUNCTION reject_aiceo_memory_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AICEO memory events are append-only'; END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_event_append_only ON aiceo_memory_events;
CREATE TRIGGER aiceo_memory_event_append_only BEFORE UPDATE OR DELETE ON aiceo_memory_events FOR EACH ROW EXECUTE FUNCTION reject_aiceo_memory_event_mutation();
CREATE OR REPLACE FUNCTION verify_aiceo_memory_event_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text; prior text;
BEGIN
  IF NEW.candidate_id IS NULL AND NEW.promoted_memory_id IS NULL THEN RAISE EXCEPTION 'Memory events must bind a record'; END IF;
  IF NEW.candidate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aiceo_memory_candidates WHERE id=NEW.candidate_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Event candidate binding invalid'; END IF;
  IF NEW.promoted_memory_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aiceo_promoted_memories WHERE id=NEW.promoted_memory_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Event promoted binding invalid'; END IF;
  SELECT event_hash INTO prior FROM aiceo_memory_events WHERE project_id=NEW.project_id ORDER BY created_at DESC LIMIT 1;
  IF NEW.previous_hash IS DISTINCT FROM prior THEN RAISE EXCEPTION 'Memory event chain is not serialized'; END IF;
  expected := encode(digest(NEW.project_id::text || ':' || coalesce(NEW.candidate_id::text,'') || ':' || coalesce(NEW.promoted_memory_id::text,'') || ':' || NEW.event_type || ':' || NEW.actor_id || ':' || NEW.previous_hash || ':' || NEW.payload::text, 'sha256'), 'hex');
  IF NEW.event_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Memory event integrity hash invalid'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_event_verify_insert ON aiceo_memory_events;
CREATE TRIGGER aiceo_memory_event_verify_insert BEFORE INSERT ON aiceo_memory_events FOR EACH ROW EXECUTE FUNCTION verify_aiceo_memory_event_insert();