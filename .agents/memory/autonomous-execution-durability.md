---
name: Autonomous execution durability
description: Rules that prevent duplicate autonomous operation execution or false durable state during failures and shutdown.
---

Autonomous work may be retried only after its previous handler and validator have definitively settled. Any timeout, stale lease, or shutdown that leaves execution unsettled must persist a recovery-unverified block and require explicit replacement rather than automatic replay.

**Why:** An abort signal is cooperative; a handler or validator can keep running after timeout or shutdown. Reclaiming its work in another process can duplicate side effects.

**How to apply:** Keep the database claim as the sole execution grant. Fence every post-claim work-state mutation with the claimed run token, so a stale process cannot overwrite a recovery block. Make each work-state persistence call return its own result, independently of append-only audit success. Preserve the unverified block during restart, and never delay bounded API listener shutdown on coordinator persistence.