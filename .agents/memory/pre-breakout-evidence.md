---
name: Pre-breakout evidence
description: Rules for explainable Pre-Breakout Detection evidence and state transitions.
---

Only direct, independently observed component changes — momentum, volume intensity, order flow, and spread — may count toward the Pre-Breakout evidence threshold. Alpha Velocity is a composite score derivative, so it must be a necessary gate and displayed rationale, never an extra independent vote.

**Why:** Counting both Alpha Velocity and its source components double-counts the same market movement, allowing a state upgrade from too little independent confirmation.

**How to apply:** Keep state promotions gated by positive Alpha Velocity plus the required number of direct component signals. Maintain the boundary test that two direct signals plus positive derived Velocity cannot reach Pre-Breakout or Confirmed.