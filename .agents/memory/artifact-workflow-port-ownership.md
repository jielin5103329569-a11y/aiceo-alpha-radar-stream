---
name: Artifact workflow port ownership
description: Handling port conflicts for artifact-managed API and web workflows without creating competing services.
---

Artifact-managed API and web workflows must retain exclusive ownership of their configured listener ports. When a managed restart reports that a port is already in use, do not configure a replacement or run a second server beside it.

**Why:** A lingering child can keep serving an older process while the managed workflow is reported as failed. Treating that state as healthy, or adding another workflow, creates split runtime state and makes live subscriptions impossible to reason about.

**How to apply:** Identify whether the port holder is an orphaned instance of the same artifact, stop that stale instance with the user's approval, then restart the existing managed workflow and verify exactly one API listener and one web listener remain.