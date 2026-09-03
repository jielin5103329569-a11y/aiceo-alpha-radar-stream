---
name: Protected scan health
description: Rules for truthful protected-symbol scheduler and market-data status.
---

Treat scan scheduling and market-data verification as independent facts. A timer can be armed, delayed, or inactive while the market-data window is fresh, stale, offline, or incomplete; neither state may stand in for the other.

Before the first verified market event arrives, report the scanner as insufficient and awaiting a live event even when the transport subscription is connected. Reserve stale for evidence that existed and then aged out.

**Why:** A scheduler callback, transport heartbeat, cached snapshot, or safety recalculation can otherwise make an unavailable feed appear recently scanned or alert-ready. This obscures outages and risks sending a production alert without current market evidence.

**How to apply:** Expose completed-scan time separately from the last verified market event, preserve `null` when no real scan has completed, invalidate old callbacks on scheduler replacement, and require both a healthy scheduler and a fresh complete verified window before any alert handoff.

Every `alertReady` projection must be the conjunction of healthy ordered event delivery and the protected scan/scoring-window gate; transport health alone is never alert readiness. Forced-offline and cached recovery projections must close both root and nested copies of that gate.

**Why:** Independent status projections can otherwise disagree, leaving a stale or incomplete snapshot with a misleading `alertReady: true` even though production handoff is blocked elsewhere.

**How to apply:** Derive alert readiness only after subscription, current-window quote/trade/volume, heartbeat, scoring eligibility, trigger evidence, and `marketDataGateReady` are known; copy the same fail-closed result into every status projection.

Scheduled scans must not be recorded while a protected bridge is connecting or merely connected without a verified market event; overdue timers are degraded immediately once their due time passes.

**Why:** Recording startup/reconnect ticks as completed scans makes scan cadence look healthy during an outage and can hide the fact that the symbol has not rebuilt a live eligible window.

**How to apply:** Guard scan execution on the streaming state, keep the completed-scan timestamp null until a live event exists, and classify any positive scheduler lateness as delayed.