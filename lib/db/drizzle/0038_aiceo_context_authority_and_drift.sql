CREATE TABLE aiceo_context_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiceo_continuity_projects(id),
  source varchar(32) NOT NULL CHECK (source IN (
    'work','notion','ordinary_chat','new_chat','agent','future_ai','connector','other'
  )),
  external_context jsonb NOT NULL,
  claimed_phase text,
  claimed_task text,
  claimed_next_step text,
  claimed_revision integer,
  observed_at timestamptz NOT NULL,
  candidate_context_hash varchar(64) NOT NULL,
  persistent_revision integer NOT NULL,
  persistent_state_hash varchar(64) NOT NULL,
  verified_resume_node jsonb NOT NULL,
  conflict_fields varchar(48)[] NOT NULL,
  disposition varchar(40) NOT NULL CHECK (disposition IN (
    'candidate_context_only','context_drift_rejected'
  )),
  append_sequence bigint NOT NULL,
  previous_hash varchar(64),
  event_hash varchar(64) NOT NULL,
  operational_input boolean NOT NULL DEFAULT false CHECK (operational_input=false),
  state_override_accepted boolean NOT NULL DEFAULT false CHECK (state_override_accepted=false),
  grants_authority boolean NOT NULL DEFAULT false CHECK (grants_authority=false),
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,append_sequence)
);
CREATE INDEX aiceo_context_evidence_project_time_idx
  ON aiceo_context_evidence_events(project_id,created_at);

CREATE OR REPLACE FUNCTION aiceo_context_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p aiceo_continuity_projects%ROWTYPE;
  s aiceo_continuity_state%ROWTYPE;
  conflicts text[]:=ARRAY[]::text[];
  actual_task text;
  next_sequence bigint;
  previous text;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context evidence control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects
    WHERE id=NEW.project_id AND project_key='aiceo';
  IF NOT FOUND OR p.environment<>'development' OR p.authority<>'grok_restricted_development'
    OR p.production_authority
  THEN RAISE EXCEPTION 'context evidence project boundary violation'; END IF;
  SELECT * INTO s FROM aiceo_continuity_state
    WHERE project_id=NEW.project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'persistent state is missing; external context cannot recover engineering state'; END IF;
  IF jsonb_typeof(NEW.external_context)<>'object' OR NEW.observed_at>now() THEN
    RAISE EXCEPTION 'external context provenance or time is invalid'; END IF;
  IF NEW.operational_input OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority THEN
    RAISE EXCEPTION 'external context has no engineering-state or authority rights'; END IF;

  actual_task:=coalesce(s.current_state->>'activeTask',s.current_state->>'completedTask','');
  IF NEW.claimed_phase IS NOT NULL AND NEW.claimed_phase<>actual_task THEN conflicts:=array_append(conflicts,'phase'); END IF;
  IF NEW.claimed_task IS NOT NULL AND NEW.claimed_task<>actual_task THEN conflicts:=array_append(conflicts,'task'); END IF;
  IF NEW.claimed_next_step IS NOT NULL
    AND NEW.claimed_next_step<>coalesce(s.resume_node->>'node','')
    AND NEW.claimed_next_step<>coalesce(s.resume_node->>'action','')
  THEN conflicts:=array_append(conflicts,'next_step'); END IF;
  IF NEW.claimed_revision IS NOT NULL AND NEW.claimed_revision<>s.revision THEN
    conflicts:=array_append(conflicts,'revision'); END IF;

  NEW.candidate_context_hash:=encode(digest(
    NEW.source||':'||NEW.external_context::text||':'||coalesce(NEW.claimed_phase,'')||':'||
    coalesce(NEW.claimed_task,'')||':'||coalesce(NEW.claimed_next_step,'')||':'||
    coalesce(NEW.claimed_revision::text,'')||':'||NEW.observed_at::text,'sha256'),'hex');
  NEW.persistent_revision:=s.revision;
  NEW.persistent_state_hash:=encode(digest(
    s.project_id::text||':'||s.state||':'||s.current_state::text||':'||
    s.decision_rule_registry::text||':'||s.entity_registry::text||':'||
    s.alias_dictionary::text||':'||s.resume_node::text||':'||s.revision::text,'sha256'),'hex');
  NEW.verified_resume_node:=s.resume_node;
  NEW.conflict_fields:=conflicts;
  NEW.disposition:=CASE WHEN cardinality(conflicts)>0
    THEN 'context_drift_rejected' ELSE 'candidate_context_only' END;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text||':context-evidence'));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence
    FROM aiceo_context_evidence_events WHERE project_id=NEW.project_id;
  SELECT event_hash INTO previous FROM aiceo_context_evidence_events
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence;
  NEW.previous_hash:=previous;
  NEW.event_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.id::text||':'||NEW.source||':'||
    NEW.candidate_context_hash||':'||NEW.persistent_revision::text||':'||
    NEW.persistent_state_hash||':'||NEW.verified_resume_node::text||':'||
    NEW.conflict_fields::text||':'||NEW.disposition||':'||next_sequence::text||':'||
    coalesce(previous,'')||':'||NEW.operational_input::text||':'||
    NEW.state_override_accepted::text||':'||NEW.grants_authority::text||':'||
    NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_context_evidence_guard
BEFORE INSERT ON aiceo_context_evidence_events
FOR EACH ROW EXECUTE FUNCTION aiceo_context_evidence_guard();

CREATE OR REPLACE FUNCTION reject_aiceo_context_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'context evidence is append-only and cannot rewrite Persistent State history'; END; $$;
CREATE TRIGGER aiceo_context_evidence_immutable
BEFORE UPDATE OR DELETE ON aiceo_context_evidence_events
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_context_evidence_mutation();

REVOKE INSERT,UPDATE,DELETE ON aiceo_context_evidence_events FROM PUBLIC;