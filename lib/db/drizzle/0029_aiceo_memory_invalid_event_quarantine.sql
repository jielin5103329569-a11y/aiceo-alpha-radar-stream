CREATE TABLE IF NOT EXISTS aiceo_memory_rejected_event_quarantine (
  quarantine_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  candidate_id uuid,
  promoted_memory_id uuid,
  event_type varchar(40) NOT NULL,
  actor_id varchar(180) NOT NULL,
  actor_authority varchar(24) NOT NULL,
  payload jsonb NOT NULL,
  previous_hash varchar(128),
  event_hash varchar(128) NOT NULL,
  append_sequence bigint,
  original_created_at timestamptz NOT NULL,
  quarantine_reason text NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reject_aiceo_memory_quarantine_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AICEO rejected memory event quarantine is append-only'; END; $$;
DROP TRIGGER IF EXISTS aiceo_memory_quarantine_append_only ON aiceo_memory_rejected_event_quarantine;
CREATE TRIGGER aiceo_memory_quarantine_append_only BEFORE UPDATE OR DELETE ON aiceo_memory_rejected_event_quarantine
FOR EACH ROW EXECUTE FUNCTION reject_aiceo_memory_quarantine_mutation();

INSERT INTO aiceo_memory_rejected_event_quarantine(
  original_event_id,project_id,candidate_id,promoted_memory_id,event_type,actor_id,actor_authority,
  payload,previous_hash,event_hash,append_sequence,original_created_at,quarantine_reason
)
SELECT id,project_id,candidate_id,promoted_memory_id,event_type,actor_id,actor_authority,
  payload,previous_hash,event_hash,append_sequence,created_at,
  'Pre-G1-001 hardening test residue: event is not bound to a candidate-created lifecycle action'
FROM aiceo_memory_events
WHERE event_type<>'candidate_created' OR candidate_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM aiceo_memory_candidates c
    WHERE c.id=aiceo_memory_events.candidate_id AND c.project_id=aiceo_memory_events.project_id
  )
ON CONFLICT (original_event_id) DO NOTHING;

ALTER TABLE aiceo_memory_events DISABLE TRIGGER aiceo_memory_event_append_only;
DELETE FROM aiceo_memory_events e
USING aiceo_memory_rejected_event_quarantine q
WHERE e.id=q.original_event_id;
ALTER TABLE aiceo_memory_events ENABLE TRIGGER aiceo_memory_event_append_only;