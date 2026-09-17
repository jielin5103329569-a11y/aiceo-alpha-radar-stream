DROP TABLE IF EXISTS aiceo_memory_chain_heads;

CREATE OR REPLACE FUNCTION aiceo_memory_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; e jsonb; observed timestamptz; efrom timestamptz; euntil timestamptz;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'memory control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects WHERE id=NEW.project_id AND project_key='aiceo';
  IF NOT FOUND OR p.environment<>'development' OR p.authority<>'grok_restricted_development' OR p.production_authority THEN
    RAISE EXCEPTION 'canonical AICEO project boundary violation';
  END IF;
  IF NEW.lifecycle<>'candidate' OR NEW.memory_type<>NEW.cognitive_state THEN
    RAISE EXCEPTION 'candidate lifecycle/type-state violation';
  END IF;
  IF NEW.authority_level NOT IN ('ordinary_agent','external_source')
    OR NEW.memory_type NOT IN ('observation','interpretation','hypothesis')
    OR NEW.truth_level<>'unverified'
  THEN RAISE EXCEPTION 'untrusted source cannot assert fact, decision, rule, or trusted truth'; END IF;
  IF NEW.valid_until IS NOT NULL AND NEW.valid_until<=now() THEN RAISE EXCEPTION 'candidate validity expired'; END IF;
  IF NEW.valid_from IS NOT NULL AND NEW.valid_until IS NOT NULL AND NEW.valid_until<=NEW.valid_from THEN
    RAISE EXCEPTION 'invalid candidate temporal interval';
  END IF;
  IF jsonb_typeof(NEW.evidence_lineage)<>'array' OR jsonb_array_length(NEW.evidence_lineage)=0 THEN
    RAISE EXCEPTION 'candidate evidence lineage is required';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(NEW.evidence_lineage) LOOP
    IF coalesce(e->>'sourceType','')='' OR coalesce(e->>'sourceId','')=''
      OR coalesce(e->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
      OR coalesce(e->>'observedAt','')=''
    THEN RAISE EXCEPTION 'candidate evidence provenance shape is invalid'; END IF;
    BEGIN
      observed := (e->>'observedAt')::timestamptz;
      efrom := CASE WHEN e ? 'validFrom' THEN (e->>'validFrom')::timestamptz ELSE NULL END;
      euntil := CASE WHEN e ? 'validUntil' THEN (e->>'validUntil')::timestamptz ELSE NULL END;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'candidate evidence timestamp is invalid';
    END;
    IF observed>now() OR (euntil IS NOT NULL AND euntil<=now())
      OR (efrom IS NOT NULL AND euntil IS NOT NULL AND euntil<=efrom)
    THEN RAISE EXCEPTION 'candidate evidence temporal validity is invalid'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION aiceo_memory_event_db_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h text; canonical text;
BEGIN
  IF current_setting('aiceo.memory_event_guard', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'memory events require candidate lifecycle trigger';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
  SELECT event_hash INTO h FROM aiceo_memory_events
    WHERE project_id=NEW.project_id ORDER BY created_at DESC,id DESC LIMIT 1;
  NEW.previous_hash := h;
  canonical := NEW.project_id::text || ':' || NEW.candidate_id::text || ':' ||
    NEW.event_type || ':' || NEW.actor_id || ':' || coalesce(h,'') || ':' || NEW.payload::text;
  NEW.event_hash := encode(digest(canonical, 'sha256'), 'hex');
  RETURN NEW;
END; $$;