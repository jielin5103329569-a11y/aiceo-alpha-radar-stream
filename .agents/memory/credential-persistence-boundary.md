---
name: Credential persistence boundary
description: Durable AICEO rule for preventing credentials from crossing any persistence boundary.
---

Credential-bearing owner, agent, task, memory, retrieval, audit, continuity, execution, and validation inputs must fail closed before persistence. Provider-controlled output, error text, and metadata may be persisted only after redaction; evidence may retain classification and an irreversible digest, never the matched value.

**Why:** Application entry-point checks alone leave direct database writes and newly added persistence surfaces as bypasses, while rejecting an entire provider settlement can damage execution durability.

**How to apply:** Keep precise server-owned checks at every AICEO persistence input, retain broader Intent Gate rules separately, and maintain database insert/update guards plus automatic coverage for newly created AICEO tables.