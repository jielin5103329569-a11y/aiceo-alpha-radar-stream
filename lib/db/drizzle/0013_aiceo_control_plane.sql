CREATE TABLE "aiceo_source_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "catalog_id" varchar(180) NOT NULL,
  "provider" varchar(80) NOT NULL,
  "model" varchar(120),
  "configured" boolean DEFAULT false NOT NULL,
  "connected" boolean DEFAULT false NOT NULL,
  "tested" boolean DEFAULT false NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "aiceo_source_catalog_id_unique" ON "aiceo_source_registry" ("catalog_id");

CREATE TABLE "aiceo_policy_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "foundation_id" varchar(32) NOT NULL,
  "version" varchar(80) NOT NULL,
  "policy_hash" varchar(128) NOT NULL,
  "policy_text" text NOT NULL,
  "frozen" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "aiceo_policy_foundation_version_unique" ON "aiceo_policy_registry" ("foundation_id", "version");
CREATE UNIQUE INDEX "aiceo_policy_foundation_hash_unique" ON "aiceo_policy_registry" ("foundation_id", "policy_hash");

CREATE TABLE "aiceo_control_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "queue_active" boolean DEFAULT false NOT NULL,
  "kill_switch" boolean DEFAULT false NOT NULL,
  "circuit_state" varchar(16) DEFAULT 'CLOSED' NOT NULL,
  "circuit_failure_count" integer DEFAULT 0 NOT NULL,
  "circuit_threshold" integer DEFAULT 3 NOT NULL,
  "circuit_cooldown_ms" integer DEFAULT 60000 NOT NULL,
  "circuit_half_open_at" timestamp with time zone,
  "aggregate_token_cap" integer DEFAULT 8192 NOT NULL,
  "aggregate_call_cap" integer DEFAULT 8 NOT NULL,
  "aggregate_usd_cap" varchar(32) DEFAULT '0.50' NOT NULL,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" varchar(180),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "aiceo_control_state_singleton_unique" ON "aiceo_control_state" ((true));

CREATE TABLE "aiceo_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "correlation_id" uuid NOT NULL,
  "run_id" uuid,
  "source_id" uuid,
  "policy_id" uuid,
  "state" varchar(16) NOT NULL,
  "action" varchar(120) NOT NULL,
  "resource" varchar(180) NOT NULL,
  "permissions" jsonb NOT NULL,
  "contract_version" varchar(80) NOT NULL,
  "contract_hash" varchar(128) NOT NULL,
  "environment" varchar(24) NOT NULL,
  "authority" varchar(120) NOT NULL,
  "evidence" jsonb,
  "budget" jsonb NOT NULL,
  "timeout_ms" integer NOT NULL,
  "max_retries" integer NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "next_retry_at" timestamp with time zone,
  "provider_timestamp" timestamp with time zone,
  "client_timestamp" timestamp with time zone,
  "server_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "aiceo_tasks_state_updated_idx" ON "aiceo_tasks" ("state", "updated_at");
CREATE INDEX "aiceo_tasks_correlation_idx" ON "aiceo_tasks" ("correlation_id");
CREATE UNIQUE INDEX "aiceo_tasks_one_active_unique" ON "aiceo_tasks" ((true))
  WHERE "state" IN ('RUNNING', 'VALIDATING');

CREATE TABLE "aiceo_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid,
  "correlation_id" uuid NOT NULL,
  "run_id" uuid,
  "event_type" varchar(80) NOT NULL,
  "state" varchar(16),
  "actor_id" varchar(180),
  "payload" jsonb NOT NULL,
  "previous_hash" varchar(128),
  "event_hash" varchar(128) NOT NULL,
  "client_timestamp" timestamp with time zone,
  "server_timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "aiceo_audit_event_hash_unique" ON "aiceo_audit_events" ("event_hash");
CREATE INDEX "aiceo_audit_task_server_time_idx" ON "aiceo_audit_events" ("task_id", "server_timestamp");
INSERT INTO "aiceo_control_state" ("queue_active", "kill_switch", "circuit_state")
VALUES (true, false, 'CLOSED')
ON CONFLICT DO NOTHING;

-- The audit stream is append-only, including for privileged operators.
CREATE OR REPLACE FUNCTION aiceo_reject_audit_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'aiceo_audit_events is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER aiceo_audit_events_no_update BEFORE UPDATE OR DELETE ON "aiceo_audit_events"
FOR EACH ROW EXECUTE FUNCTION aiceo_reject_audit_mutation();

CREATE OR REPLACE FUNCTION aiceo_reject_frozen_policy_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'aiceo_policy_registry is frozen'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER aiceo_policy_registry_frozen BEFORE UPDATE OR DELETE ON "aiceo_policy_registry"
FOR EACH ROW EXECUTE FUNCTION aiceo_reject_frozen_policy_mutation();

INSERT INTO "aiceo_source_registry" ("catalog_id", "provider", "model", "provenance")
VALUES ('connector_catalog:xai', 'xAI', 'Grok', '{"configured":false,"connected":false,"tested":false,"secrets":"never accessed or stored"}')
ON CONFLICT ("catalog_id") DO NOTHING;

INSERT INTO "aiceo_policy_registry" ("foundation_id", "version", "policy_hash", "policy_text")
SELECT lpad(i::text, 3, '0'), 'ARCH-001-F' || lpad(i::text, 3, '0'),
       md5('ARCH-001 Foundation ' || i::text) || md5('frozen contract ' || i::text),
       'Frozen ARCH-001 Foundation ' || lpad(i::text, 3, '0') || ' policy registry entry.'
FROM generate_series(1, 13) AS series(i)
ON CONFLICT ("foundation_id", "version") DO NOTHING;