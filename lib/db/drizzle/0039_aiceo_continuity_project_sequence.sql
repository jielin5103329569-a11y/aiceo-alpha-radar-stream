ALTER TABLE aiceo_continuity_events ADD COLUMN append_sequence bigint;
ALTER TABLE aiceo_continuity_events DISABLE TRIGGER aiceo_continuity_events_append_only;
DO $$
BEGIN
  IF EXISTS (
    SELECT project_id FROM aiceo_continuity_events
    GROUP BY project_id HAVING count(*) FILTER (WHERE previous_hash IS NULL)<>1
  ) THEN RAISE EXCEPTION 'cannot sequence Continuity evidence: each project must have exactly one root'; END IF;
END; $$;
WITH RECURSIVE chain AS (
  SELECT id,project_id,event_hash,1::bigint sequence
  FROM aiceo_continuity_events WHERE previous_hash IS NULL
  UNION ALL
  SELECT child.id,child.project_id,child.event_hash,parent.sequence+1
  FROM aiceo_continuity_events child
  JOIN chain parent
    ON child.project_id=parent.project_id AND child.previous_hash=parent.event_hash
)
UPDATE aiceo_continuity_events e SET append_sequence=chain.sequence
FROM chain WHERE chain.id=e.id;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM aiceo_continuity_events WHERE append_sequence IS NULL)
    OR EXISTS (
      SELECT project_id,append_sequence FROM aiceo_continuity_events
      GROUP BY project_id,append_sequence HAVING count(*)<>1
    )
  THEN RAISE EXCEPTION 'cannot sequence Continuity evidence: broken, branching, or incomplete hash chain'; END IF;
END; $$;
ALTER TABLE aiceo_continuity_events ENABLE TRIGGER aiceo_continuity_events_append_only;
ALTER TABLE aiceo_continuity_events ALTER COLUMN append_sequence SET NOT NULL;
ALTER TABLE aiceo_continuity_events
  ADD CONSTRAINT aiceo_continuity_event_project_sequence_unique
  UNIQUE(project_id,append_sequence);

CREATE OR REPLACE FUNCTION aiceo_continuity_event_sequence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_sequence bigint; previous text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text||':continuity-events'));
  SELECT coalesce(max(append_sequence),0)+1 INTO next_sequence
    FROM aiceo_continuity_events WHERE project_id=NEW.project_id;
  SELECT event_hash INTO previous FROM aiceo_continuity_events
    WHERE project_id=NEW.project_id AND append_sequence=next_sequence-1;
  IF NEW.append_sequence<>next_sequence OR NEW.previous_hash IS DISTINCT FROM previous THEN
    RAISE EXCEPTION 'continuity event sequence or project-local previous hash is invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER aiceo_continuity_event_sequence_guard
BEFORE INSERT ON aiceo_continuity_events
FOR EACH ROW EXECUTE FUNCTION aiceo_continuity_event_sequence_guard();