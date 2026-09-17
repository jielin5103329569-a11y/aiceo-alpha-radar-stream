CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS "aiceo_memory_chain_heads" (
  "project_id" uuid PRIMARY KEY REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "head_hash" varchar(128),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "aiceo_memory_candidates" DROP CONSTRAINT IF EXISTS "aiceo_memory_candidate_lifecycle_check";
ALTER TABLE "aiceo_memory_candidates" ADD CONSTRAINT "aiceo_memory_candidate_lifecycle_check"
 CHECK (lifecycle IN ('candidate','promoted','superseded','expired','rejected'));
CREATE OR REPLACE FUNCTION reject_aiceo_candidate_lifecycle_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.lifecycle <> 'candidate' OR NEW.lifecycle <> 'promoted' THEN
   IF OLD.lifecycle IS DISTINCT FROM NEW.lifecycle THEN RAISE EXCEPTION 'Invalid candidate lifecycle transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_candidate_lifecycle_transition ON aiceo_memory_candidates;
CREATE TRIGGER aiceo_candidate_lifecycle_transition BEFORE UPDATE OF lifecycle ON aiceo_memory_candidates
 FOR EACH ROW EXECUTE FUNCTION reject_aiceo_candidate_lifecycle_transition();
ALTER TABLE "aiceo_promoted_memories" DROP CONSTRAINT IF EXISTS "aiceo_promoted_memory_project_consistency";
ALTER TABLE "aiceo_promoted_memories" ADD CONSTRAINT "aiceo_promoted_memory_project_consistency"
 CHECK (project_id = candidate_project_id);