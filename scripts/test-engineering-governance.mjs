import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "engineering-governance-test-"));
const outputPath = join(outputDirectory, "engineeringGovernance.cjs");
const now = new Date("2026-08-20T15:00:00.000Z");

function task(overrides = {}) {
  return {
    key: "task-a",
    title: "Governed task",
    state: "planned",
    implementationKey: "governed-entry",
    ownerModule: "data_governance",
    dependsOn: [],
    resourceClaims: [],
    waitingSince: null,
    validationPassed: false,
    checkpointRecorded: false,
    duplicateOf: null,
    ...overrides,
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/engineeringGovernance.ts"), "utf8");
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const {
    assessInternalTaskQueue,
    buildEngineeringGovernanceSnapshot,
    evaluateChangePreflight,
  } = createRequire(import.meta.url)(outputPath);

  const readyQueue = assessInternalTaskQueue([
    task({ key: "foundation", state: "completed", validationPassed: true }),
    task({
      key: "next",
      title: "Dependent task",
      implementationKey: "dependent-entry",
      dependsOn: ["foundation"],
    }),
  ], now);
  assert.equal(readyQueue.state, "healthy");
  assert.deepEqual(readyQueue.canStartTaskKeys, ["next"], "only validated dependencies may unlock declared internal work");

  const unsafeQueue = assessInternalTaskQueue([
    task({
      key: "active-a",
      state: "active",
      implementationKey: "duplicate-entry",
      resourceClaims: ["databento-subscription-owner"],
    }),
    task({
      key: "active-b",
      title: "Conflicting task",
      state: "active",
      implementationKey: "duplicate-entry",
      resourceClaims: ["databento-subscription-owner"],
    }),
    task({
      key: "stuck",
      title: "Stuck waiting task",
      state: "waiting_for_turn",
      implementationKey: "stuck-entry",
      waitingSince: new Date(now.getTime() - 25 * 60 * 60 * 1_000),
    }),
    task({
      key: "failed",
      title: "Failed task",
      state: "failed",
      implementationKey: "failed-entry",
      checkpointRecorded: false,
    }),
  ], now);
  assert.equal(unsafeQueue.state, "blocked");
  assert.deepEqual(
    new Set(unsafeQueue.alerts.map((alert) => alert.code)),
    new Set(["active_slot_capacity", "duplicate_implementation", "resource_conflict", "waiting_for_turn_stale", "failed_without_checkpoint"]),
    "queue health must expose capacity, duplicate, conflict, waiting, and checkpoint risks instead of hiding them",
  );

  const acceptedPreflight = evaluateChangePreflight({
    title: "Read-only audit projection",
    targetModule: "data_governance",
    implementationKey: "audit-projection-v2",
    implementationRoute: "new",
    knownExistingCapability: null,
    dataSources: ["existing governed snapshot"],
    realtimeImpact: "read_only",
    backgroundBudget: { maxConcurrent: null, queueCap: null, retryCap: null },
    dependencies: [{ key: "foundation", state: "completed", validationPassed: true }],
    validationPlan: ["type_contract", "targeted_regression", "api_or_browser", "runtime_health"],
    rollbackBoundaries: ["data_governance"],
  });
  assert.equal(acceptedPreflight.admissible, true);
  assert.equal(acceptedPreflight.auditHash, evaluateChangePreflight({
    title: "Read-only audit projection",
    targetModule: "data_governance",
    implementationKey: "audit-projection-v2",
    implementationRoute: "new",
    knownExistingCapability: null,
    dataSources: ["existing governed snapshot"],
    realtimeImpact: "read_only",
    backgroundBudget: { maxConcurrent: null, queueCap: null, retryCap: null },
    dependencies: [{ key: "foundation", state: "completed", validationPassed: true }],
    validationPlan: ["type_contract", "targeted_regression", "api_or_browser", "runtime_health"],
    rollbackBoundaries: ["data_governance"],
  }).auditHash, "frozen preflight evidence must hash deterministically");
  const rejectedPreflight = evaluateChangePreflight({
    ...acceptedPreflight,
    targetModule: "background_learning",
    implementationKey: "parallel-learning",
    implementationRoute: "new",
    knownExistingCapability: "Existing Shadow Learning sidecar",
    realtimeImpact: "background",
    backgroundBudget: { maxConcurrent: null, queueCap: null, retryCap: null },
    dependencies: [{ key: "unvalidated", state: "completed", validationPassed: false }],
    validationPlan: ["type_contract"],
    rollbackBoundaries: [],
  });
  assert.equal(rejectedPreflight.admissible, false, "duplicate, unbounded, unvalidated work must fail the preflight gate");

  const snapshot = buildEngineeringGovernanceSnapshot({
    now,
    protectedScanners: [
      { symbol: "NVDA", schedulerState: "scheduled" },
      { symbol: "MU", schedulerState: "delayed" },
    ],
  });
  assert.equal(snapshot.platformBoundary.replitTaskBoardTouched, false);
  assert.equal(snapshot.platformBoundary.internalExecutionLeaseState, "deferred_to_backend_lifeline");
  assert.equal(snapshot.state, "degraded", "unconnected internal runtime registry and delayed scans remain visible");
  assert.ok(snapshot.alerts.some((alert) => alert.code === "task_registry_unavailable"));
  assert.ok(snapshot.alerts.some((alert) => alert.code === "scanner_backpressure"));
  assert.equal(snapshot.auditHash, buildEngineeringGovernanceSnapshot({
    now,
    protectedScanners: [
      { symbol: "NVDA", schedulerState: "scheduled" },
      { symbol: "MU", schedulerState: "delayed" },
    ],
  }).auditHash, "snapshot hashes must be deterministic for identical observations");

  const routeSource = readFileSync(resolve("artifacts/api-server/src/routes/radar.ts"), "utf8");
  const endpoint = routeSource.slice(
    routeSource.indexOf('router.get("/radar/engineering-governance"'),
    routeSource.indexOf('router.get("/radar/universe"'),
  );
  assert.match(endpoint, /databentoLive\.getEngineeringScannerHealth\(\)/);
  assert.doesNotMatch(
    endpoint,
    /databentoLive\.getStatus\(\)/,
    "the governance endpoint must never invoke the status path because it advances ranking hysteresis",
  );

  console.log("Engineering governance tests passed: preflight, queue dependency/capacity/conflict checks, runtime isolation, and deterministic audits.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}