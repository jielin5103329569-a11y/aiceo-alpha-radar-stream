CREATE TABLE aiceo_thought_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id uuid NOT NULL,
  project_id uuid NOT NULL,
  memory_candidate_id uuid NOT NULL UNIQUE REFERENCES aiceo_memory_candidates(id),
  node_kind varchar(32) NOT NULL CHECK (node_kind IN (
    'motivation','context','observation','interpretation','belief','hypothesis','principle',
    'decision','action','outcome','reflection','updated_belief','next_decision'
  )),
  epistemic_state varchar(32) NOT NULL CHECK (epistemic_state IN (
    'unverified','observed','inferred','hypothesized','proposed','contradicted','inconclusive'
  )),
  parent_node_id uuid REFERENCES aiceo_thought_nodes(id),
  relation_from_parent varchar(32),
  supersedes_node_id uuid REFERENCES aiceo_thought_nodes(id),
  intended_result text,
  outcome_validation jsonb NOT NULL DEFAULT '{"status":"not_applicable"}'::jsonb,
  counterfactuals jsonb NOT NULL DEFAULT '[]'::jsonb,
  append_sequence bigint NOT NULL,
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(graph_id,append_sequence)
);
CREATE INDEX aiceo_thought_node_project_graph_idx ON aiceo_thought_nodes(project_id,graph_id,append_sequence);

CREATE OR REPLACE FUNCTION aiceo_thought_node_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c aiceo_memory_candidates%ROWTYPE; parent aiceo_thought_nodes%ROWTYPE;
  superseded aiceo_thought_nodes%ROWTYPE; expected_parent text; next_sequence bigint;
  validation_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.graph_id::text));
  SELECT * INTO c FROM aiceo_memory_candidates WHERE id=NEW.memory_candidate_id AND project_id=NEW.project_id;
  IF NOT FOUND OR c.lifecycle<>'candidate' OR c.truth_level<>'unverified'
    OR c.authority_level NOT IN ('ordinary_agent','external_source')
  THEN RAISE EXCEPTION 'thought node requires an unverified non-authoritative candidate'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(c.evidence_lineage) e
    WHERE lower(e->>'sourceType') NOT IN ('thought_node','memory_candidate','internal_memory')
  ) THEN RAISE EXCEPTION 'past thought cannot be the sole evidence for a thought node'; END IF;
  IF c.memory_type <> (CASE
    WHEN NEW.node_kind IN ('motivation','context','observation','action','outcome') THEN 'observation'
    WHEN NEW.node_kind IN ('interpretation','reflection') THEN 'interpretation'
    ELSE 'hypothesis' END)
  THEN RAISE EXCEPTION 'thought stage is not bound to the candidate cognitive type'; END IF;
  IF NEW.production_authority THEN RAISE EXCEPTION 'thought continuity grants no production authority'; END IF;
  IF NEW.parent_node_id IS NULL THEN
    IF NEW.node_kind<>'motivation' OR NEW.relation_from_parent IS NOT NULL THEN
      RAISE EXCEPTION 'thought graph root must be motivation'; END IF;
    IF EXISTS (SELECT 1 FROM aiceo_thought_nodes WHERE graph_id=NEW.graph_id) THEN
      RAISE EXCEPTION 'thought graph already has a root'; END IF;
  ELSE
    SELECT * INTO parent FROM aiceo_thought_nodes
      WHERE id=NEW.parent_node_id AND graph_id=NEW.graph_id AND project_id=NEW.project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'thought parent must be in the same project and graph'; END IF;
    expected_parent := CASE NEW.node_kind
      WHEN 'context' THEN 'motivation' WHEN 'observation' THEN 'context'
      WHEN 'interpretation' THEN 'observation'
      WHEN 'belief' THEN 'interpretation' WHEN 'hypothesis' THEN 'interpretation'
      WHEN 'principle' THEN 'belief|hypothesis' WHEN 'decision' THEN 'principle'
      WHEN 'action' THEN 'decision' WHEN 'outcome' THEN 'action'
      WHEN 'reflection' THEN 'outcome' WHEN 'updated_belief' THEN 'reflection'
      WHEN 'next_decision' THEN 'updated_belief' ELSE '' END;
    IF parent.node_kind !~ ('^('||expected_parent||')$') THEN
      RAISE EXCEPTION 'invalid thought continuity transition'; END IF;
    IF coalesce(NEW.relation_from_parent,'')='' THEN RAISE EXCEPTION 'thought causal relation is required'; END IF;
  END IF;
  IF NEW.node_kind IN ('decision','action','next_decision') AND coalesce(NEW.intended_result,'')='' THEN
    RAISE EXCEPTION 'decision/action requires an intended result'; END IF;
  IF NEW.node_kind IN ('decision','next_decision')
    AND (jsonb_typeof(NEW.counterfactuals)<>'array' OR jsonb_array_length(NEW.counterfactuals)=0)
  THEN RAISE EXCEPTION 'decision requires explicit counterfactuals'; END IF;
  validation_status := NEW.outcome_validation->>'status';
  IF NEW.node_kind IN ('outcome','reflection','updated_belief','next_decision')
    AND coalesce(validation_status,'pending') IN ('pending','not_applicable')
  THEN RAISE EXCEPTION 'post-action thought requires outcome validation'; END IF;
  IF NEW.node_kind='updated_belief' THEN
    SELECT * INTO superseded FROM aiceo_thought_nodes
      WHERE id=NEW.supersedes_node_id AND graph_id=NEW.graph_id AND project_id=NEW.project_id
        AND node_kind IN ('belief','hypothesis','principle','decision','updated_belief');
    IF NOT FOUND THEN RAISE EXCEPTION 'updated belief must supersede an earlier belief or judgment'; END IF;
  ELSIF NEW.supersedes_node_id IS NOT NULL THEN
    RAISE EXCEPTION 'only updated belief may supersede prior thought in G1-001';
  END IF;
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence
    FROM aiceo_thought_nodes WHERE graph_id=NEW.graph_id;
  NEW.append_sequence:=next_sequence;
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_thought_node_guard BEFORE INSERT ON aiceo_thought_nodes
FOR EACH ROW EXECUTE FUNCTION aiceo_thought_node_guard();
CREATE OR REPLACE FUNCTION reject_aiceo_thought_node_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'G1-001 thought continuity nodes are immutable'; END; $$;
CREATE TRIGGER aiceo_thought_node_append_only BEFORE UPDATE OR DELETE ON aiceo_thought_nodes
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_thought_node_mutation();