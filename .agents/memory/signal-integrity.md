---
name: Signal integrity
description: Rules for keeping live-market activity scores honest during data interruption, staleness, and sparse inputs.
---

Live market-activity scores must become unavailable with zero confidence whenever the feed is no longer actively streaming or its market observations are stale. No neutral, directional, component, or activity score may remain current; historical values may remain only as timestamped, ineligible diagnostics. Directional labels require every decision component to be fresh and available, and a recovered feed must rebuild its valid analysis window before scoring resumes.

**Why:** A healthy service heartbeat does not prove current market information. A neutral-looking number, an old component score, or one ungated parallel summary can still falsely imply a live signal during a provider interruption.

**How to apply:** Gate every exposed score, classification, and activity flag on event freshness—not transport health. Test all parallel summaries for stopped, stale, sparse, heartbeat-only, and stale-to-fresh recovery states.