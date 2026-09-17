CREATE TABLE aiceo_preclassification_memory_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiceo_continuity_projects(id),
  seed_batch_key varchar(120) NOT NULL,
  stable_key varchar(160) NOT NULL,
  raw_semantics text NOT NULL,
  source_type varchar(40) NOT NULL CHECK (source_type='owner_statement'),
  source_context jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  future_classification_hints varchar(80)[] NOT NULL,
  value_tier varchar(16) NOT NULL CHECK (value_tier='high'),
  epistemic_state varchar(48) NOT NULL CHECK (epistemic_state='pre_classification_unverified'),
  lifecycle varchar(64) NOT NULL CHECK (lifecycle='awaiting_scientific_classification'),
  migration_requirements jsonb NOT NULL,
  source_digest varchar(64) NOT NULL,
  append_sequence bigint NOT NULL,
  previous_hash varchar(64),
  record_hash varchar(64) NOT NULL,
  operational_input boolean NOT NULL DEFAULT false CHECK (operational_input=false),
  retrieval_authority boolean NOT NULL DEFAULT false CHECK (retrieval_authority=false),
  promotion_authority boolean NOT NULL DEFAULT false CHECK (promotion_authority=false),
  governance_authority boolean NOT NULL DEFAULT false CHECK (governance_authority=false),
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,stable_key),
  UNIQUE(project_id,append_sequence)
);
CREATE INDEX aiceo_preclassification_inbox_batch_idx
  ON aiceo_preclassification_memory_inbox(project_id,seed_batch_key,append_sequence);

CREATE OR REPLACE FUNCTION aiceo_preclassification_inbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; next_sequence bigint; previous text;
  allowed_hints text[]:=ARRAY[
    'decision_memory','knowledge_memory','experience_learning_memory',
    'collaboration_memory','project_roadmap_memory'
  ]; expected_requirements jsonb:=jsonb_build_object(
    'scientificClassificationRequired',true,
    'allowSplitIntoMultipleFormalNodes',true,
    'preserveOriginInboxId',true,
    'preserveOriginHash',true,
    'independentValidationRequired',true,
    'ownerApprovedMigrationRequired',true,
    'noAutomaticPromotion',true
  );
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pre-classification inbox control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects
    WHERE id=NEW.project_id AND project_key='aiceo';
  IF NOT FOUND OR p.environment<>'development' OR p.authority<>'grok_restricted_development'
    OR p.production_authority THEN RAISE EXCEPTION 'pre-classification inbox project boundary violation'; END IF;
  IF btrim(NEW.raw_semantics)='' OR btrim(NEW.stable_key)='' OR btrim(NEW.seed_batch_key)='' THEN
    RAISE EXCEPTION 'pre-classification inbox raw semantics and stable identity are required'; END IF;
  IF jsonb_typeof(NEW.source_context)<>'object'
    OR NEW.source_context->>'classificationDeferred' IS DISTINCT FROM 'true'
    OR coalesce(NEW.source_context->>'context','')=''
    OR NEW.observed_at>now()
  THEN RAISE EXCEPTION 'pre-classification inbox source context or time is invalid'; END IF;
  IF cardinality(NEW.future_classification_hints)=0
    OR cardinality(NEW.future_classification_hints)<>cardinality(ARRAY(
      SELECT DISTINCT hint FROM unnest(NEW.future_classification_hints) hint))
    OR EXISTS (SELECT 1 FROM unnest(NEW.future_classification_hints) hint
      WHERE NOT hint=ANY(allowed_hints))
  THEN RAISE EXCEPTION 'pre-classification hints are non-authoritative and must use the scientific destination whitelist'; END IF;
  IF NEW.migration_requirements<>expected_requirements THEN
    RAISE EXCEPTION 'pre-classification migration must preserve origin provenance and require later scientific validation'; END IF;
  IF NEW.operational_input OR NEW.retrieval_authority OR NEW.promotion_authority
    OR NEW.governance_authority OR NEW.production_authority
  THEN RAISE EXCEPTION 'pre-classification inbox grants no operational or governance authority'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence
    FROM aiceo_preclassification_memory_inbox WHERE project_id=NEW.project_id;
  SELECT record_hash INTO previous FROM aiceo_preclassification_memory_inbox
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence;
  NEW.previous_hash:=previous;
  NEW.source_digest:=encode(digest(
    NEW.raw_semantics||':'||NEW.source_type||':'||NEW.source_context::text||':'||NEW.observed_at::text,
    'sha256'),'hex');
  NEW.record_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.id::text||':'||NEW.seed_batch_key||':'||NEW.stable_key||':'||
    NEW.raw_semantics||':'||NEW.source_type||':'||NEW.source_context::text||':'||NEW.observed_at::text||':'||
    NEW.future_classification_hints::text||':'||NEW.value_tier||':'||NEW.epistemic_state||':'||
    NEW.lifecycle||':'||NEW.migration_requirements::text||':'||NEW.source_digest||':'||
    next_sequence::text||':'||coalesce(previous,'')||':'||NEW.operational_input::text||':'||
    NEW.retrieval_authority::text||':'||NEW.promotion_authority::text||':'||
    NEW.governance_authority::text||':'||NEW.production_authority::text,'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_preclassification_inbox_guard
BEFORE INSERT ON aiceo_preclassification_memory_inbox
FOR EACH ROW EXECUTE FUNCTION aiceo_preclassification_inbox_guard();

CREATE OR REPLACE FUNCTION reject_aiceo_preclassification_inbox_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'pre-classification inbox records are immutable provenance roots'; END; $$;
CREATE TRIGGER aiceo_preclassification_inbox_immutable
BEFORE UPDATE OR DELETE ON aiceo_preclassification_memory_inbox
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_preclassification_inbox_mutation();