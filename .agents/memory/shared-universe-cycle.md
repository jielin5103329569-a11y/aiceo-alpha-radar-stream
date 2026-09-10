---
name: Shared universe cycle
description: Invariants for one atomic five-symbol scan across status, opportunities, and dashboard cards.
---

Treat each protected five-name scan as one atomic universe cycle with one UUID and one settlement timestamp. Every symbol settlement and Opportunity Center row belongs to that exact cycle; an incomplete symbol remains attached to it rather than receiving a later private scan.

**Why:** Per-symbol trigger times can stagger by seconds and make one status snapshot look like several independent scans, even when all rows share a scan ID. Null or later trigger times on incomplete rows also obscure which market window was actually evaluated.

**How to apply:** Use the universe settlement timestamp as the opportunity cycle/trigger timestamp. Render every card's identity from the root snapshot metadata, reject payloads whose symbol/opportunity UUID or timestamp differs, and derive the header feed state from the same five-symbol snapshot. Keep per-symbol completeness independent without loosening fail-closed alert gates.

Opportunity market-window freshness comes from the same-cycle quote/trade/volume/heartbeat settlement, not from Alpha direction, score readiness, or sector classification. `missingSegments: []` and `insufficient market window` are mutually exclusive; Alpha and sector deficiencies remain separate confirmation gates.

Single-symbol market events must coalesce into the already-scheduled Universe snapshot rather than minting new identities. Every accepted event must also keep that shared scheduler armed, so live flow repairs a missing cycle timer instead of leaving settled cards frozen. An urgent transport failure may publish fail-closed state immediately, but it retains the current UUID and cycle timestamp; only the next scheduled Universe settlement advances both.

During a downward dashboard review, bind the Opportunity Center and Universe cards to one immutable accepted snapshot. Queue newer non-actionable snapshots and replace the whole group at the top. A foreground/SSE recovery also bypasses this hold for one bounded five-second window so a complete reminted cycle cannot remain hidden; actionable state always bypasses it.