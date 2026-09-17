CREATE TABLE aiceo_self_check_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiceo_continuity_projects(id),
  run_id uuid NOT NULL,
  scope varchar(16) NOT NULL CHECK (scope IN ('local','chain','global')),
  chain_key varchar(120) NOT NULL,
  module_key varchar(120),
  contract_version varchar(32) NOT NULL CHECK (contract_version='G1-001-SC-1'),
  status varchar(16) NOT NULL CHECK (status IN ('healthy','degraded','failed','unknown')),
  checked_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL,
  anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_lineage jsonb NOT NULL,
  child_report_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  fault_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation varchar(16) NOT NULL CHECK (escalation IN ('none','chain','global')),
  diagnostic_depth varchar(16) NOT NULL CHECK (diagnostic_depth IN ('summary','deep')),
  escalation_reason text,
  raw_payload_included boolean NOT NULL DEFAULT false,
  append_sequence bigint NOT NULL,
  previous_hash varchar(128),
  report_hash varchar(128) NOT NULL,
  independent_validation boolean NOT NULL DEFAULT false CHECK (independent_validation=false),
  closure_authority boolean NOT NULL DEFAULT false CHECK (closure_authority=false),
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,append_sequence)
);
CREATE UNIQUE INDEX aiceo_self_check_local_once
  ON aiceo_self_check_reports(project_id,run_id,chain_key,module_key) WHERE scope='local';
CREATE UNIQUE INDEX aiceo_self_check_chain_once
  ON aiceo_self_check_reports(project_id,run_id,chain_key) WHERE scope='chain';
CREATE UNIQUE INDEX aiceo_self_check_global_once
  ON aiceo_self_check_reports(project_id,run_id) WHERE scope='global';
CREATE INDEX aiceo_self_check_health_idx
  ON aiceo_self_check_reports(project_id,scope,chain_key,checked_at DESC);

CREATE OR REPLACE FUNCTION aiceo_self_check_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; child_count int; worst int; expected_status text;
  next_sequence bigint; previous text; e jsonb; anomaly text;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'self-check control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects
    WHERE id=NEW.project_id AND project_key='aiceo';
  IF NOT FOUND OR p.environment<>'development' OR p.authority<>'grok_restricted_development'
    OR p.production_authority THEN RAISE EXCEPTION 'self-check canonical project boundary violation'; END IF;
  IF NEW.checked_at>now() OR NEW.valid_until<=now() OR NEW.valid_until<=NEW.checked_at THEN
    RAISE EXCEPTION 'self-check freshness interval is invalid'; END IF;
  IF jsonb_typeof(NEW.anomalies)<>'array' OR jsonb_typeof(NEW.evidence_lineage)<>'array'
    OR jsonb_array_length(NEW.evidence_lineage)=0 OR jsonb_typeof(NEW.fault_domains)<>'array'
  THEN RAISE EXCEPTION 'self-check trace evidence shape is invalid'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(NEW.evidence_lineage) LOOP
    IF coalesce(e->>'sourceType','')='' OR coalesce(e->>'sourceId','')=''
      OR coalesce(e->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'self-check evidence provenance is invalid'; END IF;
  END LOOP;

  IF NEW.scope='local' THEN
    IF coalesce(NEW.module_key,'')='' OR cardinality(NEW.child_report_ids)<>0
      OR NEW.diagnostic_depth<>'summary' OR NEW.raw_payload_included
      OR NEW.escalation NOT IN ('none','chain')
    THEN RAISE EXCEPTION 'local self-check contract violation'; END IF;
    IF NOT (NEW.dimensions ?& ARRAY['input','output','state','permission','evidence','version','freshness','invariant']) THEN
      RAISE EXCEPTION 'local self-check dimensions are incomplete'; END IF;
    SELECT max(CASE value
      WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'failed' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END)
      INTO worst FROM jsonb_each_text(NEW.dimensions)
      WHERE key=ANY(ARRAY['input','output','state','permission','evidence','version','freshness','invariant']);
  ELSIF NEW.scope='chain' THEN
    IF NEW.module_key IS NOT NULL OR cardinality(NEW.child_report_ids)=0
      OR NEW.diagnostic_depth<>'summary' OR NEW.raw_payload_included
      OR NEW.escalation NOT IN ('none','global')
    THEN RAISE EXCEPTION 'chain self-check contract violation'; END IF;
    SELECT count(*),max(CASE r.status
      WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END)
      INTO child_count,worst FROM aiceo_self_check_reports r
      WHERE r.id=ANY(NEW.child_report_ids) AND r.project_id=NEW.project_id
        AND r.run_id=NEW.run_id AND r.chain_key=NEW.chain_key AND r.scope='local'
        AND r.valid_until>now();
    IF child_count<>cardinality(NEW.child_report_ids) THEN
      RAISE EXCEPTION 'chain self-check children are missing, stale, or cross-boundary'; END IF;
  ELSE
    IF NEW.module_key IS NOT NULL OR NEW.chain_key<>'global' OR cardinality(NEW.child_report_ids)=0
      OR NEW.escalation<>'none'
    THEN RAISE EXCEPTION 'global self-check contract violation'; END IF;
    SELECT count(*),max(CASE r.status
      WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END)
      INTO child_count,worst FROM aiceo_self_check_reports r
      WHERE r.id=ANY(NEW.child_report_ids) AND r.project_id=NEW.project_id
        AND r.run_id=NEW.run_id AND r.scope='chain' AND r.valid_until>now();
    IF child_count<>cardinality(NEW.child_report_ids) THEN
      RAISE EXCEPTION 'global self-check children are missing, stale, or cross-boundary'; END IF;
    IF NEW.diagnostic_depth='summary' AND NEW.raw_payload_included THEN
      RAISE EXCEPTION 'global summary cannot scan raw payloads'; END IF;
    IF NEW.diagnostic_depth='deep' THEN
      IF NOT NEW.raw_payload_included OR coalesce(NEW.escalation_reason,'')='' THEN
        RAISE EXCEPTION 'global deep check requires explicit escalation evidence'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.anomalies) a
        WHERE a IN ('chain_unexplained','cross_chain_conflict')
      ) THEN RAISE EXCEPTION 'global deep check requires unexplained chain or cross-chain conflict'; END IF;
    ELSIF NEW.escalation_reason IS NOT NULL THEN
      RAISE EXCEPTION 'global summary cannot claim deep escalation'; END IF;
  END IF;
  expected_status:=CASE worst WHEN 0 THEN 'healthy' WHEN 1 THEN 'degraded' WHEN 2 THEN 'failed' ELSE 'unknown' END;
  IF NEW.status<>expected_status THEN
    RAISE EXCEPTION 'self-check aggregate cannot be healthier than its evidence'; END IF;
  IF NEW.status<>'healthy' AND jsonb_array_length(NEW.anomalies)=0 THEN
    RAISE EXCEPTION 'unhealthy self-check requires anomalies'; END IF;
  IF NEW.scope='chain' AND NEW.status<>'healthy' AND jsonb_array_length(NEW.fault_domains)=0 THEN
    RAISE EXCEPTION 'unhealthy chain requires fault-domain localization'; END IF;
  IF NEW.independent_validation OR NEW.closure_authority OR NEW.production_authority THEN
    RAISE EXCEPTION 'self-check report cannot grant authority or independent validation'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence
    FROM aiceo_self_check_reports WHERE project_id=NEW.project_id;
  SELECT report_hash INTO previous FROM aiceo_self_check_reports
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence;
  NEW.previous_hash:=previous;
  NEW.report_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.run_id::text||':'||NEW.scope||':'||NEW.chain_key||':'||
    coalesce(NEW.module_key,'')||':'||NEW.status||':'||NEW.checked_at::text||':'||
    NEW.valid_until::text||':'||NEW.summary::text||':'||NEW.anomalies::text||':'||
    NEW.evidence_lineage::text||':'||NEW.child_report_ids::text||':'||coalesce(previous,''),'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_self_check_report_guard BEFORE INSERT ON aiceo_self_check_reports
FOR EACH ROW EXECUTE FUNCTION aiceo_self_check_report_guard();

CREATE OR REPLACE FUNCTION reject_aiceo_self_check_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AICEO self-check reports are append-only diagnostics'; END; $$;
CREATE TRIGGER aiceo_self_check_append_only BEFORE UPDATE OR DELETE ON aiceo_self_check_reports
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_self_check_mutation();