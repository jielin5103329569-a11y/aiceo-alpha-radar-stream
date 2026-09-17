---
name: Closure integrity gates
description: Durable fail-closed requirements for certifying AICEO work as VERIFIED and CLOSED.
---

A closure audit must protect every authority-bearing persistent surface on every revision, not only inspect the final CLOSED request. Protected registries need code-baselined identities, historical evidence must remain append-only, lifecycle representations must agree, and arbitrary state or resume metadata must follow strict schemas.

**Why:** Final-request checks can preserve and certify a conflict that was inserted during an earlier BLOCKED or NOT_VERIFIED revision. HMAC-valid evidence proves integrity of what was signed, not that the signed content was safe.

**How to apply:** Before VERIFIED/CLOSED, run the declared regression suite, hash each actual output, sign the report with server authority, and bind it to the complete canonical closure intent and audited revision. Reject missing evidence, unknown rules or entities, authority claims, lifecycle contradictions, state drift, and any attempt to rewrite prior evidence. Persist real blockers and repeat acceptance after repair.