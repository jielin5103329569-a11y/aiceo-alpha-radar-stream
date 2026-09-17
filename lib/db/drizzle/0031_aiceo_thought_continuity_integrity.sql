CREATE UNIQUE INDEX aiceo_thought_node_single_superseder
ON aiceo_thought_nodes(supersedes_node_id) WHERE supersedes_node_id IS NOT NULL;

CREATE OR REPLACE FUNCTION aiceo_thought_node_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c aiceo_memory_candidates%ROWTYPE; parent aiceo_thought_nodes%ROWTYPE;
  superseded aiceo_thought_nodes%ROWTYPE; action_node aiceo_thought_nodes%ROWTYPE;
  expected_parent text; next_sequence bigint; validation_status text; e jsonb; cf jsonb;
  observed timestamptz; expected_hash text; action_is_ancestor boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.graph_id::text));
  SELECT * INTO c FROM aiceo_memory_candidates WHERE id=NEW.memory_candidate_id AND project_id=NEW.project_id;
  IF NOT FOUND OR c.lifecycle<>'candidate' OR c.truth_level<>'unverified'
    OR c.authority_level NOT IN ('ordinary_agent','external_source')
  THEN RAISE EXCEPTION 'thought node requires an unverified non-authoritative candidate'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(c.evidence_lineage) LOOP
    IF lower(e->>'sourceType') NOT IN (
      'conversation_turn','owner_statement','observed_outcome','external_document',
      'sensor_observation','system_record'
    ) THEN RAISE EXCEPTION 'thought evidence requires an independent source type'; END IF;
    expected_hash:=encode(digest(
      c.content||':'||(e->>'sourceType')||':'||(e->>'sourceId')||':'||(e->>'observedAt'),'sha256'),'hex');
    IF e->>'evidenceHash' IS DISTINCT FROM expected_hash THEN
      RAISE EXCEPTION 'thought evidence is not bound to content and provenance'; END IF;
  END LOOP;
  IF c.memory_type <> (CASE
    WHEN NEW.node_kind IN ('motivation','context','observation','action','outcome') THEN 'observation'
    WHEN NEW.node_kind IN ('interpretation','reflection') THEN 'interpretation'
    ELSE 'hypothesis' END)
  THEN RAISE EXCEPTION 'thought stage is not bound to the candidate cognitive type'; END IF;
  IF NEW.production_authority THEN RAISE EXCEPTION 'thought continuity grants no production authority'; END IF;
  IF NEW.parent_node_id IS NULL THEN
    IF NEW.node_kind<>'motivation' OR NEW.relation_from_parent IS NOT NULL THEN RAISE EXCEPTION 'thought graph root must be motivation'; END IF;
    IF EXISTS (SELECT 1 FROM aiceo_thought_nodes WHERE graph_id=NEW.graph_id) THEN RAISE EXCEPTION 'thought graph already has a root'; END IF;
  ELSE
    SELECT * INTO parent FROM aiceo_thought_nodes WHERE id=NEW.parent_node_id AND graph_id=NEW.graph_id AND project_id=NEW.project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'thought parent must be in the same project and graph'; END IF;
    expected_parent := CASE NEW.node_kind
      WHEN 'context' THEN 'motivation' WHEN 'observation' THEN 'context' WHEN 'interpretation' THEN 'observation'
      WHEN 'belief' THEN 'interpretation' WHEN 'hypothesis' THEN 'interpretation'
      WHEN 'principle' THEN 'belief|hypothesis' WHEN 'decision' THEN 'principle' WHEN 'action' THEN 'decision'
      WHEN 'outcome' THEN 'action' WHEN 'reflection' THEN 'outcome'
      WHEN 'updated_belief' THEN 'reflection' WHEN 'next_decision' THEN 'updated_belief' ELSE '' END;
    IF parent.node_kind !~ ('^('||expected_parent||')$') THEN RAISE EXCEPTION 'invalid thought continuity transition'; END IF;
    IF coalesce(NEW.relation_from_parent,'')='' THEN RAISE EXCEPTION 'thought causal relation is required'; END IF;
  END IF;
  IF NEW.node_kind IN ('decision','action','next_decision') AND coalesce(NEW.intended_result,'')='' THEN
    RAISE EXCEPTION 'decision/action requires an intended result'; END IF;
  IF NEW.node_kind IN ('decision','next_decision') THEN
    IF jsonb_typeof(NEW.counterfactuals)<>'array' OR jsonb_array_length(NEW.counterfactuals)=0 THEN
      RAISE EXCEPTION 'decision requires explicit counterfactuals'; END IF;
    FOR cf IN SELECT value FROM jsonb_array_elements(NEW.counterfactuals) LOOP
      IF coalesce(cf->>'alternative','')='' OR coalesce(cf->>'assumption','')=''
        OR coalesce(cf->>'predictedOutcome','')=''
        OR lower(cf->>'sourceType') NOT IN ('conversation_turn','owner_statement','external_document','sensor_observation','system_record')
        OR coalesce(cf->>'sourceId','')='' OR coalesce(cf->>'observedAt','')=''
      THEN RAISE EXCEPTION 'counterfactual structure is invalid'; END IF;
      BEGIN observed:=(cf->>'observedAt')::timestamptz;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'counterfactual timestamp is invalid'; END;
      IF observed>now() THEN RAISE EXCEPTION 'counterfactual evidence cannot be future'; END IF;
      expected_hash:=encode(digest(
        (cf->>'alternative')||':'||(cf->>'assumption')||':'||(cf->>'predictedOutcome')||':'||
        (cf->>'sourceType')||':'||(cf->>'sourceId')||':'||(cf->>'observedAt'),'sha256'),'hex');
      IF cf->>'evidenceHash' IS DISTINCT FROM expected_hash THEN
        RAISE EXCEPTION 'counterfactual evidence is not bound to content and provenance'; END IF;
    END LOOP;
  END IF;
  validation_status:=NEW.outcome_validation->>'status';
  IF NEW.node_kind IN ('outcome','reflection','updated_belief','next_decision') THEN
    IF validation_status NOT IN ('matched','mismatched','mixed','inconclusive')
      OR coalesce(NEW.outcome_validation->>'actualResult','')=''
      OR coalesce(NEW.outcome_validation->>'observedAt','')=''
      OR lower(NEW.outcome_validation->>'sourceType') NOT IN ('observed_outcome','external_document','sensor_observation','system_record')
      OR coalesce(NEW.outcome_validation->>'sourceId','')=''
    THEN RAISE EXCEPTION 'post-action outcome validation is incomplete'; END IF;
    BEGIN observed:=(NEW.outcome_validation->>'observedAt')::timestamptz;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'outcome validation timestamp is invalid'; END;
    IF observed>now() THEN RAISE EXCEPTION 'outcome validation cannot be future'; END IF;
    expected_hash:=encode(digest(
      (NEW.outcome_validation->>'actualResult')||':'||(NEW.outcome_validation->>'sourceType')||':'||
      (NEW.outcome_validation->>'sourceId')||':'||(NEW.outcome_validation->>'observedAt')||':'||
      (NEW.outcome_validation->>'actionNodeId'),'sha256'),'hex');
    IF NEW.outcome_validation->>'evidenceHash' IS DISTINCT FROM expected_hash THEN
      RAISE EXCEPTION 'outcome evidence is not bound to result, provenance, and action'; END IF;
    SELECT * INTO action_node FROM aiceo_thought_nodes
      WHERE id=(NEW.outcome_validation->>'actionNodeId')::uuid
        AND graph_id=NEW.graph_id AND project_id=NEW.project_id AND node_kind='action';
    IF NOT FOUND THEN RAISE EXCEPTION 'outcome validation must bind to the causal action'; END IF;
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_node_id FROM aiceo_thought_nodes WHERE id=NEW.parent_node_id
      UNION ALL SELECT p.id,p.parent_node_id FROM aiceo_thought_nodes p JOIN ancestors a ON a.parent_node_id=p.id
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=action_node.id) INTO action_is_ancestor;
    IF NOT action_is_ancestor THEN RAISE EXCEPTION 'outcome action must be a causal ancestor'; END IF;
  END IF;
  IF NEW.node_kind='updated_belief' THEN
    SELECT * INTO superseded FROM aiceo_thought_nodes
      WHERE id=NEW.supersedes_node_id AND graph_id=NEW.graph_id AND project_id=NEW.project_id
        AND node_kind IN ('belief','hypothesis','principle','decision','updated_belief');
    IF NOT FOUND OR coalesce(NEW.outcome_validation->>'supersedeReason','')='' THEN
      RAISE EXCEPTION 'updated belief must supersede an earlier judgment with a reason'; END IF;
  ELSIF NEW.supersedes_node_id IS NOT NULL THEN
    RAISE EXCEPTION 'only updated belief may supersede prior thought in G1-001';
  END IF;
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence FROM aiceo_thought_nodes WHERE graph_id=NEW.graph_id;
  NEW.append_sequence:=next_sequence;
  RETURN NEW;
END; $$;