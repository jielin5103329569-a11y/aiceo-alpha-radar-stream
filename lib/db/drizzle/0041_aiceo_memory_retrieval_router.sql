CREATE TABLE aiceo_retrieval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiceo_continuity_projects(id),
  idempotency_key varchar(180) NOT NULL,
  requested_by varchar(180) NOT NULL,
  requester_role varchar(32) NOT NULL CHECK (requester_role IN ('aiceo_owner','aiceo_operator','aiceo_validator')),
  purpose varchar(40) NOT NULL CHECK (purpose='why_history_context'),
  task text NOT NULL,
  intent text NOT NULL,
  entities jsonb NOT NULL CHECK (jsonb_typeof(entities)='array'),
  query text NOT NULL,
  requested_layers varchar(24)[] NOT NULL,
  requested_types varchar(24)[] NOT NULL,
  max_items bigint NOT NULL CHECK (max_items BETWEEN 1 AND 20),
  max_bytes bigint NOT NULL CHECK (max_bytes BETWEEN 1 AND 65536),
  scan_limit bigint NOT NULL CHECK (scan_limit BETWEEN 1 AND 100),
  persistent_revision bigint NOT NULL,
  persistent_state_hash varchar(64) NOT NULL,
  verified_resume_node jsonb NOT NULL,
  request_hash varchar(64) NOT NULL,
  append_sequence bigint NOT NULL,
  previous_hash varchar(64),
  request_event_hash varchar(64) NOT NULL UNIQUE,
  operational_input boolean NOT NULL DEFAULT false CHECK (operational_input=false),
  state_override_accepted boolean NOT NULL DEFAULT false CHECK (state_override_accepted=false),
  grants_authority boolean NOT NULL DEFAULT false CHECK (grants_authority=false),
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,idempotency_key),
  UNIQUE(project_id,append_sequence)
);
CREATE INDEX aiceo_retrieval_request_project_time_idx ON aiceo_retrieval_requests(project_id,created_at);

CREATE TABLE aiceo_retrieval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES aiceo_retrieval_requests(id),
  project_id uuid NOT NULL REFERENCES aiceo_continuity_projects(id),
  candidate_id uuid REFERENCES aiceo_memory_candidates(id),
  thought_node_id uuid REFERENCES aiceo_thought_nodes(id),
  decision varchar(16) NOT NULL CHECK (decision IN ('included','excluded')),
  reason_code varchar(64) NOT NULL,
  score bigint,
  score_components jsonb NOT NULL,
  content_digest varchar(64),
  evidence_digest varchar(64),
  provenance jsonb NOT NULL,
  rank_position bigint,
  bytes_consumed bigint NOT NULL CHECK (bytes_consumed>=0),
  append_sequence bigint NOT NULL,
  previous_hash varchar(64),
  decision_hash varchar(64) NOT NULL UNIQUE,
  operational_input boolean NOT NULL DEFAULT false CHECK (operational_input=false),
  grants_authority boolean NOT NULL DEFAULT false CHECK (grants_authority=false),
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision='included' AND rank_position IS NOT NULL) OR (decision='excluded' AND rank_position IS NULL)),
  UNIQUE(request_id,candidate_id),
  UNIQUE(request_id,append_sequence)
);
CREATE INDEX aiceo_retrieval_decision_request_idx ON aiceo_retrieval_decisions(request_id,append_sequence);

CREATE TABLE aiceo_retrieval_runs (
  request_id uuid PRIMARY KEY REFERENCES aiceo_retrieval_requests(id),
  project_id uuid NOT NULL REFERENCES aiceo_continuity_projects(id),
  status varchar(24) NOT NULL CHECK (status IN ('completed','blocked','failed_closed')),
  included_count bigint NOT NULL CHECK (included_count>=0),
  excluded_count bigint NOT NULL CHECK (excluded_count>=0),
  scanned_count bigint NOT NULL CHECK (scanned_count>=0),
  consumed_bytes bigint NOT NULL CHECK (consumed_bytes>=0),
  budget jsonb NOT NULL,
  selected_candidate_ids jsonb NOT NULL CHECK (jsonb_typeof(selected_candidate_ids)='array'),
  result_hash varchar(64) NOT NULL UNIQUE,
  response_hmac varchar(64) NOT NULL,
  context_compiler_status varchar(24) NOT NULL DEFAULT 'DEFERRED' CHECK (context_compiler_status='DEFERRED'),
  state_override_accepted boolean NOT NULL DEFAULT false CHECK (state_override_accepted=false),
  grants_authority boolean NOT NULL DEFAULT false CHECK (grants_authority=false),
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aiceo_retrieval_run_project_time_idx ON aiceo_retrieval_runs(project_id,created_at);

CREATE OR REPLACE FUNCTION aiceo_retrieval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; s aiceo_continuity_state%ROWTYPE;
  next_sequence bigint; previous text;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'retrieval control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects WHERE id=NEW.project_id AND project_key='aiceo';
  IF NOT FOUND OR p.environment<>'development' OR p.authority<>'grok_restricted_development'
    OR p.production_authority THEN RAISE EXCEPTION 'retrieval project boundary violation'; END IF;
  SELECT * INTO s FROM aiceo_continuity_state WHERE project_id=NEW.project_id FOR SHARE;
  IF NOT FOUND OR
    coalesce(s.current_state->>'activeTask',s.current_state->>'completedTask','') NOT LIKE 'G1-002%'
    OR s.current_state->>'verification' NOT IN ('NOT_VERIFIED','VERIFIED')
  THEN RAISE EXCEPTION 'G1-002 Retrieval Router Persistent State is not active or verified'; END IF;
  IF NEW.operational_input OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority
    THEN RAISE EXCEPTION 'retrieval cannot alter state or authority'; END IF;
  NEW.persistent_revision:=s.revision;
  NEW.persistent_state_hash:=encode(digest(
    s.project_id::text||':'||s.state||':'||s.current_state::text||':'||
    s.decision_rule_registry::text||':'||s.entity_registry::text||':'||
    s.alias_dictionary::text||':'||s.resume_node::text||':'||s.revision::text,'sha256'),'hex');
  NEW.verified_resume_node:=s.resume_node;
  NEW.request_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.idempotency_key||':'||NEW.requested_by||':'||
    NEW.requester_role||':'||NEW.purpose||':'||NEW.task||':'||NEW.intent||':'||
    NEW.entities::text||':'||NEW.query||':'||NEW.requested_layers::text||':'||
    NEW.requested_types::text||':'||NEW.max_items::text||':'||NEW.max_bytes::text||':'||
    NEW.scan_limit::text||':'||s.revision::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text||':retrieval-requests'));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence FROM aiceo_retrieval_requests
    WHERE project_id=NEW.project_id;
  SELECT request_event_hash INTO previous FROM aiceo_retrieval_requests
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence; NEW.previous_hash:=previous;
  NEW.request_event_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.id::text||':'||NEW.request_hash||':'||
    NEW.persistent_state_hash||':'||NEW.verified_resume_node::text||':'||
    next_sequence::text||':'||coalesce(previous,'')||':'||NEW.operational_input::text||':'||
    NEW.state_override_accepted::text||':'||NEW.grants_authority::text||':'||
    NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_retrieval_request_guard BEFORE INSERT ON aiceo_retrieval_requests
FOR EACH ROW EXECUTE FUNCTION aiceo_retrieval_request_guard();

CREATE OR REPLACE FUNCTION aiceo_retrieval_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r aiceo_retrieval_requests%ROWTYPE; c aiceo_memory_candidates%ROWTYPE;
  next_sequence bigint; previous text;
BEGIN
  SELECT * INTO r FROM aiceo_retrieval_requests WHERE id=NEW.request_id FOR SHARE;
  IF NOT FOUND OR r.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval decision request/project mismatch'; END IF;
  IF NEW.operational_input OR NEW.grants_authority OR NEW.production_authority
    THEN RAISE EXCEPTION 'retrieval decision cannot alter truth or authority'; END IF;
  IF NEW.candidate_id IS NOT NULL THEN
    SELECT * INTO c FROM aiceo_memory_candidates WHERE id=NEW.candidate_id;
    IF NOT FOUND OR c.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval candidate project mismatch'; END IF;
    IF NEW.decision='included' AND (
      c.lifecycle<>'candidate' OR c.memory_layer='governance'
      OR c.memory_type NOT IN ('observation','interpretation','hypothesis')
      OR c.truth_level<>'unverified'
      OR c.authority_level NOT IN ('ordinary_agent','external_source')
    ) THEN RAISE EXCEPTION 'retrieval included an ineligible or authoritative memory'; END IF;
  ELSIF NEW.reason_code NOT IN ('preclassification_inbox_excluded','context_drift_excluded','scan_limit_exceeded') THEN
    RAISE EXCEPTION 'candidate-less retrieval decision reason is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.request_id::text||':retrieval-decisions'));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence FROM aiceo_retrieval_decisions
    WHERE request_id=NEW.request_id;
  SELECT decision_hash INTO previous FROM aiceo_retrieval_decisions
    WHERE request_id=NEW.request_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence; NEW.previous_hash:=previous;
  NEW.decision_hash:=encode(digest(
    NEW.request_id::text||':'||NEW.id::text||':'||coalesce(NEW.candidate_id::text,'')||':'||
    coalesce(NEW.thought_node_id::text,'')||':'||NEW.decision||':'||NEW.reason_code||':'||
    coalesce(NEW.score::text,'')||':'||NEW.score_components::text||':'||
    coalesce(NEW.content_digest,'')||':'||coalesce(NEW.evidence_digest,'')||':'||
    NEW.provenance::text||':'||coalesce(NEW.rank_position::text,'')||':'||
    NEW.bytes_consumed::text||':'||next_sequence::text||':'||coalesce(previous,'')||':'||
    NEW.operational_input::text||':'||NEW.grants_authority::text||':'||
    NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_retrieval_decision_guard BEFORE INSERT ON aiceo_retrieval_decisions
FOR EACH ROW EXECUTE FUNCTION aiceo_retrieval_decision_guard();

CREATE OR REPLACE FUNCTION aiceo_retrieval_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r aiceo_retrieval_requests%ROWTYPE; actual_included bigint; actual_excluded bigint;
BEGIN
  SELECT * INTO r FROM aiceo_retrieval_requests WHERE id=NEW.request_id FOR SHARE;
  IF NOT FOUND OR r.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval run request/project mismatch'; END IF;
  SELECT count(*) FILTER (WHERE decision='included'),count(*) FILTER (WHERE decision='excluded')
    INTO actual_included,actual_excluded FROM aiceo_retrieval_decisions WHERE request_id=NEW.request_id;
  IF NEW.included_count<>actual_included OR NEW.excluded_count<>actual_excluded
    OR NEW.consumed_bytes>r.max_bytes OR NEW.included_count>r.max_items
    OR jsonb_array_length(NEW.selected_candidate_ids)<>NEW.included_count
    OR NEW.context_compiler_status<>'DEFERRED'
    OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority
  THEN RAISE EXCEPTION 'retrieval run summary, budget, deferred boundary, or authority is invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_retrieval_run_guard BEFORE INSERT ON aiceo_retrieval_runs
FOR EACH ROW EXECUTE FUNCTION aiceo_retrieval_run_guard();

CREATE OR REPLACE FUNCTION reject_aiceo_retrieval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'retrieval evidence is append-only'; END; $$;
CREATE TRIGGER aiceo_retrieval_requests_immutable BEFORE UPDATE OR DELETE ON aiceo_retrieval_requests
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_retrieval_mutation();
CREATE TRIGGER aiceo_retrieval_decisions_immutable BEFORE UPDATE OR DELETE ON aiceo_retrieval_decisions
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_retrieval_mutation();
CREATE TRIGGER aiceo_retrieval_runs_immutable BEFORE UPDATE OR DELETE ON aiceo_retrieval_runs
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_retrieval_mutation();
REVOKE INSERT,UPDATE,DELETE ON aiceo_retrieval_requests,aiceo_retrieval_decisions,aiceo_retrieval_runs FROM PUBLIC;