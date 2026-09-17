CREATE TABLE IF NOT EXISTS "aiceo_collaboration_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "category" varchar(64) NOT NULL,
  "summary" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "context" jsonb NOT NULL,
  "root_cause" text,
  "desired_behavior" text,
  "status" varchar(32) NOT NULL DEFAULT 'CAPTURED',
  "occurrence_count" integer NOT NULL DEFAULT 1,
  "first_observed_at" timestamptz NOT NULL DEFAULT now(),
  "last_observed_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" varchar(180) NOT NULL,
  CONSTRAINT "aiceo_collaboration_issue_category_check" CHECK (category IN (
    'communication_bottleneck','execution_friction','repeated_error','capability_gap',
    'owner_time_waste','incorrect_pause','continuity_problem','other'
  )),
  CONSTRAINT "aiceo_collaboration_issue_status_check" CHECK (status IN (
    'CAPTURED','ANALYZED','CANDIDATE_DEFINED','OWNER_GATE','ACTIVE','VALIDATING','IMPROVED','REJECTED','ROLLED_BACK'
  )),
  CONSTRAINT "aiceo_collaboration_issue_evidence_check" CHECK (jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)>0),
  CONSTRAINT "aiceo_collaboration_issue_context_check" CHECK (jsonb_typeof(context)='object')
);
CREATE INDEX IF NOT EXISTS "aiceo_collaboration_issue_status_idx" ON "aiceo_collaboration_issues" ("status","last_observed_at");

CREATE TABLE IF NOT EXISTS "aiceo_collaboration_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "issue_id" uuid NOT NULL REFERENCES "aiceo_collaboration_issues"("id") ON DELETE RESTRICT,
  "rule_key" varchar(120) NOT NULL,
  "version" integer NOT NULL,
  "rule_text" text NOT NULL,
  "source" text NOT NULL,
  "reason" text NOT NULL,
  "scope" jsonb NOT NULL,
  "classification" varchar(32) NOT NULL,
  "conflict_check" jsonb NOT NULL,
  "status" varchar(32) NOT NULL,
  "validation_result" jsonb,
  "supersedes_rule_id" uuid REFERENCES "aiceo_collaboration_rules"("id") ON DELETE RESTRICT,
  "rollback_of_rule_id" uuid REFERENCES "aiceo_collaboration_rules"("id") ON DELETE RESTRICT,
  "activated_at" timestamptz,
  "rolled_back_at" timestamptz,
  "created_by" varchar(180) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_collaboration_rule_classification_check" CHECK (classification IN ('ordinary_collaboration','owner_protection')),
  CONSTRAINT "aiceo_collaboration_rule_status_check" CHECK (status IN ('CANDIDATE','OWNER_GATE','ACTIVE','VALIDATING','IMPROVED','REJECTED','ROLLED_BACK')),
  CONSTRAINT "aiceo_collaboration_rule_scope_check" CHECK (jsonb_typeof(scope)='object'),
  CONSTRAINT "aiceo_collaboration_rule_conflict_check" CHECK (jsonb_typeof(conflict_check)='object'),
  CONSTRAINT "aiceo_collaboration_owner_gate_check" CHECK (classification <> 'owner_protection' OR status IN ('OWNER_GATE','REJECTED')),
  UNIQUE(project_id,rule_key,version)
);
CREATE INDEX IF NOT EXISTS "aiceo_collaboration_rule_status_idx" ON "aiceo_collaboration_rules" ("status","created_at");

CREATE OR REPLACE FUNCTION reject_aiceo_collaboration_rule_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.issue_id IS DISTINCT FROM NEW.issue_id
    OR OLD.rule_key IS DISTINCT FROM NEW.rule_key OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.rule_text IS DISTINCT FROM NEW.rule_text OR OLD.source IS DISTINCT FROM NEW.source
    OR OLD.reason IS DISTINCT FROM NEW.reason OR OLD.scope IS DISTINCT FROM NEW.scope
    OR OLD.classification IS DISTINCT FROM NEW.classification OR OLD.conflict_check IS DISTINCT FROM NEW.conflict_check
  THEN RAISE EXCEPTION 'AICEO collaboration rule identity is immutable; create a new version';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS "aiceo_collaboration_rule_identity_immutable" ON "aiceo_collaboration_rules";
CREATE TRIGGER "aiceo_collaboration_rule_identity_immutable" BEFORE UPDATE ON "aiceo_collaboration_rules"
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_collaboration_rule_identity_mutation();