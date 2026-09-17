---
name: API operational script bundles
description: How to run database-backed TypeScript operational scripts against the API Server dependency graph.
---

Database-backed operational scripts that import the API Server or workspace DB should be bundled with the API Server's esbuild into CommonJS and use an explicit async `main()`.

**Why:** Node's native TypeScript loader cannot resolve the workspace's directory-style schema import, the workspace has no `tsx` runtime, and an ESM bundle fails on `pg` dynamic CommonJS requires. CommonJS cannot use top-level await.

**How to apply:** Keep the source as TypeScript, wrap awaited work in `main().catch(...)`, bundle with the API Server's esbuild using `--platform=node --format=cjs`, then execute the generated `.cjs` file.