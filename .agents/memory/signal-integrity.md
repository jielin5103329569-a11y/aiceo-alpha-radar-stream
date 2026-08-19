---
name: Signal integrity
description: Rules for keeping live-market activity scores honest during data interruption, staleness, and sparse inputs.
---

Live market-activity scores must return to neutral with zero confidence whenever the feed is no longer actively streaming or its market observations are stale. Directional labels require all decision components to be fresh and available; incomplete inputs, including an unfinished rolling baseline, are degraded and cannot produce a setup label.

**Why:** A healthy service heartbeat does not prove current market information. Retaining an old directional score during a provider interruption or using a partial set of inputs could falsely imply a live, high-confidence signal.

**How to apply:** When changing scoring, data-quality handling, or reconnection logic, preserve the distinction between connection health and event freshness. Add regression coverage for stopped, stale, and sparse input states whenever signal eligibility changes.