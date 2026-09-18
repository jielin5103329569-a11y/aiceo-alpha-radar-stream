ALTER TABLE aiceo_retrieval_requests
  ADD COLUMN IF NOT EXISTS request_hmac varchar(64);
ALTER TABLE aiceo_retrieval_decisions
  ADD COLUMN IF NOT EXISTS candidate_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS decision_hmac varchar(64);

CREATE OR REPLACE FUNCTION aiceo_retrieval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; s aiceo_continuity_state%ROWTYPE;
  next_sequence bigint; previous text; protected_scope text;
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
  IF NEW.task<>coalesce(s.current_state->>'activeTask',s.current_state->>'completedTask','')
    THEN RAISE EXCEPTION 'retrieval task conflicts with Persistent State'; END IF;
  protected_scope:=lower(s.current_state::text||':'||s.decision_rule_registry::text||':'||s.entity_registry::text);
  IF jsonb_array_length(NEW.entities)=0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(NEW.entities) entity
    WHERE position(lower(entity) in protected_scope)=0
  ) THEN RAISE EXCEPTION 'retrieval entity is outside the current task need-to-know scope'; END IF;
  IF NEW.operational_input OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority
    OR NEW.request_hmac !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'retrieval cannot alter state or authority and requires server HMAC'; END IF;
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
    NEW.request_hmac||':'||NEW.persistent_state_hash||':'||NEW.verified_resume_node::text||':'||
    next_sequence::text||':'||coalesce(previous,'')||':'||NEW.operational_input::text||':'||
    NEW.state_override_accepted::text||':'||NEW.grants_authority::text||':'||
    NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_retrieval_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r aiceo_retrieval_requests%ROWTYPE; c aiceo_memory_candidates%ROWTYPE;
  n aiceo_thought_nodes%ROWTYPE; next_sequence bigint; previous text;
  expected_content_digest text; expected_evidence_digest text;
BEGIN
  SELECT * INTO r FROM aiceo_retrieval_requests WHERE id=NEW.request_id FOR SHARE;
  IF NOT FOUND OR r.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval decision request/project mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM aiceo_retrieval_runs WHERE request_id=NEW.request_id) THEN
    RAISE EXCEPTION 'completed retrieval run cannot accept additional decisions';
  END IF;
  IF NEW.operational_input OR NEW.grants_authority OR NEW.production_authority
    OR NEW.decision_hmac !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'retrieval decision cannot alter truth or authority and requires server HMAC'; END IF;
  IF NEW.candidate_id IS NOT NULL THEN
    SELECT * INTO c FROM aiceo_memory_candidates WHERE id=NEW.candidate_id;
    IF NOT FOUND OR c.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval candidate project mismatch'; END IF;
    expected_content_digest:=encode(digest(c.content,'sha256'),'hex');
    SELECT encode(digest(coalesce(string_agg(e->>'evidenceHash',':' ORDER BY e->>'evidenceHash'),''),'sha256'),'hex')
      INTO expected_evidence_digest FROM jsonb_array_elements(c.evidence_lineage) e;
    IF NEW.content_digest<>expected_content_digest OR NEW.evidence_digest<>expected_evidence_digest
      OR NEW.candidate_snapshot IS NULL
      OR NEW.candidate_snapshot->>'candidateId'<>c.id::text
      OR NEW.candidate_snapshot->>'projectId'<>c.project_id::text
      OR NEW.candidate_snapshot->>'content'<>c.content
      OR NEW.candidate_snapshot->>'memoryLayer'<>c.memory_layer
      OR NEW.candidate_snapshot->>'memoryType'<>c.memory_type
      OR NEW.candidate_snapshot->>'cognitiveState'<>c.cognitive_state
      OR NEW.candidate_snapshot->>'truthLevel'<>c.truth_level
      OR NEW.candidate_snapshot->>'authorityLevel'<>c.authority_level
      OR NEW.candidate_snapshot->'evidenceLineage'<>c.evidence_lineage
      OR coalesce((NEW.candidate_snapshot->>'candidateOnly')::boolean,false)<>true
      OR coalesce((NEW.candidate_snapshot->>'operationalInput')::boolean,true)<>false
      OR coalesce((NEW.candidate_snapshot->>'grantsAuthority')::boolean,true)<>false
      OR coalesce((NEW.candidate_snapshot->>'productionAuthority')::boolean,true)<>false
    THEN RAISE EXCEPTION 'retrieval candidate snapshot or digest mismatch'; END IF;
    IF NEW.thought_node_id IS NOT NULL THEN
      SELECT * INTO n FROM aiceo_thought_nodes WHERE id=NEW.thought_node_id;
      IF NOT FOUND OR n.project_id<>NEW.project_id OR n.memory_candidate_id<>NEW.candidate_id
        THEN RAISE EXCEPTION 'retrieval thought-node binding mismatch'; END IF;
    END IF;
    IF NEW.decision='included' AND (
      c.lifecycle<>'candidate' OR c.memory_layer='governance'
      OR NOT c.memory_layer=ANY(r.requested_layers)
      OR c.memory_type NOT IN ('observation','interpretation','hypothesis')
      OR NOT c.memory_type=ANY(r.requested_types)
      OR c.cognitive_state<>c.memory_type OR c.truth_level<>'unverified'
      OR c.authority_level NOT IN ('ordinary_agent','external_source')
      OR jsonb_array_length(c.evidence_lineage)=0
      OR (c.valid_from IS NOT NULL AND c.valid_from>now())
      OR (c.valid_until IS NOT NULL AND c.valid_until<=now())
      OR (c.valid_from IS NOT NULL AND c.valid_until IS NOT NULL AND c.valid_until<=c.valid_from)
      OR NEW.bytes_consumed<>octet_length(c.content)
    ) THEN RAISE EXCEPTION 'retrieval included an ineligible candidate'; END IF;
    IF NEW.decision='excluded' AND NEW.bytes_consumed<>0
      THEN RAISE EXCEPTION 'excluded retrieval candidate cannot consume budget'; END IF;
  ELSIF NEW.reason_code NOT IN ('preclassification_inbox_excluded','context_drift_excluded','scan_limit_exceeded') THEN
    RAISE EXCEPTION 'candidate-less retrieval decision reason is invalid';
  ELSIF NEW.candidate_snapshot IS NOT NULL OR NEW.content_digest IS NOT NULL OR NEW.evidence_digest IS NOT NULL THEN
    RAISE EXCEPTION 'aggregate exclusion cannot carry candidate memory';
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
    NEW.provenance::text||':'||coalesce(NEW.candidate_snapshot::text,'')||':'||
    coalesce(NEW.rank_position::text,'')||':'||NEW.bytes_consumed::text||':'||
    next_sequence::text||':'||coalesce(previous,'')||':'||NEW.decision_hmac||':'||
    NEW.operational_input::text||':'||NEW.grants_authority::text||':'||
    NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_retrieval_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r aiceo_retrieval_requests%ROWTYPE; actual_included bigint; actual_excluded bigint;
  actual_bytes bigint; expected_ids jsonb;
BEGIN
  SELECT * INTO r FROM aiceo_retrieval_requests WHERE id=NEW.request_id FOR SHARE;
  IF NOT FOUND OR r.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval run request/project mismatch'; END IF;
  SELECT count(*) FILTER (WHERE decision='included'),count(*) FILTER (WHERE decision='excluded'),
    coalesce(sum(bytes_consumed) FILTER (WHERE decision='included'),0),
    coalesce(jsonb_agg(candidate_id::text ORDER BY rank_position)
      FILTER (WHERE decision='included'),'[]'::jsonb)
    INTO actual_included,actual_excluded,actual_bytes,expected_ids
    FROM aiceo_retrieval_decisions WHERE request_id=NEW.request_id;
  IF NEW.included_count<>actual_included OR NEW.excluded_count<>actual_excluded
    OR NEW.consumed_bytes<>actual_bytes OR NEW.consumed_bytes>r.max_bytes
    OR NEW.included_count>r.max_items OR NEW.selected_candidate_ids<>expected_ids
    OR (NEW.budget->>'maxItems')::bigint<>r.max_items
    OR (NEW.budget->>'maxBytes')::bigint<>r.max_bytes
    OR (NEW.budget->>'scanLimit')::bigint<>r.scan_limit
    OR (NEW.budget->>'usedItems')::bigint<>NEW.included_count
    OR (NEW.budget->>'usedBytes')::bigint<>NEW.consumed_bytes
    OR NEW.result_hash !~ '^[a-f0-9]{64}$' OR NEW.response_hmac !~ '^[a-f0-9]{64}$'
    OR NEW.context_compiler_status<>'DEFERRED'
    OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority
  THEN RAISE EXCEPTION 'retrieval run summary, budget, deferred boundary, or authority is invalid'; END IF;
  RETURN NEW;
END; $$;

ALTER TABLE aiceo_retrieval_requests ALTER COLUMN request_hmac SET NOT NULL;
ALTER TABLE aiceo_retrieval_decisions ALTER COLUMN decision_hmac SET NOT NULL;