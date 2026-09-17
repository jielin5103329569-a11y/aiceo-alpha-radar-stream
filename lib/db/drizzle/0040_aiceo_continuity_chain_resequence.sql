ALTER TABLE aiceo_continuity_events DISABLE TRIGGER aiceo_continuity_events_append_only;
ALTER TABLE aiceo_continuity_events DISABLE TRIGGER aiceo_continuity_event_sequence_guard;
UPDATE aiceo_continuity_events SET append_sequence=-append_sequence;
DO $$
BEGIN
  IF EXISTS (
    SELECT project_id FROM aiceo_continuity_events
    GROUP BY project_id HAVING count(*) FILTER (WHERE previous_hash IS NULL)<>1
  ) THEN RAISE EXCEPTION 'cannot resequence Continuity evidence: each project must have exactly one root'; END IF;
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
  IF EXISTS (SELECT 1 FROM aiceo_continuity_events WHERE append_sequence<1)
    OR EXISTS (
      SELECT project_id,append_sequence FROM aiceo_continuity_events
      GROUP BY project_id,append_sequence HAVING count(*)<>1
    )
    OR EXISTS (
      SELECT 1 FROM aiceo_continuity_events child
      LEFT JOIN aiceo_continuity_events parent
        ON parent.project_id=child.project_id
        AND parent.append_sequence=child.append_sequence-1
      WHERE child.append_sequence>1 AND child.previous_hash IS DISTINCT FROM parent.event_hash
    )
  THEN RAISE EXCEPTION 'cannot resequence Continuity evidence: broken, branching, incomplete, or non-contiguous hash chain'; END IF;
END; $$;
ALTER TABLE aiceo_continuity_events ENABLE TRIGGER aiceo_continuity_event_sequence_guard;
ALTER TABLE aiceo_continuity_events ENABLE TRIGGER aiceo_continuity_events_append_only;