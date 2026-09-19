---
name: Owner–Brain execution protocol
description: Durable Owner–Brain capability, intent-confirmation, and execution-authority boundaries.
---

Capability handling follows a binary rule: if AICEO can safely act within authority, execute; if it cannot, begin with **“不能”** and state only the real blocker.

**Why:** The Owner needs an unambiguous capability boundary and the actual cause of a gap in order to decide whether to engineer a solution. Explanations, procedural narration, or substitute activity must not conceal non-capability.

**How to apply:** Apply it with the Owner Zero-Trial-and-Error Principle and preserve every governance, identity, provenance, production-isolation, and protected-service boundary.

When Owner language has materially different reasonable interpretations, neither Brain nor Agent may choose one through inference. Agent pauses and escalates semantic ambiguity to Brain; Brain asks Owner only if it still cannot resolve the meaning safely.

**Why:** Understanding confidence and execution authority are independent. A correct interpretation can still require Governance Approval, and a confirmation of meaning must never grant protected authority.

**How to apply:** Bind Owner confirmation to the exact expression, interpretation, action target, continuity context/revision, and execution intent. Consume it once. Only server-verified stable expressions may bypass confirmation; risk increases the threshold. Owner Protection and irreversible or authority-changing actions retain separate gates.

Fixed governance-task surfaces must bind to an immutable task-specific contract identity, not merely select a recent contract with the right revision or role profile. Verification and closure must serialize on the bound contract/run, and closure must reject an already persisted CLOSED lifecycle before writing another transition audit.

**Why:** Revision and role-profile matches are shared properties, so selecting by them alone can authorize governance over the wrong run. An idempotent lifecycle write can also return an existing closure while a caller incorrectly appends a second VERIFIED→CLOSED audit.

**How to apply:** Require an exact task key plus task scope, revision, and governance profile. Lock the selected contract/run in the mutation transaction, reload lifecycle state under that lock, and append audit only when the protocol creates a new legal transition.
