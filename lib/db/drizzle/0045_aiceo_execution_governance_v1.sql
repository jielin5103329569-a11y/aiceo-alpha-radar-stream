-- The existing credential DDL event trigger is not idempotent when a migration
-- is replayed. Disable it while this migration creates its tables, then install
-- the same row guards explicitly and restore the event trigger.
ALTER EVENT TRIGGER "aiceo_credential_firewall_on_table_create" DISABLE;

CREATE TABLE IF NOT EXISTS "aiceo_capability_routing_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" uuid NOT NULL REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT,
  "run_id" uuid REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT,
  "capability" varchar(120) NOT NULL,
  "selected_adapter" varchar(180) NOT NULL,
  "adapter_version" varchar(80) NOT NULL,
  "rejected_candidates" jsonb NOT NULL,
  "contract_revision" integer NOT NULL,
  "context_hash" varchar(128) NOT NULL,
  "policy_hash" varchar(128) NOT NULL,
  "decision_hash" varchar(128) NOT NULL,
  "idempotency_key" varchar(180) NOT NULL,
  "production_authority" boolean NOT NULL DEFAULT false CHECK ("production_authority" = false),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_routing_decision_binding_check" CHECK (jsonb_typeof("rejected_candidates") = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_routing_decision_idempotency_unique" ON "aiceo_capability_routing_decisions" ("contract_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "aiceo_routing_decision_capability_idx" ON "aiceo_capability_routing_decisions" ("capability","created_at");

CREATE TABLE IF NOT EXISTS "aiceo_capability_performance_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" uuid NOT NULL REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT,
  "run_id" uuid NOT NULL REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT,
  "routing_decision_id" uuid NOT NULL REFERENCES "aiceo_capability_routing_decisions"("id") ON DELETE RESTRICT,
  "event_type" varchar(32) NOT NULL,
  "capability" varchar(120) NOT NULL,
  "adapter" varchar(180) NOT NULL,
  "adapter_version" varchar(80) NOT NULL,
  "first_resolution" boolean NOT NULL DEFAULT false,
  "independently_verified" boolean NOT NULL DEFAULT false,
  "retry_count" integer NOT NULL DEFAULT 0 CHECK ("retry_count" >= 0),
  "timeout_count" integer NOT NULL DEFAULT 0 CHECK ("timeout_count" >= 0),
  "scope_drift_count" integer NOT NULL DEFAULT 0 CHECK ("scope_drift_count" >= 0),
  "cost_microusd" integer NOT NULL DEFAULT 0 CHECK ("cost_microusd" >= 0),
  "outcome" varchar(64) NOT NULL,
  "outcome_attribution" jsonb NOT NULL,
  "idempotency_key" varchar(180) NOT NULL,
  "production_authority" boolean NOT NULL DEFAULT false CHECK ("production_authority" = false),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_performance_ledger_idempotency_unique" ON "aiceo_capability_performance_ledger" ("run_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "aiceo_performance_ledger_capability_idx" ON "aiceo_capability_performance_ledger" ("capability","created_at");

CREATE TABLE IF NOT EXISTS "aiceo_first_resolution_obligations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" uuid NOT NULL REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT,
  "run_id" uuid NOT NULL REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT,
  "obligation_key" varchar(180) NOT NULL UNIQUE,
  "contract_revision" integer NOT NULL,
  "context_hash" varchar(128) NOT NULL,
  "root_cause_diagnosis" text NOT NULL,
  "minimal_effective_action" text NOT NULL,
  "owner_action_budget" jsonb NOT NULL,
  "first_submitted_at" timestamptz,
  "first_resolved_at" timestamptz,
  "unresolved_reason" text,
  "status" varchar(32) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','SUBMITTED','RESOLVED','UNRESOLVED','REOPENED')),
  "production_authority" boolean NOT NULL DEFAULT false CHECK ("production_authority" = false),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "aiceo_first_resolution_obligation_status_idx" ON "aiceo_first_resolution_obligations" ("status","updated_at");

CREATE TABLE IF NOT EXISTS "aiceo_execution_governance_lifecycle" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" uuid NOT NULL REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT,
  "run_id" uuid NOT NULL REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT,
  "state" varchar(32) NOT NULL CHECK ("state" IN ('ACCEPTED','VERIFIED','CLOSED','ROLLED_BACK','REOPENED')),
  "previous_state" varchar(32),
  "event_key" varchar(180) NOT NULL,
  "context_hash" varchar(128) NOT NULL,
  "reason" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "actor_id" varchar(180) NOT NULL,
  "production_authority" boolean NOT NULL DEFAULT false CHECK ("production_authority" = false),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_execution_governance_lifecycle_event_unique" ON "aiceo_execution_governance_lifecycle" ("run_id","event_key");
CREATE INDEX IF NOT EXISTS "aiceo_execution_governance_lifecycle_state_idx" ON "aiceo_execution_governance_lifecycle" ("run_id","created_at");

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'aiceo_capability_routing_decisions',
    'aiceo_capability_performance_ledger',
    'aiceo_first_resolution_obligations',
    'aiceo_execution_governance_lifecycle'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_credential_firewall', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION aiceo_credential_persistence_guard()',
      table_name || '_credential_firewall',
      table_name
    );
  END LOOP;
END $$;

ALTER EVENT TRIGGER "aiceo_credential_firewall_on_table_create" ENABLE;

-- Replay-safe upgrades for development databases created by the first EG-001
-- draft. Existing rows receive an explicit non-authoritative sentinel hash and
-- are never treated as new evidence by the application.
ALTER TABLE "aiceo_capability_routing_decisions"
  ADD COLUMN IF NOT EXISTS "selection_metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "payload_hash" varchar(128) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE "aiceo_capability_performance_ledger"
  ADD COLUMN IF NOT EXISTS "payload_hash" varchar(128) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE "aiceo_execution_governance_lifecycle"
  ADD COLUMN IF NOT EXISTS "payload_hash" varchar(128) NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN IF NOT EXISTS "previous_hash" varchar(128);
DROP INDEX IF EXISTS "aiceo_performance_ledger_event_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_performance_ledger_idempotency_unique"
  ON "aiceo_capability_performance_ledger" ("run_id","idempotency_key");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_routing_production_authority_false') THEN
    ALTER TABLE "aiceo_capability_routing_decisions" ADD CONSTRAINT "aiceo_routing_production_authority_false" CHECK ("production_authority" = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_performance_production_authority_false') THEN
    ALTER TABLE "aiceo_capability_performance_ledger" ADD CONSTRAINT "aiceo_performance_production_authority_false" CHECK ("production_authority" = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_fro_production_authority_false') THEN
    ALTER TABLE "aiceo_first_resolution_obligations" ADD CONSTRAINT "aiceo_fro_production_authority_false" CHECK ("production_authority" = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_production_authority_false') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_production_authority_false" CHECK ("production_authority" = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_fro_unresolved_reason_required') THEN
    ALTER TABLE "aiceo_first_resolution_obligations" ADD CONSTRAINT "aiceo_fro_unresolved_reason_required" CHECK ("status" <> 'UNRESOLVED' OR length(trim("unresolved_reason")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_routing_payload_hash_format') THEN
    ALTER TABLE "aiceo_capability_routing_decisions" ADD CONSTRAINT "aiceo_routing_payload_hash_format" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_performance_payload_hash_format') THEN
    ALTER TABLE "aiceo_capability_performance_ledger" ADD CONSTRAINT "aiceo_performance_payload_hash_format" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_fro_resolved_timestamps_required') THEN
    ALTER TABLE "aiceo_first_resolution_obligations" ADD CONSTRAINT "aiceo_fro_resolved_timestamps_required" CHECK ("status" <> 'RESOLVED' OR ("first_submitted_at" IS NOT NULL AND "first_resolved_at" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_payload_hash_format') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_payload_hash_format" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$' AND ("previous_hash" IS NULL OR "previous_hash" ~ '^[a-f0-9]{64}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_routing_contract_fk') THEN
    ALTER TABLE "aiceo_capability_routing_decisions" ADD CONSTRAINT "aiceo_routing_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_routing_run_fk') THEN
    ALTER TABLE "aiceo_capability_routing_decisions" ADD CONSTRAINT "aiceo_routing_run_fk" FOREIGN KEY ("run_id") REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_routing_decision_binding_check') THEN
    ALTER TABLE "aiceo_capability_routing_decisions" ADD CONSTRAINT "aiceo_routing_decision_binding_check" CHECK (jsonb_typeof("rejected_candidates") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_performance_contract_fk') THEN
    ALTER TABLE "aiceo_capability_performance_ledger" ADD CONSTRAINT "aiceo_performance_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_performance_run_fk') THEN
    ALTER TABLE "aiceo_capability_performance_ledger" ADD CONSTRAINT "aiceo_performance_run_fk" FOREIGN KEY ("run_id") REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_performance_routing_fk') THEN
    ALTER TABLE "aiceo_capability_performance_ledger" ADD CONSTRAINT "aiceo_performance_routing_fk" FOREIGN KEY ("routing_decision_id") REFERENCES "aiceo_capability_routing_decisions"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_performance_counts_nonnegative') THEN
    ALTER TABLE "aiceo_capability_performance_ledger" ADD CONSTRAINT "aiceo_performance_counts_nonnegative" CHECK ("retry_count" >= 0 AND "timeout_count" >= 0 AND "scope_drift_count" >= 0 AND "cost_microusd" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_fro_contract_fk') THEN
    ALTER TABLE "aiceo_first_resolution_obligations" ADD CONSTRAINT "aiceo_fro_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_fro_run_fk') THEN
    ALTER TABLE "aiceo_first_resolution_obligations" ADD CONSTRAINT "aiceo_fro_run_fk" FOREIGN KEY ("run_id") REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_fro_status_check') THEN
    ALTER TABLE "aiceo_first_resolution_obligations" ADD CONSTRAINT "aiceo_fro_status_check" CHECK ("status" IN ('OPEN','SUBMITTED','RESOLVED','UNRESOLVED','REOPENED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_contract_fk') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "aiceo_execution_contracts"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_run_fk') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_run_fk" FOREIGN KEY ("run_id") REFERENCES "aiceo_agent_runs"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_state_check') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_state_check" CHECK ("state" IN ('ACCEPTED','VERIFIED','CLOSED','ROLLED_BACK','REOPENED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_previous_state_check') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_previous_state_check" CHECK ("previous_state" IS NULL OR "previous_state" IN ('ACCEPTED','VERIFIED','CLOSED','ROLLED_BACK','REOPENED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aiceo_lifecycle_evidence_array_check') THEN
    ALTER TABLE "aiceo_execution_governance_lifecycle" ADD CONSTRAINT "aiceo_lifecycle_evidence_array_check" CHECK (jsonb_typeof("evidence") = 'array');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION aiceo_eg001_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EG-001 append-only evidence cannot be updated or deleted';
END $$;
CREATE OR REPLACE FUNCTION aiceo_eg001_fro_binding_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_id <> OLD.contract_id OR NEW.run_id <> OLD.run_id
    OR NEW.obligation_key <> OLD.obligation_key
    OR NEW.contract_revision <> OLD.contract_revision
    OR NEW.context_hash <> OLD.context_hash
    OR NEW.root_cause_diagnosis <> OLD.root_cause_diagnosis
    OR NEW.minimal_effective_action <> OLD.minimal_effective_action
    OR NEW.owner_action_budget <> OLD.owner_action_budget
    OR NEW.production_authority <> OLD.production_authority THEN
    RAISE EXCEPTION 'EG-001 First-Resolution binding is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION aiceo_eg001_lifecycle_chain_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_previous_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.run_id::text || ':eg001-lifecycle'));
  SELECT parent.payload_hash INTO expected_previous_hash
  FROM aiceo_execution_governance_lifecycle parent
  WHERE parent.run_id = NEW.run_id
    AND NOT EXISTS (
      SELECT 1 FROM aiceo_execution_governance_lifecycle child
      WHERE child.run_id = parent.run_id
        AND child.previous_hash = parent.payload_hash
    )
  ORDER BY parent.created_at DESC
  LIMIT 1;
  IF NEW.previous_hash IS DISTINCT FROM expected_previous_hash THEN
    RAISE EXCEPTION 'EG-001 lifecycle previous hash does not match the durable chain tail';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aiceo_eg001_routing_append_only ON "aiceo_capability_routing_decisions";
CREATE TRIGGER aiceo_eg001_routing_append_only BEFORE UPDATE OR DELETE ON "aiceo_capability_routing_decisions" FOR EACH ROW EXECUTE FUNCTION aiceo_eg001_append_only_guard();
DROP TRIGGER IF EXISTS aiceo_eg001_performance_append_only ON "aiceo_capability_performance_ledger";
CREATE TRIGGER aiceo_eg001_performance_append_only BEFORE UPDATE OR DELETE ON "aiceo_capability_performance_ledger" FOR EACH ROW EXECUTE FUNCTION aiceo_eg001_append_only_guard();
DROP TRIGGER IF EXISTS aiceo_eg001_lifecycle_append_only ON "aiceo_execution_governance_lifecycle";
CREATE TRIGGER aiceo_eg001_lifecycle_append_only BEFORE UPDATE OR DELETE ON "aiceo_execution_governance_lifecycle" FOR EACH ROW EXECUTE FUNCTION aiceo_eg001_append_only_guard();
DROP TRIGGER IF EXISTS aiceo_eg001_lifecycle_chain_guard ON "aiceo_execution_governance_lifecycle";
CREATE TRIGGER aiceo_eg001_lifecycle_chain_guard BEFORE INSERT ON "aiceo_execution_governance_lifecycle" FOR EACH ROW EXECUTE FUNCTION aiceo_eg001_lifecycle_chain_guard();
DROP TRIGGER IF EXISTS aiceo_eg001_fro_binding_guard ON "aiceo_first_resolution_obligations";
CREATE TRIGGER aiceo_eg001_fro_binding_guard BEFORE UPDATE ON "aiceo_first_resolution_obligations" FOR EACH ROW EXECUTE FUNCTION aiceo_eg001_fro_binding_guard();