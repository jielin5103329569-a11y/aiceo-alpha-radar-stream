CREATE OR REPLACE FUNCTION aiceo_memory_event_db_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h text; canonical text;
BEGIN
  IF current_setting('aiceo.memory_event_guard', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'memory events require controlled append function';
  END IF;
  INSERT INTO aiceo_memory_chain_heads(project_id, head_hash) VALUES (NEW.project_id, NULL)
    ON CONFLICT (project_id) DO NOTHING;
  SELECT head_hash INTO h FROM aiceo_memory_chain_heads WHERE project_id=NEW.project_id FOR UPDATE;
  NEW.previous_hash := h;
  canonical := NEW.project_id::text || ':' || coalesce(NEW.candidate_id::text,'') || ':' ||
    coalesce(NEW.promoted_memory_id::text,'') || ':' || NEW.event_type || ':' || NEW.actor_id || ':' ||
    coalesce(h,'') || ':' || NEW.payload::text;
  NEW.event_hash := encode(digest(canonical, 'sha256'), 'hex');
  UPDATE aiceo_memory_chain_heads SET head_hash=NEW.event_hash, updated_at=now()
    WHERE project_id=NEW.project_id;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_append_memory_event(
  p_project uuid, p_candidate uuid, p_promoted uuid, p_type text,
  p_actor text, p_authority text, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_id uuid;
BEGIN
  PERFORM set_config('aiceo.memory_event_guard','1',true);
  INSERT INTO aiceo_memory_events(
    project_id,candidate_id,promoted_memory_id,event_type,actor_id,actor_authority,payload,event_hash
  ) VALUES (p_project,p_candidate,p_promoted,p_type,p_actor,p_authority,p_payload,'db-owned')
  RETURNING id INTO event_id;
  PERFORM set_config('aiceo.memory_event_guard','0',true);
  RETURN event_id;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_promote_memory(p_candidate uuid, p_project uuid, p_actor text, p_authority text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c aiceo_memory_candidates%ROWTYPE; m uuid;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'memory control gate is closed'; END IF;
  SELECT * INTO c FROM aiceo_memory_candidates WHERE id=p_candidate AND project_id=p_project
    AND lifecycle='candidate' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate missing, wrong project, or already promoted'; END IF;
  IF c.memory_layer='governance' AND p_authority NOT IN ('owner','governance') THEN RAISE EXCEPTION 'governance owner gate'; END IF;
  IF c.memory_layer<>'governance' AND p_authority NOT IN ('brain','owner') THEN RAISE EXCEPTION 'brain authority required'; END IF;
  IF c.memory_type<>c.cognitive_state THEN RAISE EXCEPTION 'memory type/state matrix violation'; END IF;
  IF c.memory_type IN ('fact','rule','decision') AND c.truth_level NOT IN ('verified','owner_asserted') THEN RAISE EXCEPTION 'insufficient truth'; END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until<=now() THEN RAISE EXCEPTION 'expired candidate'; END IF;
  PERFORM set_config('aiceo.memory_promotion_guard','1',true);
  INSERT INTO aiceo_promoted_memories(candidate_id,candidate_project_id,project_id,content,memory_layer,memory_type,cognitive_state,truth_level,authority_level,evidence_lineage,valid_from,valid_until,promoted_by,production_authority)
    VALUES(c.id,c.project_id,c.project_id,c.content,c.memory_layer,c.memory_type,c.cognitive_state,c.truth_level,p_authority,c.evidence_lineage,c.valid_from,c.valid_until,p_actor,false) RETURNING id INTO m;
  UPDATE aiceo_memory_candidates SET lifecycle='promoted' WHERE id=c.id AND lifecycle='candidate';
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate lifecycle race'; END IF;
  PERFORM aiceo_append_memory_event(c.project_id,c.id,m,'memory_promoted',p_actor,p_authority,
    jsonb_build_object('contentHash', encode(digest(c.content || ':' || c.evidence_lineage::text,'sha256'),'hex')));
  RETURN m;
END; $$;

REVOKE INSERT, UPDATE, DELETE ON aiceo_memory_events FROM PUBLIC;