# EVERY_TURN
As-of: 2026-09-27 17:19 PT

## DEAD ORDER
Any new Owner task that touches a repo: gate first (BOOT + INDEX + PERSIST_GATE + domain rule), then store.
Owner does not remind.

## Sequence
1. Read BOOT.md
2. Read INDEX.yaml
3. Apply DEFAULT, then named map if any
4. If the task writes or claims save: PERSIST_GATE done-test before saying saved
