CREATE TABLE aiceo_preclassification_seed_manifest (
  seed_batch_key varchar(120) NOT NULL,
  stable_key varchar(160) NOT NULL,
  raw_semantics_digest varchar(64) NOT NULL,
  production_authority boolean NOT NULL DEFAULT false CHECK (production_authority=false),
  PRIMARY KEY(seed_batch_key,stable_key)
);
DO $$
DECLARE expected_keys text[]:=ARRAY[
  'human-ai-compound-intelligence','thought-continuity',
  'owner-long-term-motivation-causal-chain','layered-self-check-architecture',
  'causal-attribution-model-diagnosis','bidirectional-causal-learning',
  'failure-intelligence','failure-boundary-map'
]; actual_keys text[];
BEGIN
  SELECT array_agg(stable_key ORDER BY stable_key) INTO actual_keys
    FROM aiceo_preclassification_memory_inbox
    WHERE seed_batch_key='g1-001-owner-high-value-themes-2026-09-17';
  IF actual_keys IS DISTINCT FROM ARRAY(SELECT unnest(expected_keys) ORDER BY 1)
    OR (SELECT count(*) FROM aiceo_preclassification_memory_inbox)<>8
  THEN RAISE EXCEPTION 'cannot seal pre-classification manifest: canonical eight-record seed is incomplete'; END IF;
END; $$;
INSERT INTO aiceo_preclassification_seed_manifest(seed_batch_key,stable_key,raw_semantics_digest)
SELECT seed_batch_key,stable_key,encode(digest(raw_semantics,'sha256'),'hex')
FROM aiceo_preclassification_memory_inbox;

CREATE OR REPLACE FUNCTION reject_aiceo_preclassification_manifest_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'pre-classification seed manifest is migration-owned and immutable'; END; $$;
CREATE TRIGGER aiceo_preclassification_manifest_immutable
BEFORE INSERT OR UPDATE OR DELETE ON aiceo_preclassification_seed_manifest
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_preclassification_manifest_mutation();

ALTER TABLE aiceo_preclassification_memory_inbox
  ADD COLUMN preserve_source_context_time_snapshot boolean NOT NULL DEFAULT true
    CHECK (preserve_source_context_time_snapshot=true),
  ADD COLUMN migration_contract_hash varchar(64);
ALTER TABLE aiceo_preclassification_memory_inbox
  DISABLE TRIGGER aiceo_preclassification_inbox_immutable;
UPDATE aiceo_preclassification_memory_inbox SET migration_contract_hash=encode(digest(
  record_hash||':'||migration_requirements::text||':'||preserve_source_context_time_snapshot::text,
  'sha256'),'hex');
ALTER TABLE aiceo_preclassification_memory_inbox
  ENABLE TRIGGER aiceo_preclassification_inbox_immutable;
ALTER TABLE aiceo_preclassification_memory_inbox
  ALTER COLUMN migration_contract_hash SET NOT NULL;

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
    NEW.record_hash||':'||NEW.migration_requirements::text||':'||
    NEW.preserve_source_context_time_snapshot::text,'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_preclassification_manifest_guard
BEFORE INSERT ON aiceo_preclassification_memory_inbox
FOR EACH ROW EXECUTE FUNCTION aiceo_preclassification_manifest_guard();

REVOKE SELECT, INSERT, UPDATE, DELETE ON aiceo_preclassification_memory_inbox FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE ON aiceo_preclassification_seed_manifest FROM PUBLIC;