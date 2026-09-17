ALTER TABLE "aiceo_intent_confirmations"
  ADD COLUMN IF NOT EXISTS "execution_binding_hash" varchar(128);

UPDATE "aiceo_intent_confirmations"
SET "execution_binding_hash" = md5(intent_hash || ':legacy:1') || md5(intent_hash || ':legacy:2')
WHERE "execution_binding_hash" IS NULL;

ALTER TABLE "aiceo_intent_confirmations"
  ALTER COLUMN "execution_binding_hash" SET NOT NULL;

ALTER TABLE "aiceo_intent_confirmations"
  DROP CONSTRAINT IF EXISTS "aiceo_intent_confirmation_execution_binding_hash_check";
ALTER TABLE "aiceo_intent_confirmations"
  ADD CONSTRAINT "aiceo_intent_confirmation_execution_binding_hash_check"
  CHECK (execution_binding_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE "aiceo_execution_contracts"
  ADD COLUMN IF NOT EXISTS "intent_confirmation_id" uuid
  REFERENCES "aiceo_intent_confirmations"("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_execution_contract_intent_confirmation_unique"
  ON "aiceo_execution_contracts" ("intent_confirmation_id")
  WHERE "intent_confirmation_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_aiceo_execution_contract_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.owner_intent IS DISTINCT FROM NEW.owner_intent
    OR OLD.brain_actor_id IS DISTINCT FROM NEW.brain_actor_id OR OLD.continuity_revision IS DISTINCT FROM NEW.continuity_revision
    OR OLD.context_hash IS DISTINCT FROM NEW.context_hash OR OLD.scope IS DISTINCT FROM NEW.scope
    OR OLD.objective IS DISTINCT FROM NEW.objective OR OLD.allowed_capabilities IS DISTINCT FROM NEW.allowed_capabilities
    OR OLD.denied_capabilities IS DISTINCT FROM NEW.denied_capabilities OR OLD.authority_boundaries IS DISTINCT FROM NEW.authority_boundaries
    OR OLD.frozen_rules IS DISTINCT FROM NEW.frozen_rules OR OLD.completion_definition IS DISTINCT FROM NEW.completion_definition
    OR OLD.evidence_requirements IS DISTINCT FROM NEW.evidence_requirements OR OLD.execution_policy IS DISTINCT FROM NEW.execution_policy
    OR OLD.resume_node IS DISTINCT FROM NEW.resume_node OR OLD.escalation_conditions IS DISTINCT FROM NEW.escalation_conditions
    OR OLD.owner_attention_budget IS DISTINCT FROM NEW.owner_attention_budget
    OR OLD.intent_confirmation_id IS DISTINCT FROM NEW.intent_confirmation_id
    OR OLD.max_delegation_depth IS DISTINCT FROM NEW.max_delegation_depth
    OR OLD.contract_hash IS DISTINCT FROM NEW.contract_hash OR OLD.production_authority IS DISTINCT FROM NEW.production_authority
  THEN RAISE EXCEPTION 'Brain-issued execution contract is immutable';
  END IF;
  RETURN NEW;
END; $$;