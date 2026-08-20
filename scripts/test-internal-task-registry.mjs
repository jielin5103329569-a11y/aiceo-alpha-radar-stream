import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "internal-task-registry-test-"));
const outputPath = join(outputDirectory, "internalTaskRegistry.cjs");
const now = new Date("2026-08-20T18:00:00.000Z");

function definition(overrides = {}) {
  return {
    taskKey: "governance-audit",
    title: "Governance audit",
    implementationKey: "governance-audit-v1",
    ownerModule: "audit_persistence",
    ttlMs: 100,
    zombieAfterMs: 25,
    ...overrides,
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/internalTaskRegistry.ts"), "utf8");
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const { InternalTaskRegistry } = createRequire(import.meta.url)(outputPath);

  const registry = new InternalTaskRegistry();
  registry.start(now);
  const registered = registry.register(definition(), now);
  assert.equal(registered.accepted, true);
  const claim = registry.claim("governance-audit", "worker-a", now);
  assert.equal(claim.accepted, true, "a registered internal task can receive one scoped lease");
  assert.ok(claim.lease?.leaseId);

  const heartbeat = registry.heartbeat(
    "governance-audit",
    claim.lease.leaseId,
    "worker-a",
    new Date(now.getTime() + 20),
  );
  assert.equal(heartbeat.accepted, true, "an owner heartbeat extends only its own active lease");
  assert.ok(heartbeat.lease.expiresAt.getTime() > now.getTime() + 100);

  const checkpoint = registry.recordCheckpoint(
    "governance-audit",
    claim.lease.leaseId,
    "worker-a",
    { idempotencyKey: "checkpoint-1", version: 1, phase: "read_only_audit", payload: { cursor: 12 } },
    new Date(now.getTime() + 30),
  );
  assert.equal(checkpoint.accepted, true);
  assert.equal(checkpoint.checkpoint.freshMarketEvidenceAllowed, false, "an internal checkpoint can never assert market freshness");
  const repeatedCheckpoint = registry.recordCheckpoint(
    "governance-audit",
    claim.lease.leaseId,
    "worker-a",
    { idempotencyKey: "checkpoint-1", version: 99, phase: "ignored", payload: { cursor: 999 } },
    new Date(now.getTime() + 35),
  );
  assert.equal(repeatedCheckpoint.accepted, true);
  assert.equal(repeatedCheckpoint.idempotent, true, "the same checkpoint key returns the existing record without advancing state");
  assert.equal(repeatedCheckpoint.checkpoint.version, 1);

  registry.inspect(new Date(now.getTime() + 121));
  let snapshot = registry.getSnapshot(new Date(now.getTime() + 121));
  assert.equal(snapshot.timedOutCount, 1, "TTL expiry is observable and cannot be silently retained as active");
  assert.equal(
    registry.complete("governance-audit", claim.lease.leaseId, "worker-a", true, new Date(now.getTime() + 122)),
    false,
    "an expired owner cannot complete work before controlled reclaim",
  );
  assert.equal(
    registry.heartbeat("governance-audit", claim.lease.leaseId, "worker-a", new Date(now.getTime() + 122)).accepted,
    false,
    "an expired owner cannot revive a timed-out lease",
  );
  const reclaimed = registry.reclaim("governance-audit", "governance-reclaimer", new Date(now.getTime() + 123));
  assert.equal(reclaimed.accepted, true);
  assert.equal(reclaimed.task.state, "recovering", "a timed-out task only becomes recoverable after controlled reclaim");
  const resumed = registry.resume("governance-audit", "worker-b", new Date(now.getTime() + 124));
  assert.equal(resumed.accepted, true);
  assert.notEqual(resumed.lease.leaseId, claim.lease.leaseId, "resume always acquires a new lease");
  assert.deepEqual(resumed.resumeCheckpoint.payload, { cursor: 12 }, "resume receives the exact immutable checkpoint state, not a synthetic fresh market state");
  assert.equal(resumed.resumeCheckpoint.metadata.version, 1);
  assert.equal(registry.complete("governance-audit", resumed.lease.leaseId, "worker-b", true, new Date(now.getTime() + 130)), true);

  const zombieRegistry = new InternalTaskRegistry();
  zombieRegistry.start(now);
  zombieRegistry.register(definition({ taskKey: "zombie-check", implementationKey: "zombie-check-v1", ttlMs: 100, zombieAfterMs: 10 }), now);
  const zombieClaim = zombieRegistry.claim("zombie-check", "worker-z", now);
  zombieRegistry.recordCheckpoint(
    "zombie-check",
    zombieClaim.lease.leaseId,
    "worker-z",
    { idempotencyKey: "zombie-checkpoint", version: 1, phase: "audit", payload: { safe: true } },
    new Date(now.getTime() + 1),
  );
  zombieRegistry.inspect(new Date(now.getTime() + 11));
  snapshot = zombieRegistry.getSnapshot(new Date(now.getTime() + 11));
  assert.equal(snapshot.zombieCount, 1, "missed heartbeat is independently detected as a zombie before lease TTL expiry");
  assert.ok(snapshot.alerts.some((alert) => alert.code === "task_zombie_detected"));
  assert.equal(
    zombieRegistry.recordCheckpoint(
      "zombie-check",
      zombieClaim.lease.leaseId,
      "worker-z",
      { idempotencyKey: "late-zombie-checkpoint", version: 2, phase: "late", payload: { mustNot: "persist" } },
      new Date(now.getTime() + 12),
    ).accepted,
    false,
    "a zombie owner cannot checkpoint after missing the heartbeat threshold",
  );
  assert.equal(zombieRegistry.reclaim("zombie-check", "governance-reclaimer", new Date(now.getTime() + 12)).accepted, true);
  assert.equal(zombieRegistry.resume("zombie-check", "worker-new", new Date(now.getTime() + 13)).accepted, true, "zombie recovery requires reclaim and then a new owner");

  const dependencyRegistry = new InternalTaskRegistry();
  dependencyRegistry.start(now);
  dependencyRegistry.register(definition({ taskKey: "dependent", implementationKey: "dependent-v1", dependsOn: ["missing-foundation"] }), now);
  assert.equal(dependencyRegistry.claim("dependent", "worker-d", now).accepted, false, "missing dependency blocks admission fail-closed");
  assert.equal(dependencyRegistry.getSnapshot(now).dependencyBrokenCount, 1);

  const duplicateRegistry = new InternalTaskRegistry();
  duplicateRegistry.start(now);
  duplicateRegistry.register(definition({ taskKey: "identity-a", implementationKey: "identity-v1" }), now);
  assert.equal(duplicateRegistry.register(definition({ taskKey: "identity-a", implementationKey: "different-v1" }), now).accepted, false, "duplicate task identity is rejected");
  assert.equal(duplicateRegistry.register(definition({ taskKey: "identity-b", implementationKey: "identity-v1" }), now).accepted, false, "duplicate implementation is blocked");
  assert.equal(duplicateRegistry.getSnapshot(now).duplicateTaskCount, 1);
  assert.equal(
    duplicateRegistry.register(definition({ taskKey: "invalid-timing", implementationKey: "invalid-timing-v1", ttlMs: 0, zombieAfterMs: 0 }), now).accepted,
    false,
    "invalid lease timing is rejected before a task identity can be admitted",
  );

  const lifecycleRegistry = new InternalTaskRegistry();
  lifecycleRegistry.start(now);
  lifecycleRegistry.register(definition({ taskKey: "restart-safe", implementationKey: "restart-safe-v1" }), now);
  const lifecycleLease = lifecycleRegistry.claim("restart-safe", "worker-before-restart", now);
  lifecycleRegistry.recordCheckpoint(
    "restart-safe",
    lifecycleLease.lease.leaseId,
    "worker-before-restart",
    { idempotencyKey: "restart-checkpoint", version: 1, phase: "safe-stop", payload: { cursor: 1 } },
    new Date(now.getTime() + 1),
  );
  lifecycleRegistry.stop(new Date(now.getTime() + 2));
  lifecycleRegistry.start(new Date(now.getTime() + 3));
  assert.equal(
    lifecycleRegistry.heartbeat("restart-safe", lifecycleLease.lease.leaseId, "worker-before-restart", new Date(now.getTime() + 4)).accepted,
    false,
    "an owner lease from before registry stop cannot heartbeat after restart",
  );
  assert.equal(
    lifecycleRegistry.recordCheckpoint(
      "restart-safe",
      lifecycleLease.lease.leaseId,
      "worker-before-restart",
      { idempotencyKey: "must-not-write-after-restart", version: 2, phase: "unsafe", payload: {} },
      new Date(now.getTime() + 4),
    ).accepted,
    false,
    "an owner lease from before registry stop cannot checkpoint after restart",
  );
  assert.equal(
    lifecycleRegistry.complete("restart-safe", lifecycleLease.lease.leaseId, "worker-before-restart", true, new Date(now.getTime() + 4)),
    false,
    "an owner lease from before registry stop cannot complete after restart",
  );
  assert.equal(lifecycleRegistry.getSnapshot(new Date(now.getTime() + 4)).timedOutCount, 1);

  const routeSource = readFileSync(resolve("artifacts/api-server/src/routes/radar.ts"), "utf8");
  assert.match(routeSource, /internalTaskRegistry\.getSnapshot\(\)/, "only a read-only task projection is exposed through existing GET endpoints");
  assert.doesNotMatch(routeSource, /router\.(post|put|patch|delete)\(".*(?:task|lease|reclaim|resume)/i, "browser routes must not control internal task execution");
  assert.doesNotMatch(source, /from "\.\/(?:databentoLive|alertService|marketUniverse)"/, "registry implementation must remain isolated from production real-time services");

  registry.stop();
  zombieRegistry.stop();
  dependencyRegistry.stop();
  duplicateRegistry.stop();
  lifecycleRegistry.stop();
  console.log("Internal task registry tests passed: identity, lease heartbeat, TTL timeout, zombie reclaim, idempotent checkpoint resume, dependencies, duplicates, read-only projection, and production isolation.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}