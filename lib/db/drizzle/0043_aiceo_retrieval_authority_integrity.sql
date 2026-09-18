ALTER TABLE aiceo_retrieval_requests
  ADD COLUMN IF NOT EXISTS grant_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS grant_hmac varchar(64);

CREATE TABLE IF NOT EXISTS aiceo_retrieval_validator_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  validator_id varchar(180) NOT NULL,
  validator_role varchar(32) NOT NULL CHECK (validator_role='aiceo_validator'),
  implementation_actor_id varchar(180) NOT NULL,
  accepted_revision bigint NOT NULL,
  result varchar(24) NOT NULL CHECK (result='VERIFIED'),
  evidence_digest varchar(64) NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  attestation_hmac varchar(64) NOT NULL CHECK (attestation_hmac ~ '^[a-f0-9]{64}$'),
  operational_input boolean NOT NULL DEFAULT false CHECK (NOT operational_input),
  grants_authority boolean NOT NULL DEFAULT false CHECK (NOT grants_authority),
  production_authority boolean NOT NULL DEFAULT false CHECK (NOT production_authority),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,accepted_revision)
);
CREATE INDEX IF NOT EXISTS aiceo_retrieval_validator_attestation_project_idx
  ON aiceo_retrieval_validator_attestations(project_id,accepted_revision);

CREATE OR REPLACE FUNCTION aiceo_retrieval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; s aiceo_continuity_state%ROWTYPE;
  next_sequence bigint; previous text; grant_entities jsonb;
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
  grant_entities:=NEW.grant_snapshot->'entities';
  IF NEW.grant_snapshot IS NULL
    OR NEW.grant_snapshot->>'subjectId'<>NEW.requested_by
    OR NEW.grant_snapshot->>'projectId'<>NEW.project_id::text
    OR NEW.grant_snapshot->>'task'<>NEW.task
    OR (NEW.grant_snapshot->>'revision')::bigint<>s.revision
    OR jsonb_typeof(grant_entities)<>'array'
    OR jsonb_array_length(NEW.entities)=0
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.entities) requested
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(grant_entities) granted
        WHERE granted=requested
      )
    )
  THEN RAISE EXCEPTION 'retrieval authenticated need-to-know grant mismatch'; END IF;
  IF NEW.operational_input OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority
    OR NEW.request_hmac !~ '^[a-f0-9]{64}$' OR NEW.grant_hmac !~ '^[a-f0-9]{64}$'
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
    NEW.scan_limit::text||':'||s.revision::text||':'||NEW.grant_snapshot::text||':'||
    NEW.grant_hmac,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text||':retrieval-requests'));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence FROM aiceo_retrieval_requests
    WHERE project_id=NEW.project_id;
  SELECT request_event_hash INTO previous FROM aiceo_retrieval_requests
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence; NEW.previous_hash:=previous;
  NEW.request_event_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.id::text||':'||NEW.request_hash||':'||
    NEW.request_hmac||':'||NEW.grant_hmac||':'||NEW.persistent_state_hash||':'||
    NEW.verified_resume_node::text||':'||next_sequence::text||':'||coalesce(previous,'')||':'||
    NEW.operational_input::text||':'||NEW.state_override_accepted::text||':'||
    NEW.grants_authority::text||':'||NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_retrieval_candidate_policy(p_request uuid, p_candidate uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE r aiceo_retrieval_requests%ROWTYPE; c aiceo_memory_candidates%ROWTYPE;
  n aiceo_thought_nodes%ROWTYPE; e jsonb; observed timestamptz; expected text;
BEGIN
  SELECT * INTO r FROM aiceo_retrieval_requests WHERE id=p_request;
  SELECT * INTO c FROM aiceo_memory_candidates WHERE id=p_candidate;
  IF NOT FOUND OR c.project_id<>r.project_id THEN RETURN 'candidate_project_mismatch'; END IF;
  IF c.lifecycle<>'candidate' THEN RETURN 'lifecycle_not_candidate'; END IF;
  IF c.memory_layer='governance' OR NOT c.memory_layer=ANY(r.requested_layers)
    OR c.memory_type NOT IN ('observation','interpretation','hypothesis')
    OR NOT c.memory_type=ANY(r.requested_types)
    OR c.cognitive_state<>c.memory_type THEN RETURN 'query_scope_mismatch'; END IF;
  IF c.truth_level<>'unverified' OR c.authority_level NOT IN ('ordinary_agent','external_source')
    THEN RETURN 'authority_or_epistemic_boundary'; END IF;
  IF c.valid_from IS NOT NULL AND c.valid_from>now() THEN RETURN 'not_yet_valid'; END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until<=now() THEN RETURN 'expired_valid_until'; END IF;
  IF c.valid_from IS NOT NULL AND c.valid_until IS NOT NULL AND c.valid_until<=c.valid_from
    THEN RETURN 'invalid_time_interval'; END IF;
  SELECT * INTO n FROM aiceo_thought_nodes WHERE memory_candidate_id=c.id;
  FOR e IN SELECT value FROM jsonb_array_elements(c.evidence_lineage) LOOP
    BEGIN observed:=(e->>'observedAt')::timestamptz;
    EXCEPTION WHEN others THEN RETURN 'poison_or_invalid_provenance'; END;
    IF observed>now() OR observed<now()-interval '90 days'
      OR (e->>'validFrom' IS NOT NULL AND (e->>'validFrom')::timestamptz>now())
      OR (e->>'validUntil' IS NOT NULL AND (e->>'validUntil')::timestamptz<=now())
    THEN RETURN 'stale_evidence'; END IF;
    IF n.id IS NOT NULL THEN
      IF lower(e->>'sourceType') NOT IN (
        'conversation_turn','owner_statement','observed_outcome','external_document',
        'sensor_observation','system_record'
      ) THEN RETURN 'poison_or_invalid_provenance'; END IF;
      expected:=encode(digest(c.content||':'||(e->>'sourceType')||':'||
        coalesce(e->>'sourceId','')||':'||(e->>'observedAt'),'sha256'),'hex');
    ELSE
      expected:=encode(digest(
        '{"sourceType":'||to_json(e->>'sourceType')::text||
        ',"sourceId":'||CASE WHEN e->>'sourceId' IS NULL THEN 'null' ELSE to_json(e->>'sourceId')::text END||
        ',"observedAt":'||to_json(e->>'observedAt')::text||
        ',"content":'||to_json(c.content)::text||'}','sha256'),'hex');
    END IF;
    IF e->>'evidenceHash' IS DISTINCT FROM expected THEN RETURN 'poison_or_invalid_provenance'; END IF;
  END LOOP;
  IF jsonb_array_length(c.evidence_lineage)=0 THEN RETURN 'poison_or_invalid_provenance'; END IF;
  IF n.id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM aiceo_thought_nodes newer WHERE newer.supersedes_node_id=n.id
    ) THEN RETURN 'superseded_by_newer_node'; END IF;
    IF (c.memory_type='observation' AND n.epistemic_state NOT IN ('observed','unverified'))
      OR (c.memory_type='interpretation' AND n.epistemic_state NOT IN ('inferred','unverified'))
      OR (c.memory_type='hypothesis' AND n.epistemic_state NOT IN ('hypothesized','proposed','unverified'))
    THEN RETURN 'thought_epistemic_conflict'; END IF;
    IF EXISTS (
      SELECT 1 FROM aiceo_thought_nodes peer
      JOIN aiceo_memory_candidates peer_c ON peer_c.id=peer.memory_candidate_id
      WHERE peer.graph_id=n.graph_id
        AND peer.parent_node_id IS NOT DISTINCT FROM n.parent_node_id
        AND peer.node_kind=n.node_kind AND peer.id<>n.id
        AND lower(btrim(peer_c.content))<>lower(btrim(c.content))
        AND NOT EXISTS (
          SELECT 1 FROM aiceo_thought_nodes newer WHERE newer.supersedes_node_id=peer.id
        )
    ) THEN RETURN 'structured_thought_conflict'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM aiceo_retrieval_decisions prior
    JOIN aiceo_memory_candidates prior_c ON prior_c.id=prior.candidate_id
    WHERE prior.request_id=r.id AND prior.decision='included'
      AND lower(btrim(prior_c.content))=lower(btrim(c.content))
  ) THEN RETURN 'duplicate_deduped'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM regexp_split_to_table(lower(c.content),'[^[:alnum:]_-]+') candidate_token
    JOIN regexp_split_to_table(lower(
      r.query||' '||r.intent||' '||r.task||' '||
      (SELECT string_agg(value,' ') FROM jsonb_array_elements_text(r.entities))
    ),'[^[:alnum:]_-]+') query_token ON query_token=candidate_token
    WHERE candidate_token<>''
  ) THEN RETURN 'query_scope_mismatch'; END IF;
  RETURN 'included';
END; $$;

CREATE OR REPLACE FUNCTION aiceo_retrieval_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r aiceo_retrieval_requests%ROWTYPE; c aiceo_memory_candidates%ROWTYPE;
  n aiceo_thought_nodes%ROWTYPE; next_sequence bigint; previous text;
  expected_content_digest text; expected_evidence_digest text; policy text;
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
    policy:=aiceo_retrieval_candidate_policy(NEW.request_id,NEW.candidate_id);
    IF NEW.decision='included' AND (policy<>'included' OR NEW.reason_code<>'included'
      OR NEW.rank_position IS NULL OR NEW.rank_position<1
      OR NEW.bytes_consumed<>octet_length(c.content))
      THEN RAISE EXCEPTION 'retrieval included candidate violates DB-owned policy: %',policy; END IF;
    IF NEW.decision='excluded' AND (NEW.bytes_consumed<>0 OR NEW.rank_position IS NOT NULL)
      THEN RAISE EXCEPTION 'excluded retrieval candidate cannot consume budget or rank'; END IF;
  ELSIF NEW.reason_code NOT IN ('preclassification_inbox_excluded','context_drift_excluded','scan_limit_exceeded') THEN
    RAISE EXCEPTION 'candidate-less retrieval decision reason is invalid';
  ELSIF NEW.candidate_snapshot IS NOT NULL OR NEW.content_digest IS NOT NULL OR NEW.evidence_digest IS NOT NULL
    OR NEW.rank_position IS NOT NULL OR NEW.bytes_consumed<>0 THEN
    RAISE EXCEPTION 'aggregate exclusion cannot carry candidate memory, rank, or budget';
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
  actual_bytes bigint; expected_ids jsonb; candidate_total bigint; expected_scanned bigint;
  distinct_ranks bigint; min_rank bigint; max_rank bigint; minimum_sufficient boolean;
BEGIN
  SELECT * INTO r FROM aiceo_retrieval_requests WHERE id=NEW.request_id FOR SHARE;
  IF NOT FOUND OR r.project_id<>NEW.project_id THEN RAISE EXCEPTION 'retrieval run request/project mismatch'; END IF;
  SELECT count(*) FILTER (WHERE decision='included'),count(*) FILTER (WHERE decision='excluded'),
    coalesce(sum(bytes_consumed) FILTER (WHERE decision='included'),0),
    coalesce(jsonb_agg(candidate_id::text ORDER BY rank_position)
      FILTER (WHERE decision='included'),'[]'::jsonb),
    count(DISTINCT rank_position) FILTER (WHERE decision='included'),
    min(rank_position) FILTER (WHERE decision='included'),
    max(rank_position) FILTER (WHERE decision='included')
    INTO actual_included,actual_excluded,actual_bytes,expected_ids,distinct_ranks,min_rank,max_rank
    FROM aiceo_retrieval_decisions WHERE request_id=NEW.request_id;
  SELECT count(*) INTO candidate_total FROM aiceo_memory_candidates WHERE project_id=NEW.project_id;
  expected_scanned:=least(candidate_total,r.scan_limit);
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(r.entities) entity,
      LATERAL regexp_split_to_table(lower(entity),'[^[:alnum:]_-]+') required_token
    WHERE required_token<>'' AND NOT EXISTS (
      SELECT 1 FROM aiceo_retrieval_decisions d
      JOIN aiceo_memory_candidates c ON c.id=d.candidate_id,
        LATERAL regexp_split_to_table(lower(c.content),'[^[:alnum:]_-]+') content_token
      WHERE d.request_id=NEW.request_id AND d.decision='included'
        AND content_token=required_token
    )
  ) INTO minimum_sufficient;
  IF NEW.included_count<>actual_included OR NEW.excluded_count<>actual_excluded
    OR NEW.scanned_count<>expected_scanned
    OR NEW.consumed_bytes<>actual_bytes OR NEW.consumed_bytes>r.max_bytes
    OR NEW.included_count>r.max_items OR NEW.selected_candidate_ids<>expected_ids
    OR distinct_ranks<>actual_included
    OR (actual_included>0 AND (min_rank<>1 OR max_rank<>actual_included))
    OR (candidate_total>r.scan_limit AND (NEW.status<>'blocked' OR actual_included<>0))
    OR (candidate_total<=r.scan_limit AND (
      (minimum_sufficient AND NEW.status<>'completed')
      OR (NOT minimum_sufficient AND (NEW.status<>'blocked' OR actual_included<>0))
    ))
    OR (NEW.budget->>'maxItems')::bigint<>r.max_items
    OR (NEW.budget->>'maxBytes')::bigint<>r.max_bytes
    OR (NEW.budget->>'scanLimit')::bigint<>r.scan_limit
    OR (NEW.budget->>'usedItems')::bigint<>NEW.included_count
    OR (NEW.budget->>'usedBytes')::bigint<>NEW.consumed_bytes
    OR NEW.result_hash !~ '^[a-f0-9]{64}$' OR NEW.response_hmac !~ '^[a-f0-9]{64}$'
    OR NEW.context_compiler_status<>'DEFERRED'
    OR NEW.state_override_accepted OR NEW.grants_authority OR NEW.production_authority
  THEN RAISE EXCEPTION 'retrieval run summary, rank, scan, sufficiency, budget, or authority is invalid'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_retrieval_validator_attestation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s aiceo_continuity_state%ROWTYPE; implementation_actor text;
BEGIN
  SELECT * INTO s FROM aiceo_continuity_state WHERE project_id=NEW.project_id FOR SHARE;
  IF NOT FOUND OR s.current_state->>'activeTask' NOT LIKE 'G1-002%'
    OR (s.current_state->>'acceptedRevision')::bigint<>NEW.accepted_revision
    OR NEW.accepted_revision<>46
  THEN RAISE EXCEPTION 'validator attestation is not bound to accepted G1-002 revision'; END IF;
  SELECT actor_id INTO implementation_actor FROM aiceo_continuity_events
    WHERE project_id=NEW.project_id AND payload->>'revision'=NEW.accepted_revision::text
    ORDER BY append_sequence DESC LIMIT 1;
  IF implementation_actor IS NULL OR NEW.implementation_actor_id<>implementation_actor
    OR NEW.validator_id=implementation_actor OR NEW.validator_role<>'aiceo_validator'
    OR NEW.result<>'VERIFIED' OR NEW.evidence_digest !~ '^[a-f0-9]{64}$'
    OR NEW.attestation_hmac !~ '^[a-f0-9]{64}$'
    OR NEW.operational_input OR NEW.grants_authority OR NEW.production_authority
  THEN RAISE EXCEPTION 'validator attestation identity, evidence, or authority is invalid'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS aiceo_retrieval_validator_attestation_guard
  ON aiceo_retrieval_validator_attestations;
CREATE TRIGGER aiceo_retrieval_validator_attestation_guard
BEFORE INSERT ON aiceo_retrieval_validator_attestations
FOR EACH ROW EXECUTE FUNCTION aiceo_retrieval_validator_attestation_guard();

CREATE OR REPLACE FUNCTION aiceo_retrieval_validator_attestations_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'retrieval validator attestations are immutable'; END; $$;
DROP TRIGGER IF EXISTS aiceo_retrieval_validator_attestations_immutable
  ON aiceo_retrieval_validator_attestations;
CREATE TRIGGER aiceo_retrieval_validator_attestations_immutable
BEFORE UPDATE OR DELETE ON aiceo_retrieval_validator_attestations
FOR EACH ROW EXECUTE FUNCTION aiceo_retrieval_validator_attestations_immutable();

ALTER TABLE aiceo_retrieval_requests ALTER COLUMN grant_snapshot SET NOT NULL;
ALTER TABLE aiceo_retrieval_requests ALTER COLUMN grant_hmac SET NOT NULL;