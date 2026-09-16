---
name: AICEO Clerk role authority
description: Fail-closed role resolution when Clerk user metadata is not projected into Development session claims.
---

AICEO authorization must resolve the current authenticated Clerk user's public role on the server; do not assume Development session JWTs contain public metadata.

**Why:** Fresh authenticated sessions can identify the correct user while omitting role, roles, metadata, publicMetadata, and public_metadata claims even after the user's public metadata was updated.

**How to apply:** Treat Clerk user ID authentication and current server-side role lookup as separate checks. If role authority is unavailable, fail closed; retain exclusive operator/validator enforcement and never infer a role from email or client state.