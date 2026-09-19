---
name: Recorder finalization lifecycle
description: Rules for moving provider-free implementation recorders into independent validation.
---

Provider-free implementation recorders may enter the existing `VALIDATING` task state only through a dedicated, idempotent Control Plane transaction. The transaction must preserve an `ISSUED` execution contract and null run/provider-attempt bindings, verify the immutable canonical manifest and governance binding, and append its HMAC lifecycle audit atomically with the state change.

**Why:** The normal execution path requires a provider attempt and run, but creating either for a recorder would fabricate execution. Leaving the task queued after the recorder evidence commits separates business completion from lifecycle authority.

**How to apply:** Restrict the exception to the recorder contract operation and existing immutable bindings. Require frozen Foundation policy, governance authorization, Owner Protection, Credential Firewall, closed circuit, no production authority, and no provider execution audit. Repeated finalization must validate the existing audit and perform no write.