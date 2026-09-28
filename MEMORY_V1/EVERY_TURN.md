# EVERY_TURN
As-of: 2026-09-27 17:11 PT
Owner question: how to force the gate on every new task without Owner reminding.

## Force (operational)
On every new Owner message, before answering or writing:
1. Read MEMORY_V1/BOOT.md
2. Read MEMORY_V1/INDEX.yaml
3. Apply task_maps.DEFAULT always
4. If the utterance matches a named map, load that map too
5. First line of the reply must include a GATE stamp:
   GATE=BOOT+INDEX+<map ids>
No stamp = this turn is void. Owner may ignore it. Do not ask Owner to remind.

## What this cannot do
There is no hypervisor that stops the model before token 1.
The enforceable contract is: unstamped work does not count; persist still requires HEAD SHA.

## Owner does not say
过门 / 先读BOOT / 扫底层
Those are worker steps.
