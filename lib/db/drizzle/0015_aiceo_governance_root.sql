ALTER TABLE "aiceo_tasks"
  ADD COLUMN IF NOT EXISTS "governance_classification" varchar(40),
  ADD COLUMN IF NOT EXISTS "owner_protection_red_lines" jsonb,
  ADD COLUMN IF NOT EXISTS "owner_governance_approved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "owner_governance_approved_by" varchar(180),
  ADD COLUMN IF NOT EXISTS "owner_governance_approval_hash" varchar(128);

UPDATE "aiceo_tasks"
SET "governance_classification" = 'legacy_unclassified',
    "owner_protection_red_lines" = '[]'::jsonb
WHERE "governance_classification" IS NULL;

ALTER TABLE "aiceo_tasks"
  ALTER COLUMN "governance_classification" SET NOT NULL,
  ALTER COLUMN "owner_protection_red_lines" SET NOT NULL;

ALTER TABLE "aiceo_tasks"
  ADD CONSTRAINT "aiceo_tasks_governance_classification_check"
    CHECK ("governance_classification" IN ('ordinary_technical', 'owner_protection', 'legacy_unclassified')),
  ADD CONSTRAINT "aiceo_tasks_development_authority_check"
    CHECK ("environment" = 'development' AND "authority" = 'grok_restricted_development'),
  ADD CONSTRAINT "aiceo_tasks_owner_approval_complete_check"
    CHECK (
      ("owner_governance_approved_at" IS NULL AND "owner_governance_approved_by" IS NULL AND "owner_governance_approval_hash" IS NULL)
      OR
      ("governance_classification" = 'owner_protection'
       AND "owner_governance_approved_at" IS NOT NULL
       AND "owner_governance_approved_by" IS NOT NULL
       AND "owner_governance_approval_hash" IS NOT NULL)
    ),
  ADD CONSTRAINT "aiceo_tasks_ordinary_has_no_red_lines_check"
    CHECK ("governance_classification" = 'owner_protection' OR "owner_protection_red_lines" = '[]'::jsonb),
  ADD CONSTRAINT "aiceo_tasks_owner_protection_has_red_lines_check"
    CHECK ("governance_classification" <> 'owner_protection' OR jsonb_array_length("owner_protection_red_lines") > 0),
  ADD CONSTRAINT "aiceo_tasks_owner_red_lines_allowlist_check"
    CHECK (
      jsonb_typeof("owner_protection_red_lines") = 'array'
      AND "owner_protection_red_lines" <@ '[
        "financial_and_physical_assets",
        "legal_liability",
        "aiceo_system_integrity"
      ]'::jsonb
    );

CREATE OR REPLACE FUNCTION reject_aiceo_governance_authority_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.environment IS DISTINCT FROM NEW.environment
    OR OLD.authority IS DISTINCT FROM NEW.authority
    OR OLD.action IS DISTINCT FROM NEW.action
    OR OLD.resource IS DISTINCT FROM NEW.resource
    OR OLD.permissions IS DISTINCT FROM NEW.permissions
    OR OLD.source_id IS DISTINCT FROM NEW.source_id
    OR OLD.policy_id IS DISTINCT FROM NEW.policy_id
    OR OLD.contract_version IS DISTINCT FROM NEW.contract_version
    OR OLD.contract_hash IS DISTINCT FROM NEW.contract_hash
    OR OLD.governance_classification IS DISTINCT FROM NEW.governance_classification
    OR OLD.owner_protection_red_lines IS DISTINCT FROM NEW.owner_protection_red_lines
    OR (OLD.owner_governance_approved_at IS NOT NULL AND OLD.owner_governance_approved_at IS DISTINCT FROM NEW.owner_governance_approved_at)
    OR (OLD.owner_governance_approved_by IS NOT NULL AND OLD.owner_governance_approved_by IS DISTINCT FROM NEW.owner_governance_approved_by)
    OR (OLD.owner_governance_approval_hash IS NOT NULL AND OLD.owner_governance_approval_hash IS DISTINCT FROM NEW.owner_governance_approval_hash)
  THEN
    RAISE EXCEPTION 'AICEO Governance Root authority and approval evidence are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "aiceo_tasks_governance_authority_immutable" ON "aiceo_tasks";
CREATE TRIGGER "aiceo_tasks_governance_authority_immutable"
BEFORE UPDATE ON "aiceo_tasks"
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_governance_authority_mutation();