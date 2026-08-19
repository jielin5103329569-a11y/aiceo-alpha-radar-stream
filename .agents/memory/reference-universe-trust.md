---
name: Reference-universe trust
description: Eligibility boundaries for Databento Security Master and EQUS.MINI instrument definitions.
---

Only a trusted security-reference source may verify that a listing is an eligible common equity. Databento EQUS.MINI instrument definitions are useful for broad symbol discovery and lifecycle changes, but their records must remain ineligible when Security Master verification is unavailable. Sector, industry-group, and industry fields are optional metadata; missing classification must be visible as degraded quality rather than inferred.

**Why:** Market-data entitlement does not imply Security Master entitlement, and definitions do not reliably provide the security type or sector hierarchy needed for candidate selection. Treating definition fields as sufficient can silently route ETFs, ADRs, preferred shares, or other non-target securities into later Alpha scans.

**How to apply:** Preserve discovered records for inspection with explicit ineligibility reasons. When the reference snapshot is stale, clear effective candidates and candidate samples immediately. Before building sector rotation or dynamic candidate routing, require a trusted classification/eligibility source and keep the fixed deep-scan lane independent.

Focused-scan routing must remain unavailable unless both trusted reference eligibility and an internally produced, fresh Databento market-leader record are present. A configured key, a reference definition, protected-pool ranking, cached data, heartbeats, or UI input never establish leader evidence.

**Why:** Advertising readiness before a genuine leader source exists invites an implementation to promote symbols from metadata or correlated protected scans, which silently defeats the independent-evidence and protected-pool isolation rules.

**How to apply:** Expose the missing prerequisite as blocked or unavailable, preserve the bounded coordinator for a future authorized leader stream, and admit only records that carry verified subscription, complete market fields, freshness, liquidity, and multiple independent evidence components.