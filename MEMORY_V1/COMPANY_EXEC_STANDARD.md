# COMPANY_EXEC_STANDARD
As-of: 2026-09-27 17:45 PT
Owner ask: how to make Grok actually run company rules, not recite them.

## Do not
- Load the whole handbook every turn
- Ask Owner to teach the handbook
- Treat chat memory as the handbook
- Treat files-existing as running the company

## Do
1. New window first tools: BOOT.md + INDEX.yaml. No answer / no repo write before that.
2. Always apply task_maps.DEFAULT.
3. Add only the named map for this utterance (Eyes / LEARNING / Alpha / NEW_COMPANY / Venture).
4. Read those mapped source files only.
5. If write: domain path + push + SHA + HEAD re-read.
6. If the needed map is missing: STOP. Do not invent a path. Do not interview Owner for the handbook.

## What "understand the company" means
Not: quote every rule.
Yes: this turn used the mapped files, and the artifact is on HEAD.

## Isolation
NEW_COMPANY load only new-company BOOT/INDEX.
Venture load only venture-lab.
Alpha/Eyes load this repo maps.
Do not mix in one turn.

## Proof Owner can use
Ask: 这条用了哪个 map + SHA.
No SHA = not executed.
