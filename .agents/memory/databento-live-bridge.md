---
name: Databento live bridge
description: Safe integration rule for the official Python Databento Live client.
---

For the official Python Databento Live client, subscribe and then consume the
client iterator directly. Do not call `start()` before iteration.

**Why:** Calling `start()` before iterating causes the client to reject the
subsequent iterator with a “records may be missed” error.

**How to apply:** When maintaining a server-side Databento live bridge, begin
the record loop after subscriptions are registered; treat the first sanitized
record as proof that streaming has begun.