DROP TRIGGER aiceo_self_check_contract_immutable ON aiceo_self_check_chain_contracts;
CREATE TRIGGER aiceo_self_check_contract_immutable
BEFORE INSERT OR UPDATE OR DELETE ON aiceo_self_check_chain_contracts
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_self_check_contract_mutation();

CREATE OR REPLACE FUNCTION aiceo_self_check_registry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical_count int;
BEGIN
  SELECT count(*) INTO canonical_count FROM aiceo_self_check_chain_contracts;
  IF canonical_count<>1 OR NOT EXISTS (
    SELECT 1 FROM aiceo_self_check_chain_contracts
    WHERE chain_key='g1-memory' AND contract_version='G1-001-SC-1' AND active
      AND production_authority=false
      AND required_module_keys=ARRAY['memory-candidate','memory-event','thought-node']::varchar[]
      AND cardinality(required_module_keys)=cardinality(ARRAY(
        SELECT DISTINCT module_key FROM unnest(required_module_keys) module_key
      ))
      AND NOT EXISTS (SELECT 1 FROM unnest(required_module_keys) module_key WHERE btrim(module_key)='')
  ) THEN RAISE EXCEPTION 'self-check chain registry is not the canonical migration-owned contract'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_self_check_registry_guard
BEFORE INSERT ON aiceo_self_check_reports
FOR EACH ROW EXECUTE FUNCTION aiceo_self_check_registry_guard();