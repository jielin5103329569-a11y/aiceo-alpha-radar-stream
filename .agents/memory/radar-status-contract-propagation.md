---
name: Radar status contract propagation
description: Why new Alpha Radar status evidence must be propagated through the public OpenAPI contract.
---

Any new evidence added to the internal Radar status must also be declared in the OpenAPI schemas for every nested public shape that exposes it, followed by the normal code-generation step.

**Why:** The REST status route parses its result through generated Zod objects, which silently strip undeclared properties; the SSE path serializes the raw object and can therefore appear correct while REST remains incomplete.

**How to apply:** After adding status metadata, verify both SSE and the parsed REST response, including nested symbol and opportunity-center records, rather than relying only on internal service tests.