---
name: Database JSON parameter typing
description: A PostgreSQL parameter-inference constraint for atomic JSON audit writes through the database callback.
---

Cast bound parameters explicitly before passing them to polymorphic functions such as `jsonb_build_object`.

**Why:** Parameterized atomic writes can fail with “could not determine data type of parameter” even when the same placeholder is used elsewhere in the statement, because PostgreSQL cannot always infer types through polymorphic JSON arguments.

**How to apply:** Use concrete casts such as `::text` and `::int` at each polymorphic JSON call site while retaining parameter binding; do not replace binding with string interpolation.