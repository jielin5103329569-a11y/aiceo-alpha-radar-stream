---
name: Reference-universe trust
description: Eligibility boundaries for Databento Security Master and EQUS.MINI instrument definitions.
---

Only a trusted security-reference source may verify that a listing is an eligible common equity. Databento EQUS.MINI instrument definitions are useful for broad symbol discovery and lifecycle changes, but their records must remain ineligible when Security Master verification is unavailable. Sector, industry-group, and industry fields are optional metadata; missing classification must be visible as degraded quality rather than inferred.

**Why:** Market-data entitlement does not imply Security Master entitlement, and definitions do not reliably provide the security type or sector hierarchy needed for candidate selection. Treating definition fields as sufficient can silently route ETFs, ADRs, preferred shares, or other non-target securities into later Alpha scans.

**How to apply:** Preserve discovered records for inspection with explicit ineligibility reasons. When the reference snapshot is stale, clear effective candidates and candidate samples immediately. Before building sector rotation or dynamic candidate routing, require a trusted classification/eligibility source and keep the fixed deep-scan lane independent.