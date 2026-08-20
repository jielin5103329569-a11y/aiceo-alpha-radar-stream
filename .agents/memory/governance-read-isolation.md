---
name: Governance read isolation
description: Read-only governance views must not reuse status methods that advance ranking or production state.
---

Engineering-governance reads must use dedicated, side-effect-free runtime projections. They must never call a convenience status method if that method can advance ranking hysteresis, mutate a state machine, persist an observation, emit events, or otherwise alter production behavior.

**Why:** An ostensibly read-only Dashboard poll can become a hidden source of live ranking evidence when it routes through a stateful status calculation. That makes visibility change the market system it is meant to observe.

**How to apply:** For every new diagnostic or governance endpoint, trace the whole call graph rather than trusting the HTTP verb. Add a regression that makes the potentially stateful status method fail and proves the diagnostic projection still works. Keep governance output explicit about unimplemented runtime controls instead of fabricating health or recovery state.