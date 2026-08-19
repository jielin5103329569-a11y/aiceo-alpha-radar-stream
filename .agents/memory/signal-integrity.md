---
name: Signal integrity
description: Rules for keeping live-market activity scores honest during data interruption, staleness, and sparse inputs.
---

Live market-activity scores must become unavailable with zero confidence whenever the feed is no longer actively streaming or its market observations are stale. No neutral, directional, component, or activity score may remain current; historical values may remain only as timestamped, ineligible diagnostics. Directional labels require every decision component to be fresh and available, and a recovered feed must rebuild its valid analysis window before scoring resumes. The strongest detection states must also be removed in the same evaluation that their multi-factor confirmation is lost, even if ordinary state downgrades use a cooldown.

**Why:** A healthy service heartbeat does not prove current market information. A neutral-looking number, an old component score, one ungated parallel summary, or a cooldown-preserved strongest state can falsely imply a live signal after its required evidence has disappeared.

**How to apply:** Gate every exposed score, classification, and activity flag on event freshness—not transport health. Confirmation failure must bypass normal downgrade hysteresis for strongest states. Test stopped, stale, sparse, heartbeat-only, recovery, and post-promotion evidence-loss cases.