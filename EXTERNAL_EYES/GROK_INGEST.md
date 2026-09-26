# Grok PACK ingest hot path
Locked 2026-09-25 after Owner cost complaint: second ingest re-searched the drawer.

Trigger: Owner sends 入库 / 存包 + Frozen PACK body.

Do not search. Do not list PACKS first unless stamp collision is suspected.

Fixed target:
- owner: jielin5103329569-a11y
- repo: aiceo-alpha-radar-stream
- branch: main

One commit, three new files:
1. EXTERNAL_EYES/PACKS/<YYYY-MM-DD_HHh>.md  verbatim
2. EXTERNAL_EYES/OUTCOME/<stamp>_MAPPING.md
3. EXTERNAL_EYES/OUTCOME/<stamp>_LADDER_CHECK.md

Never overwrite an old PACK.
Glance / roster_board is the existing 3H automation only.
Not buy. Not 8080. Not live-5.
