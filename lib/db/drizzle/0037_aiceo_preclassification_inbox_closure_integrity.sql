ALTER TABLE aiceo_preclassification_memory_inbox
  ADD CONSTRAINT aiceo_preclassification_inbox_manifest_fk
  FOREIGN KEY(seed_batch_key,stable_key)
  REFERENCES aiceo_preclassification_seed_manifest(seed_batch_key,stable_key);

ALTER TABLE aiceo_preclassification_memory_inbox
  DISABLE TRIGGER aiceo_preclassification_inbox_immutable;
UPDATE aiceo_preclassification_memory_inbox SET migration_contract_hash=encode(digest(
  record_hash||':'||source_digest||':'||migration_requirements::text||':'||
  preserve_source_context_time_snapshot::text,'sha256'),'hex');
ALTER TABLE aiceo_preclassification_memory_inbox
  ENABLE TRIGGER aiceo_preclassification_inbox_immutable;

CREATE OR REPLACE FUNCTION aiceo_preclassification_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_digest text;
BEGIN
  SELECT raw_semantics_digest INTO expected_digest FROM aiceo_preclassification_seed_manifest
    WHERE seed_batch_key=NEW.seed_batch_key AND stable_key=NEW.stable_key;
  IF NOT FOUND OR expected_digest<>encode(digest(NEW.raw_semantics,'sha256'),'hex') THEN
    RAISE EXCEPTION 'pre-classification record is not in the sealed Owner seed manifest'; END IF;
  IF NOT NEW.preserve_source_context_time_snapshot THEN
    RAISE EXCEPTION 'future migration must preserve the source context and time snapshot'; END IF;
  NEW.migration_contract_hash:=encode(digest(
    NEW.record_hash||':'||NEW.source_digest||':'||NEW.migration_requirements::text||':'||
    NEW.preserve_source_context_time_snapshot::text,'sha256'),'hex');
  RETURN NEW;
END; $$;

COMMENT ON TABLE aiceo_preclassification_memory_inbox IS
  'Trusted DB owner/migration boundary; PUBLIC has no access. Runtime constraints remain trigger-enforced. No HTTP, retrieval, promotion, decision, alert, or governance consumer.';