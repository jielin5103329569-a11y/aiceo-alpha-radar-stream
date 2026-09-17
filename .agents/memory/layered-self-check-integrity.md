---
name: Layered self-check integrity
description: Durable boundaries for local, chain, and global AICEO diagnostic checks.
---

Every future critical AICEO module or node must provide a lightweight Local Self-Check over input, output, state, permission, evidence, version, freshness, and invariants. Functional chains aggregate fresh, complete local reports into a Chain Health Check that cannot report healthier than its children and must identify real child fault domains.

Global Integrity Check is summary-first. It reads fresh chain summaries, anomalies, hashes, timestamps, versions, and necessary evidence by default. Raw/deep expansion is permitted only for an unexplained chain or cross-chain conflict, with an explicit reason and trace.

Self-check reports are immutable diagnostic evidence. They cannot grant authority, modify governance, promote memory, certify closure, or count as independent validation. High-risk and critical completion still requires an independent Validator and signed Closure Integrity Audit.

**Why:** Unbounded full-system scans increase data, compute, latency, and debugging cost, while self-certification creates a false assurance loop.

**How to apply:** Start with low-cost local checks, expand only to the affected chain, and perform global deep inspection only when chain-level evidence cannot explain the fault or chains conflict. Register required chain membership through migration-owned contracts rather than caller-declared completeness.