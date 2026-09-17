CREATE TABLE IF NOT EXISTS "aiceo_execution_contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(180) NOT NULL,
  "owner_intent" text NOT NULL,
  "brain_actor_id" varchar(180) NOT NULL,
  "continuity_revision" integer NOT NULL,
  "context_hash" varchar(128) NOT NULL,
  "scope" jsonb NOT NULL,
  "objective" text NOT NULL,
  "allowed_capabilities" jsonb NOT NULL,
  "denied_capabilities" jsonb NOT NULL,
  "authority_boundaries" jsonb NOT NULL,
  "frozen_rules" jsonb NOT NULL,
  "completion_definition" jsonb NOT NULL,
  "evidence_requirements" jsonb NOT NULL,
  "execution_policy" jsonb NOT NULL,
  "resume_node" jsonb NOT NULL,
  "escalation_conditions" jsonb NOT NULL,
  "owner_attention_budget" jsonb NOT NULL,
  "max_delegation_depth" integer NOT NULL DEFAULT 1,
  "status" varchar(32) NOT NULL DEFAULT 'ISSUED',
  "contract_version" varchar(80) NOT NULL DEFAULT 'BRAIN-AGENT-001',
  "contract_hash" varchar(128) NOT NULL,
  "production_authority" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_execution_contract_status_check" CHECK (status IN ('ISSUED','RUNNING','AWAITING_VERIFICATION','VERIFIED','REJECTED','STALE','OWNER_GATE')),
  CONSTRAINT "aiceo_execution_contract_authority_check" CHECK (production_authority=false),
  CONSTRAINT "aiceo_execution_contract_depth_check" CHECK (max_delegation_depth BETWEEN 0 AND 3),
  UNIQUE(project_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS "aiceo_execution_contract_status_idx" ON "aiceo_execution_contracts" ("status","created_at");

CREATE TABLE IF NOT EXISTS "aiceo_agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" uuid NOT NULL REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(180) NOT NULL,
  "agent_type" varchar(40) NOT NULL,
  "agent_actor_id" varchar(180) NOT NULL,
  "parent_run_id" uuid REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT,
  "delegation_depth" integer NOT NULL DEFAULT 0,
  "inherited_authority" varchar(120) NOT NULL,
  "context_hash" varchar(128) NOT NULL,
  "state" varchar(32) NOT NULL,
  "checkpoint" jsonb NOT NULL,
  "observed_scope" jsonb NOT NULL,
  "result" jsonb,
  "evidence" jsonb,
  "blocker" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "used_calls" integer NOT NULL DEFAULT 0,
  "used_cost_microusd" integer NOT NULL DEFAULT 0,
  "deadline_at" timestamptz NOT NULL,
  "heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_agent_run_type_check" CHECK (agent_type IN ('grok','coding','research','validator','future')),
  CONSTRAINT "aiceo_agent_run_state_check" CHECK (state IN ('RUNNING','PAUSED','FAILED','OWNER_GATE','AWAITING_VERIFICATION','VERIFIED','REJECTED')),
  CONSTRAINT "aiceo_agent_run_authority_check" CHECK (inherited_authority='delegated_technical_authority'),
  CONSTRAINT "aiceo_agent_run_scope_check" CHECK (jsonb_typeof(observed_scope)='array'),
  CONSTRAINT "aiceo_agent_run_result_check" CHECK (state NOT IN ('AWAITING_VERIFICATION','VERIFIED') OR (result IS NOT NULL AND evidence IS NOT NULL)),
  UNIQUE(contract_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_agent_one_running_unique" ON "aiceo_agent_runs" ((true)) WHERE state='RUNNING';
CREATE INDEX IF NOT EXISTS "aiceo_agent_run_deadline_idx" ON "aiceo_agent_runs" ("state","deadline_at");

CREATE TABLE IF NOT EXISTS "aiceo_agent_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL UNIQUE REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT,
  "validator_actor_id" varchar(180) NOT NULL,
  "passed" boolean NOT NULL,
  "compliance" jsonb NOT NULL,
  "evidence" jsonb NOT NULL,
  "result_hash" varchar(128) NOT NULL,
  "final_status" varchar(32) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_agent_verification_status_check" CHECK (final_status IN ('VERIFIED','REJECTED')),
  CONSTRAINT "aiceo_agent_verification_evidence_check" CHECK (jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)>0)
);

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
    OR OLD.owner_attention_budget IS DISTINCT FROM NEW.owner_attention_budget OR OLD.max_delegation_depth IS DISTINCT FROM NEW.max_delegation_depth
    OR OLD.contract_hash IS DISTINCT FROM NEW.contract_hash OR OLD.production_authority IS DISTINCT FROM NEW.production_authority
  THEN RAISE EXCEPTION 'Brain-issued execution contract is immutable';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS "aiceo_execution_contract_immutable" ON "aiceo_execution_contracts";
CREATE TRIGGER "aiceo_execution_contract_immutable" BEFORE UPDATE ON "aiceo_execution_contracts"
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_execution_contract_mutation();