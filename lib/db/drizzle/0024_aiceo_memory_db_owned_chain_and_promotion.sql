CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS aiceo_memory_chain_heads (
  project_id uuid PRIMARY KEY REFERENCES aiceo_continuity_projects(id) ON DELETE RESTRICT,
  head_hash varchar(128), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION aiceo_memory_event_db_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h text; canonical text;
BEGIN
  INSERT INTO aiceo_memory_chain_heads(project_id, head_hash) VALUES (NEW.project_id, NULL)
    ON CONFLICT (project_id) DO NOTHING;
  SELECT head_hash INTO h FROM aiceo_memory_chain_heads WHERE project_id=NEW.project_id FOR UPDATE;
  canonical := NEW.project_id::text || ':' || coalesce(NEW.candidate_id::text,'') || ':' ||
    coalesce(NEW.promoted_memory_id::text,'') || ':' || NEW.event_type || ':' || NEW.actor_id || ':' ||
    coalesce(h,'') || ':' || NEW.payload::text;
  NEW.previous_hash := h;
  NEW.event_hash := encode(digest(canonical, 'sha256'), 'hex');
  INSERT INTO aiceo_memory_chain_heads(project_id, head_hash, updated_at)
    VALUES (NEW.project_id, NEW.event_hash, now())
    ON CONFLICT (project_id) DO UPDATE SET head_hash=EXCLUDED.head_hash, updated_at=now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_event_verify_insert ON aiceo_memory_events;
DROP TRIGGER IF EXISTS aiceo_memory_event_db_chain ON aiceo_memory_events;
CREATE TRIGGER aiceo_memory_event_db_chain BEFORE INSERT ON aiceo_memory_events
FOR EACH ROW EXECUTE FUNCTION aiceo_memory_event_db_chain();

CREATE OR REPLACE FUNCTION aiceo_promote_memory(p_candidate uuid, p_project uuid, p_actor text, p_authority text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c aiceo_memory_candidates%ROWTYPE; m uuid; h text;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'memory control gate is closed'; END IF;
  SELECT * INTO c FROM aiceo_memory_candidates WHERE id=p_candidate AND project_id=p_project
    AND lifecycle='candidate' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate missing, wrong project, or already promoted'; END IF;
  IF c.memory_layer='governance' AND p_authority NOT IN ('owner','governance') THEN RAISE EXCEPTION 'governance owner gate'; END IF;
  IF c.memory_layer<>'governance' AND p_authority NOT IN ('brain','owner') THEN RAISE EXCEPTION 'brain authority required'; END IF;
  IF c.memory_type<>c.cognitive_state THEN RAISE EXCEPTION 'memory type/state matrix violation'; END IF;
  IF c.memory_type IN ('interpretation','hypothesis') AND c.cognitive_state<>c.memory_type THEN RAISE EXCEPTION 'interpretation/hypothesis laundering'; END IF;
  IF c.memory_type='fact' AND c.cognitive_state<>'fact' THEN RAISE EXCEPTION 'fact laundering'; END IF;
  IF c.authority_level='external_source' AND c.memory_type IN ('fact','rule') THEN
    IF jsonb_array_length(c.evidence_lineage)<2 THEN RAISE EXCEPTION 'external corroboration required'; END IF;
  END IF;
  IF c.memory_type IN ('fact','rule','decision') AND c.truth_level NOT IN ('verified','owner_asserted') THEN RAISE EXCEPTION 'insufficient truth'; END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until<=now() THEN RAISE EXCEPTION 'expired candidate'; END IF;
  PERFORM set_config('aiceo.memory_promotion_guard','1',true);
  INSERT INTO aiceo_promoted_memories(candidate_id,candidate_project_id,project_id,content,memory_layer,memory_type,cognitive_state,truth_level,authority_level,evidence_lineage,valid_from,valid_until,promoted_by,production_authority)
    VALUES(c.id,c.project_id,c.project_id,c.content,c.memory_layer,c.memory_type,c.cognitive_state,c.truth_level,p_authority,c.evidence_lineage,c.valid_from,c.valid_until,p_actor,false) RETURNING id INTO m;
  UPDATE aiceo_memory_candidates SET lifecycle='promoted' WHERE id=c.id AND lifecycle='candidate';
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate lifecycle race'; END IF;
  SELECT head_hash INTO h FROM aiceo_memory_chain_heads WHERE project_id=c.project_id FOR UPDATE;
  INSERT INTO aiceo_memory_events(project_id,candidate_id,promoted_memory_id,event_type,actor_id,actor_authority,payload,previous_hash,event_hash)
    VALUES(c.project_id,c.id,m,'memory_promoted',p_actor,p_authority,
      jsonb_build_object('contentHash', encode(digest(c.content || ':' || c.evidence_lineage::text,'sha256'),'hex')), h, 'db-owned');
  RETURN m;
END; $$;
CREATE OR REPLACE FUNCTION reject_direct_aiceo_promoted_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('aiceo.memory_promotion_guard', true) <> '1' THEN RAISE EXCEPTION 'promoted memories require trusted promotion function'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS aiceo_promoted_trusted_insert ON aiceo_promoted_memories;
CREATE TRIGGER aiceo_promoted_trusted_insert BEFORE INSERT ON aiceo_promoted_memories
FOR EACH ROW EXECUTE FUNCTION reject_direct_aiceo_promoted_insert();
REVOKE INSERT, UPDATE, DELETE ON aiceo_promoted_memories FROM PUBLIC;
REVOKE UPDATE, DELETE ON aiceo_memory_events FROM PUBLIC;