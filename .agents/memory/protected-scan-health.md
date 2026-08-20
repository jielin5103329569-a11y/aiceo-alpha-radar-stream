---
name: Protected scan health
description: Rules for truthful protected-symbol scheduler and market-data status.
---

Treat scan scheduling and market-data verification as independent facts. A timer can be armed, delayed, or inactive while the market-data window is fresh, stale, offline, or incomplete; neither state may stand in for the other.

**Why:** A scheduler callback, transport heartbeat, cached snapshot, or safety recalculation can otherwise make an unavailable feed appear recently scanned or alert-ready. This obscures outages and risks sending a production alert without current market evidence.

**How to apply:** Expose completed-scan time separately from the last verified market event, preserve `null` when no real scan has completed, invalidate old callbacks on scheduler replacement, and require both a healthy scheduler and a fresh complete verified window before any alert handoff.