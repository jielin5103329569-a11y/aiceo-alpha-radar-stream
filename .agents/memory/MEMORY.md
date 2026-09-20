<!-- MEMORY_V1_HOOK -->
Default read: MEMORY_V1/BOOT.md + MEMORY_V1/INDEX.yaml + MEMORY_V1/SCHEMA.yaml + MEMORY_V1/STATE/aiceo.pointers.yaml.
Then load only INDEX/CARD refs required by this task.
Do not load all .agents/memory/*.md.
Missing ref = STOP. Persistent State wins conflicts.
<!-- /MEMORY_V1_HOOK -->

- [Databento live bridge](databento-live-bridge.md) — The official Python client begins streaming on iteration; do not call `start()` before consuming records.
- [Development schema reconciliation](development-schema-reconciliation.md) — Diff dev schema; declare dependency-bearing constraints and reject CLI error text even with exit 0.
- [Market data recovery](market-data-recovery.md) — Keep feed heartbeats separate from market-event freshness and use bounded retry backoff for provider recovery.
- [Protected scan health](protected-scan-health.md) — Scheduler activity and market-data evidence are separate; only an armed fresh verified window can reach alert handoff.
- [Signal integrity](signal-integrity.md) — Never preserve directional scores or setup labels when a live feed is interrupted, stale, or materially incomplete.
- [Pre-breakout evidence](pre-breakout-evidence.md) — Count only direct component changes as independent evidence; composite Alpha Velocity is a gate, not another vote.
- [Ranking stabilization](ranking-stabilization.md) — Confirm reorders only from eligible symbols' independent scans; reads and ineligible peers must never advance hysteresis.
- [Reference-universe trust](reference-universe-trust.md) — EQUS.MINI definitions support discovery and lifecycle only; never promote their unverified records to candidates.
- [Validation persistence isolation](validation-persistence-isolation.md) — Withhold accuracy while persistence is incomplete; never block or bias live radar to improve validation durability.
- [Catalyst opportunity integrity](catalyst-opportunity-integrity.md) — External catalyst context is fail-closed; confirmation needs fresh, independent catalyst, market, Alpha, and peer evidence.
- [Artifact workflow port ownership](artifact-workflow-port-ownership.md) — Managed API and web workflows need exclusive listener ownership; never add substitute workflows for port conflicts.
- [Failed workflow process ownership](failed-workflow-process-ownership.md) — A failed workflow can still own a live incumbent process; stopping it may terminate that process.
- [Shadow Learning isolation](shadow-learning-isolation.md) — Experimental strategy evidence is archive-backed, sidecar-only, and can never alter production radar behavior.
- [Sector-first priority](sector-first-priority.md) — Sector strength is a live-evidence multiplier and final promotion remains fail-closed across every independent input.
- [Three-stage core learning](three-stage-core-learning.md) — All future background learning must serve one of the three independent Alpha Radar stages.
- [Signal quality mechanisms](signal-quality-mechanisms.md) — Signal strength stays separate from confidence; multi-timeframe and counter-evidence constrain high-grade upgrades.
- [Post-breakout production policy](post-breakout-production-policy.md) — Keep the verified production trend, take-profit, and reversal monitor as the third-stage capability.
- [Governance read isolation](governance-read-isolation.md) — Governance reads must never advance live ranking, alert, or market state.
- [Dashboard transport recovery](dashboard-transport-recovery.md) — Render the newest verified status across SSE and REST; a broken stream must not mask poll recovery.
- [Operational audit isolation](operational-audit-isolation.md) — Incident-audit storage is best-effort; its outage must not stop supervision or affect market/Alert authority.
- [Autonomous execution durability](autonomous-execution-durability.md) — Unsettled operations remain blocked across shutdown, timeout, and restart; audit success never certifies a failed work-state write.
- [AI pool reference capacity](ai-pool-reference-capacity.md) — Reserve each targeted Reference identifier durably before provider access; partial responses remain withheld per symbol.
- [AI pool live-source isolation](ai-pool-live-source-isolation.md) — Pool enrichment consumes only independently verified focused scans; background failure can never escape into protected services.
- [Classification freshness](classification-freshness.md) — A fresh reference snapshot cannot refresh an old or timestamp-less taxonomy; classification provenance has its own gate.
- [Live network event-path integrity](live-network-event-path-integrity.md) — Only bridge-emitted heartbeat and generation-bound market events can re-establish alert readiness after a failure.
- [Radar status contract propagation](radar-status-contract-propagation.md) — Declare new status evidence in OpenAPI; REST strips undeclared fields even when SSE preserves them.
- [Shared universe cycle](shared-universe-cycle.md) — Five-name settlements and Opportunity Center share one scanId and cycle timestamp, including incomplete rows.
- [Research sidecar authority](research-sidecar-authority.md) — Alex/Moonvest and Serenity remain independent research lanes with no production decision authority.
- [AICEO external-agent authority](aiceo-external-agent-authority.md) — External agents use one durable serial control plane and never inherit Alpha Radar or production authority.
- [Database JSON parameter typing](database-json-parameter-typing.md) — Cast bound SQL parameters explicitly when they enter polymorphic PostgreSQL JSON builders.
- [AICEO Clerk role authority](aiceo-clerk-role-authority.md) — Resolve current roles server-side; Development session JWTs may omit public metadata.
- [Owner–Brain execution protocol](owner-brain-execution-protocol.md) — Future capability responses are binary: execute safely when able; otherwise say “不能” and give only the real blocker.
- [API operational script bundles](api-operational-script-bundles.md) — Bundle DB-backed TypeScript scripts as CommonJS with async main; native TS/ESM paths conflict with workspace and `pg`.
- [Closure integrity gates](closure-integrity-gates.md) — Validate every mutable surface across intermediate revisions and bind signed regression outputs to the complete closure intent.
- [Memory foundation scope](memory-foundation-scope.md) — G1-001 is candidate-only and includes Thought Continuity; promotion and retrieval/learning remain non-executable.
- [Layered self-check integrity](layered-self-check-integrity.md) — Local, chain, and global checks escalate progressively but never replace independent validation or closure.
- [Pre-classification memory inbox](preclassification-memory-inbox.md) — Preserve high-value raw ideas as sealed non-authoritative provenance roots until scientific classification is ready.
- [Context authority continuity](context-authority-continuity.md) — External ingress is candidate evidence only; verified Persistent State and Resume Node decide recovery.
- [Credential persistence boundary](credential-persistence-boundary.md) — Reject credential-bearing inputs, redact provider data, and keep an independent database guard on every AICEO table.
- [Recorder finalization lifecycle](recorder-finalization-lifecycle.md) — Provider-free recorders enter VALIDATING through a dedicated atomic path without fabricating runs or changing immutable V1 bindings.
- [Execution governance routing](execution-governance-routing.md) — Route capabilities only from durable performance evidence; EG-001 stays below the Owner Triad with zero production authority.
