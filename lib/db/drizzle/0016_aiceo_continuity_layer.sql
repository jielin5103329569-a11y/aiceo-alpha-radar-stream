CREATE TABLE IF NOT EXISTS "aiceo_continuity_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_key" varchar(120) NOT NULL UNIQUE,
  "title" varchar(180) NOT NULL,
  "purpose" text NOT NULL,
  "authority" varchar(120) NOT NULL DEFAULT 'grok_restricted_development',
  "environment" varchar(24) NOT NULL DEFAULT 'development',
  "production_authority" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_continuity_project_authority_check" CHECK (
    environment = 'development' AND authority = 'grok_restricted_development' AND production_authority = false
  )
);

CREATE TABLE IF NOT EXISTS "aiceo_continuity_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "state" varchar(20) NOT NULL,
  "current_state" jsonb NOT NULL,
  "decision_rule_registry" jsonb NOT NULL,
  "entity_registry" jsonb NOT NULL,
  "alias_dictionary" jsonb NOT NULL,
  "evidence_pointers" jsonb NOT NULL,
  "resume_node" jsonb NOT NULL,
  "failure_reason" text,
  "recovery_strategy" text,
  "owner_gate_reason" text,
  "heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  "supervisor_version" varchar(80) NOT NULL DEFAULT 'CONTINUITY-001',
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "aiceo_continuity_state_check" CHECK (state IN ('RUNNING','PAUSED','FAILED','COMPLETED','OWNER_GATE')),
  CONSTRAINT "aiceo_continuity_state_shape_check" CHECK (
    jsonb_typeof(current_state)='object' AND jsonb_typeof(decision_rule_registry)='array'
    AND jsonb_typeof(entity_registry)='array' AND jsonb_typeof(alias_dictionary)='object'
    AND jsonb_typeof(evidence_pointers)='array' AND jsonb_typeof(resume_node)='object'
  ),
  CONSTRAINT "aiceo_continuity_failure_reason_check" CHECK (state <> 'FAILED' OR failure_reason IS NOT NULL),
  CONSTRAINT "aiceo_continuity_owner_gate_reason_check" CHECK (state <> 'OWNER_GATE' OR owner_gate_reason IS NOT NULL),
  UNIQUE(project_id)
);
CREATE INDEX IF NOT EXISTS "aiceo_continuity_state_heartbeat_idx" ON "aiceo_continuity_state" ("state","heartbeat_at");
CREATE UNIQUE INDEX IF NOT EXISTS "aiceo_continuity_one_running_unique" ON "aiceo_continuity_state" ((true)) WHERE state='RUNNING';

CREATE TABLE IF NOT EXISTS "aiceo_continuity_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "aiceo_continuity_projects"("id") ON DELETE RESTRICT,
  "state" varchar(20) NOT NULL,
  "actor_id" varchar(180) NOT NULL,
  "event_type" varchar(80) NOT NULL,
  "payload" jsonb NOT NULL,
  "previous_hash" varchar(128),
  "event_hash" varchar(128) NOT NULL UNIQUE,
  "server_timestamp" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "aiceo_continuity_event_project_time_idx" ON "aiceo_continuity_events" ("project_id","server_timestamp");

CREATE OR REPLACE FUNCTION reject_aiceo_continuity_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'AICEO continuity evidence is append-only';
END; $$;
DROP TRIGGER IF EXISTS "aiceo_continuity_events_append_only" ON "aiceo_continuity_events";
CREATE TRIGGER "aiceo_continuity_events_append_only" BEFORE UPDATE OR DELETE ON "aiceo_continuity_events"
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_continuity_event_mutation();

INSERT INTO "aiceo_continuity_projects" ("project_key","title","purpose")
VALUES ('aiceo','AICEO','Persistent engineering continuity and recoverable execution state')
ON CONFLICT ("project_key") DO NOTHING;

INSERT INTO "aiceo_continuity_state" (
  project_id,state,current_state,decision_rule_registry,entity_registry,alias_dictionary,evidence_pointers,resume_node,recovery_strategy
)
SELECT id,'RUNNING',
  '{"activeTask":"Task 2 — AICEO Continuity Layer + Owner–Brain Execution Protocol","strictSerial":true,"memoryPolicy":"Memory is context, Persistent State is truth"}',
  '[
    {"id":"owner-zero-trial-error","rule":"AICEO completes safely delegable technical work without transferring trial-and-error to the Owner."},
    {"id":"capability-binary","rule":"能就直接执行；不能就明确说不能，并只说明真实阻塞原因。"},
    {"id":"owner-only-gates","rule":"Pause only for identity or credentials, personal Owner Governance Approval, Owner Protection red lines, or genuinely non-delegable human acts."},
    {"id":"authority-boundary","rule":"No Production, trading, Databento, Alert, asset, legal, or other new authority."},
    {"id":"strict-serial","rule":"Only one continuity project may be RUNNING."}
  ]',
  '[
    {"id":"owner","type":"human_authority","authority":"ultimate_human_governance_authority"},
    {"id":"brain","type":"technical_authority","authority":"maximum_technical_sovereignty_below_owner_red_lines"},
    {"id":"agent","type":"delegated_executor","authority":"delegated_technical_authority"},
    {"id":"impl-001","type":"governance_root","status":"VERIFIED"},
    {"id":"continuity-001","type":"implementation","status":"RUNNING"}
  ]',
  '{"AI CEO继续":"resume","AICEO继续":"resume","ai ceo continue":"resume","aiceo continue":"resume"}',
  '[{"type":"document","pointer":"docs/continuity-layer-approved-requirements.md"},{"type":"database","pointer":"aiceo_continuity_events"}]',
  '{"node":"continuity-implementation","action":"Complete implementation and acceptance checks","ownerGate":false}',
  'Read persistent state, verify control gates and evidence chain, then continue from resumeNode without guessing.'
FROM "aiceo_continuity_projects" WHERE project_key='aiceo'
ON CONFLICT (project_id) DO NOTHING;