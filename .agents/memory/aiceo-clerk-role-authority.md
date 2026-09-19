---
name: AICEO Clerk role authority
description: Fail-closed role resolution when Clerk user metadata is not projected into Development session claims.
---

AICEO authorization must resolve the current authenticated Clerk user's public role on the server; do not assume Development session JWTs contain public metadata.

**Why:** Fresh authenticated sessions can identify the correct user while omitting role, roles, metadata, publicMetadata, and public_metadata claims even after the user's public metadata was updated.

**How to apply:** Treat Clerk user ID authentication and current server-side role lookup as separate checks. If role authority is unavailable, fail closed; retain exclusive operator/validator enforcement and never infer a role from email or client state.

Internal scripts and service labels cannot self-assert an exclusive Clerk role or persist themselves as an authenticated governance principal.

**Why:** A caller-supplied role literal can make recorder or migration provenance falsely appear to come from the independent Owner-side validator lane.

**How to apply:** Route governance issuance through the authenticated control-plane boundary. Offline recorders may consume validator-issued records, but must fail closed rather than minting them.

Owner governance acceptance must use one server-owned fingerprint covering the full execution envelope, not only action and resource. Bind the unique authenticated submission event, submitter, budget, timeout, retries, permissions, contract, environment, and red lines into approval evidence.

**Why:** A generic submission that copies visible task text but changes retries or budget can otherwise impersonate a fixed safety check, and mutable or fabricated provenance could defeat independent-Owner enforcement.

**How to apply:** Reject the acceptance identity on generic submission paths. Authenticate new audit events, require unique submission and approval events, and revalidate their identity, integrity, and task binding before approval and execution.

For Development-only identity acceptance, Replit-managed Clerk's `+clerk_test` email-code flow is a verified way to establish an independent test user without relying on real mail delivery.

**Why:** A real mailbox verification was blocked by delivery, while the official test identity completed verification without weakening user separation or consuming Development email quota.

**How to apply:** Reserve it for Development. The human still controls the password/session and final Owner approval; assign exactly one role only after verifying the new Clerk user is distinct from operator and validator.

Public governance HTML and Clerk's final return route may need to run before Express Clerk middleware, while every identity/data/mutation request remains behind it.

**Why:** On Replit Development domains, middleware can start a dev-browser handshake redirect loop before public HTML loads. Relative post-sign-in return targets can also fall into the wrong client router.

**How to apply:** Serve only inert HTML shells and an explicit same-origin callback before Clerk middleware. Build the callback URL from `window.location.origin`; redirect it to the governance page, whose JSON and mutation calls remain Clerk-protected.