DROP FUNCTION IF EXISTS aiceo_promote_memory(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS aiceo_append_memory_event(uuid,uuid,uuid,text,text,text,jsonb);

CREATE OR REPLACE FUNCTION aiceo_memory_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'memory control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects WHERE id=NEW.project_id;
  IF NOT FOUND OR p.environment<>'development' OR p.authority<>'grok_restricted_development' OR p.production_authority THEN
    RAISE EXCEPTION 'memory project boundary violation';
  END IF;
  IF NEW.lifecycle<>'candidate' THEN RAISE EXCEPTION 'candidate lifecycle violation'; END IF;
  IF NEW.authority_level IN ('ordinary_agent','external_source') AND (
    NEW.cognitive_state NOT IN ('observation','interpretation','hypothesis') OR NEW.truth_level<>'unverified'
  ) THEN RAISE EXCEPTION 'untrusted source cannot assert fact, decision, rule, or trusted truth'; END IF;
  IF NEW.memory_layer='governance' AND NEW.authority_level NOT IN ('owner','governance','ordinary_agent','external_source') THEN
    RAISE EXCEPTION 'invalid governance candidate authority';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS aiceo_memory_candidate_guard ON aiceo_memory_candidates;
CREATE TRIGGER aiceo_memory_candidate_guard BEFORE INSERT ON aiceo_memory_candidates
FOR EACH ROW EXECUTE FUNCTION aiceo_memory_candidate_guard();

CREATE OR REPLACE FUNCTION reject_aiceo_memory_candidate_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'G1-001 candidates are immutable; promotion and lifecycle mutation are deferred';
END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_candidate_frozen ON aiceo_memory_candidates;
DROP TRIGGER IF EXISTS aiceo_memory_candidate_no_delete ON aiceo_memory_candidates;
DROP TRIGGER IF EXISTS aiceo_memory_candidate_lifecycle ON aiceo_memory_candidates;
CREATE TRIGGER aiceo_memory_candidate_frozen BEFORE UPDATE OR DELETE ON aiceo_memory_candidates
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_memory_candidate_mutation();

CREATE OR REPLACE FUNCTION reject_g1_promoted_memory_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'G1-001 Learning Promotion is DEFERRED';
END; $$;
DROP TRIGGER IF EXISTS aiceo_promoted_trusted_insert ON aiceo_promoted_memories;
CREATE TRIGGER aiceo_promoted_trusted_insert BEFORE INSERT ON aiceo_promoted_memories
FOR EACH ROW EXECUTE FUNCTION reject_g1_promoted_memory_insert();

CREATE UNIQUE INDEX IF NOT EXISTS aiceo_memory_candidate_created_event_unique
ON aiceo_memory_events(candidate_id,event_type) WHERE event_type='candidate_created';

CREATE OR REPLACE FUNCTION aiceo_memory_event_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c aiceo_memory_candidates%ROWTYPE;
BEGIN
  IF NEW.event_type<>'candidate_created' OR NEW.candidate_id IS NULL OR NEW.promoted_memory_id IS NOT NULL THEN
    RAISE EXCEPTION 'G1-001 accepts only candidate-created lifecycle events';
  END IF;
  SELECT * INTO c FROM aiceo_memory_candidates WHERE id=NEW.candidate_id AND project_id=NEW.project_id;
  IF NOT FOUND OR NEW.actor_id<>c.source_actor_id OR NEW.actor_authority<>c.authority_level
    OR NEW.payload->>'memoryType'<>c.memory_type
  THEN RAISE EXCEPTION 'memory event is not bound to its candidate'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_event_binding_guard ON aiceo_memory_events;
CREATE TRIGGER aiceo_memory_event_binding_guard BEFORE INSERT ON aiceo_memory_events
FOR EACH ROW EXECUTE FUNCTION aiceo_memory_event_binding_guard();

CREATE OR REPLACE FUNCTION aiceo_memory_candidate_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('aiceo.memory_event_guard','1',true);
  INSERT INTO aiceo_memory_events(project_id,candidate_id,event_type,actor_id,actor_authority,payload,event_hash)
  VALUES(NEW.project_id,NEW.id,'candidate_created',NEW.source_actor_id,NEW.authority_level,
    jsonb_build_object('memoryType',NEW.memory_type,'cognitiveState',NEW.cognitive_state,'truthLevel',NEW.truth_level),
    'db-owned');
  PERFORM set_config('aiceo.memory_event_guard','0',true);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_candidate_event ON aiceo_memory_candidates;
CREATE TRIGGER aiceo_memory_candidate_event AFTER INSERT ON aiceo_memory_candidates
FOR EACH ROW EXECUTE FUNCTION aiceo_memory_candidate_event();

REVOKE INSERT, UPDATE, DELETE ON aiceo_promoted_memories FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON aiceo_memory_events FROM PUBLIC;