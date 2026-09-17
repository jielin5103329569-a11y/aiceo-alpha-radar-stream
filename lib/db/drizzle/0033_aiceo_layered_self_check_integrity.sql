CREATE TABLE aiceo_self_check_chain_contracts (
  chain_key varchar(120) PRIMARY KEY,
  contract_version varchar(32) NOT NULL CHECK (contract_version='G1-001-SC-1'),
  required_module_keys varchar(120)[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  CHECK (cardinality(required_module_keys)>0)
);
INSERT INTO aiceo_self_check_chain_contracts(chain_key,contract_version,required_module_keys)
VALUES('g1-memory','G1-001-SC-1',ARRAY['memory-candidate','memory-event','thought-node']);

CREATE OR REPLACE FUNCTION reject_aiceo_self_check_contract_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AICEO self-check chain contracts are migration-owned and immutable'; END; $$;
CREATE TRIGGER aiceo_self_check_contract_immutable BEFORE UPDATE OR DELETE ON aiceo_self_check_chain_contracts
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_self_check_contract_mutation();

CREATE OR REPLACE FUNCTION aiceo_self_check_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p aiceo_continuity_projects%ROWTYPE; contract aiceo_self_check_chain_contracts%ROWTYPE;
  child_count int; worst int; expected_status text; next_sequence bigint; previous text;
  e jsonb; required_count int; active_chain_count int;
BEGIN
  PERFORM 1 FROM aiceo_control_state
    WHERE queue_active=true AND kill_switch=false AND circuit_state='CLOSED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'self-check control gate is closed'; END IF;
  SELECT * INTO p FROM aiceo_continuity_projects WHERE id=NEW.project_id AND project_key='aiceo';
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
    SELECT * INTO contract FROM aiceo_self_check_chain_contracts WHERE chain_key=NEW.chain_key AND active;
    IF NOT FOUND OR NOT (NEW.module_key=ANY(contract.required_module_keys))
      OR cardinality(NEW.child_report_ids)<>0 OR NEW.diagnostic_depth<>'summary'
      OR NEW.raw_payload_included OR NEW.escalation NOT IN ('none','chain')
    THEN RAISE EXCEPTION 'local self-check contract violation'; END IF;
    IF NOT (NEW.dimensions ?& ARRAY['input','output','state','permission','evidence','version','freshness','invariant'])
      OR NEW.dimensions - ARRAY['input','output','state','permission','evidence','version','freshness','invariant'] <> '{}'::jsonb
      OR EXISTS (SELECT 1 FROM jsonb_each_text(NEW.dimensions) d
        WHERE d.value NOT IN ('healthy','degraded','failed','unknown'))
    THEN RAISE EXCEPTION 'local self-check dimensions are incomplete or invalid'; END IF;
    SELECT max(CASE value WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END)
      INTO worst FROM jsonb_each_text(NEW.dimensions);
  ELSIF NEW.scope='chain' THEN
    SELECT * INTO contract FROM aiceo_self_check_chain_contracts WHERE chain_key=NEW.chain_key AND active;
    IF NOT FOUND OR NEW.module_key IS NOT NULL OR cardinality(NEW.child_report_ids)=0
      OR NEW.diagnostic_depth<>'summary' OR NEW.raw_payload_included
      OR NEW.escalation NOT IN ('none','global')
    THEN RAISE EXCEPTION 'chain self-check contract violation'; END IF;
    required_count:=cardinality(contract.required_module_keys);
    SELECT count(*),max(CASE r.status WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END)
      INTO child_count,worst FROM aiceo_self_check_reports r
      WHERE r.id=ANY(NEW.child_report_ids) AND r.project_id=NEW.project_id
        AND r.run_id=NEW.run_id AND r.chain_key=NEW.chain_key AND r.scope='local'
        AND r.checked_at<=NEW.checked_at AND r.valid_until>NEW.checked_at
        AND r.contract_version=NEW.contract_version;
    IF child_count<>cardinality(NEW.child_report_ids) OR child_count<>required_count
      OR EXISTS (SELECT 1 FROM unnest(contract.required_module_keys) required
        WHERE NOT EXISTS (SELECT 1 FROM aiceo_self_check_reports r
          WHERE r.id=ANY(NEW.child_report_ids) AND r.module_key=required))
    THEN RAISE EXCEPTION 'chain self-check children are incomplete, stale, or cross-boundary'; END IF;
  ELSE
    IF NEW.module_key IS NOT NULL OR NEW.chain_key<>'global' OR cardinality(NEW.child_report_ids)=0
    THEN RAISE EXCEPTION 'global self-check contract violation'; END IF;
    SELECT count(*) INTO active_chain_count FROM aiceo_self_check_chain_contracts WHERE active;
    SELECT count(*),max(CASE r.status WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END)
      INTO child_count,worst FROM aiceo_self_check_reports r
      WHERE r.id=ANY(NEW.child_report_ids) AND r.project_id=NEW.project_id
        AND r.run_id=NEW.run_id AND r.scope='chain'
        AND r.checked_at<=NEW.checked_at AND r.valid_until>NEW.checked_at
        AND r.contract_version=NEW.contract_version;
    IF child_count<>cardinality(NEW.child_report_ids) OR child_count<>active_chain_count
      OR EXISTS (SELECT 1 FROM aiceo_self_check_chain_contracts c WHERE c.active
        AND NOT EXISTS (SELECT 1 FROM aiceo_self_check_reports r
          WHERE r.id=ANY(NEW.child_report_ids) AND r.chain_key=c.chain_key))
    THEN RAISE EXCEPTION 'global self-check children are incomplete, stale, or cross-boundary'; END IF;
    IF NEW.diagnostic_depth='summary' THEN
      IF NEW.raw_payload_included OR NEW.escalation<>'none' OR NEW.escalation_reason IS NOT NULL THEN
        RAISE EXCEPTION 'global summary cannot scan raw payloads or claim deep escalation'; END IF;
    ELSIF NEW.diagnostic_depth='deep' THEN
      IF NOT NEW.raw_payload_included OR NEW.escalation<>'global' OR coalesce(NEW.escalation_reason,'')='' THEN
        RAISE EXCEPTION 'global deep check requires explicit escalation evidence'; END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.anomalies) a
        WHERE a IN ('chain_unexplained','cross_chain_conflict'))
      THEN RAISE EXCEPTION 'global deep check requires unexplained chain or cross-chain conflict'; END IF;
    END IF;
  END IF;

  IF NEW.scope IN ('chain','global') AND EXISTS (
    SELECT 1 FROM aiceo_self_check_reports r WHERE r.id=ANY(NEW.child_report_ids)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.evidence_lineage) evidence
      WHERE evidence->>'sourceType'='self_check_report'
        AND evidence->>'sourceId'=r.id::text AND evidence->>'evidenceHash'=r.report_hash)
  ) THEN RAISE EXCEPTION 'aggregate evidence is not bound to child report hashes'; END IF;

  expected_status:=CASE worst WHEN 0 THEN 'healthy' WHEN 1 THEN 'degraded' WHEN 2 THEN 'failed' ELSE 'unknown' END;
  IF NEW.status<>expected_status THEN RAISE EXCEPTION 'self-check aggregate cannot be healthier than its evidence'; END IF;
  IF NEW.status='healthy' AND (jsonb_array_length(NEW.anomalies)>0 OR jsonb_array_length(NEW.fault_domains)>0) THEN
    RAISE EXCEPTION 'healthy self-check cannot carry anomalies or fault domains'; END IF;
  IF NEW.status<>'healthy' AND jsonb_array_length(NEW.anomalies)=0 THEN
    RAISE EXCEPTION 'unhealthy self-check requires anomalies'; END IF;
  IF NEW.scope='local' AND NEW.status<>'healthy' AND NEW.escalation<>'chain' THEN
    RAISE EXCEPTION 'unhealthy local self-check must escalate to chain'; END IF;
  IF NEW.scope='chain' AND NEW.status<>'healthy' THEN
    IF NEW.escalation<>'global' OR jsonb_array_length(NEW.fault_domains)=0
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.fault_domains) f
        WHERE NOT EXISTS (SELECT 1 FROM aiceo_self_check_reports r
          WHERE r.id=ANY(NEW.child_report_ids) AND r.module_key=f))
    THEN RAISE EXCEPTION 'unhealthy chain requires valid fault-domain localization and global escalation'; END IF;
  END IF;
  IF NEW.scope='global' AND NEW.status<>'healthy' AND (
    jsonb_array_length(NEW.fault_domains)=0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.fault_domains) f
      WHERE NOT EXISTS (SELECT 1 FROM aiceo_self_check_reports r
        WHERE r.id=ANY(NEW.child_report_ids) AND r.chain_key=f)
    )
  ) THEN RAISE EXCEPTION 'unhealthy global check requires valid chain fault domains'; END IF;
  IF NEW.independent_validation OR NEW.closure_authority OR NEW.production_authority THEN
    RAISE EXCEPTION 'self-check report cannot grant authority or independent validation'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence FROM aiceo_self_check_reports WHERE project_id=NEW.project_id;
  SELECT report_hash INTO previous FROM aiceo_self_check_reports
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  NEW.append_sequence:=next_sequence; NEW.previous_hash:=previous;
  NEW.report_hash:=encode(digest(
    NEW.project_id::text||':'||NEW.run_id::text||':'||NEW.scope||':'||NEW.chain_key||':'||
    coalesce(NEW.module_key,'')||':'||NEW.contract_version||':'||NEW.status||':'||
    NEW.checked_at::text||':'||NEW.valid_until::text||':'||NEW.dimensions::text||':'||
    NEW.summary::text||':'||NEW.anomalies::text||':'||NEW.evidence_lineage::text||':'||
    NEW.child_report_ids::text||':'||NEW.fault_domains::text||':'||NEW.escalation||':'||
    NEW.diagnostic_depth||':'||coalesce(NEW.escalation_reason,'')||':'||
    NEW.raw_payload_included::text||':'||next_sequence::text||':'||coalesce(previous,'')||':'||
    NEW.independent_validation::text||':'||NEW.closure_authority::text||':'||NEW.production_authority::text,
    'sha256'),'hex');
  RETURN NEW;
END; $$;