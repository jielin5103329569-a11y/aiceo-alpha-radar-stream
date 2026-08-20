import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "backend-lifeline-test-"));
const outputPath = join(outputDirectory, "backendLifeline.cjs");
const now = new Date("2026-08-20T16:00:00.000Z");

function symbol(overrides = {}) {
  return {
    symbol: "NVDA",
    connectionState: "streaming",
    transportState: "streaming",
    reconnectState: "idle",
    reconnectAttempt: 0,
    heartbeatAt: new Date(now.getTime() - 1_000),
    heartbeatAgeMs: 1_000,
    heartbeatFresh: true,
    lastMarketEventAt: new Date(now.getTime() - 800),
    marketEventAgeMs: 800,
    marketEventFresh: true,
    schedulerState: "scheduled",
    recoveryPhase: "running",
    recoveryWindowState: "fresh_input",
    reason: "Fresh fixture.",
    ...overrides,
  };
}

function alert(overrides = {}) {
  return {
    running: true,
    startedAt: now,
    stoppedAt: null,
    lastHeartbeatAt: now,
    lastActivityAt: now,
    lastConsumeAt: now,
    candidatesEvaluated: 0,
    newCandidatesProduced: 0,
    dbInsertsAttempted: 0,
    dbInsertsSucceeded: 0,
    dbInsertsDuplicate: 0,
    dbInsertsFailed: 0,
    deliveriesAttempted: 3,
    deliveriesSucceeded: 2,
    deliveriesSkipped: 1,
    deliveriesFailed: 0,
    lastCandidateAt: null,
    lastDeliveryAt: null,
    lastErrorAt: null,
    lastError: null,
    vapid: { available: true, publicKey: "public", subject: "mailto:ops@example.test" },
    ...overrides,
  };
}

function marketUniverse(overrides = {}) {
  return {
    state: "healthy",
    serviceRunning: true,
    refreshState: "ready",
    refreshInFlight: false,
    bridgeRunning: false,
    startedAt: now,
    stoppedAt: null,
    lastActivityAt: now,
    lastBridgeMessageAt: now,
    lastCompletedAt: now,
    lastAttemptAt: now,
    refreshedAt: now,
    freshness: "fresh",
    dataQuality: "good",
    reason: "Reference fixture.",
    ...overrides,
  };
}

function internalTasks(overrides = {}) {
  return {
    schemaVersion: 1,
    registryState: "healthy",
    serviceRunning: true,
    processScoped: true,
    maxConcurrentSlots: 1,
    registeredCount: 0,
    plannedCount: 0,
    activeCount: 0,
    pausedCount: 0,
    blockedCount: 0,
    completedCount: 0,
    failedCount: 0,
    timedOutCount: 0,
    zombieCount: 0,
    recoveringCount: 0,
    activeLeaseCount: 0,
    expiredLeaseCount: 0,
    staleHeartbeatCount: 0,
    dependencyBrokenCount: 0,
    duplicateTaskCount: 0,
    checkpointedCount: 0,
    canStartTaskKeys: [],
    alerts: [],
    auditEventCount: 1,
    lastAuditAt: now,
    recentAudit: [],
    tasks: [],
    reason: "Internal task registry is healthy.",
    auditHash: "a".repeat(64),
    ...overrides,
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/backendLifeline.ts"), "utf8");
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const {
    BackendLifelineOwner,
    buildBackendLifelineSnapshot,
  } = createRequire(import.meta.url)(outputPath);

  const owner = new BackendLifelineOwner();
  const claim = owner.claim(8080, now);
  assert.equal(claim.accepted, true, "only the server process may claim the backend lifecycle");
  owner.markListening(now);
  const duplicate = owner.claim(8080, now);
  assert.equal(duplicate.accepted, false, "a second in-process bootstrap must be refused");
  assert.equal(owner.getOwner().duplicateStartAttempts, 1, "duplicate boot attempts must remain observable");

  const acceptedOwner = new BackendLifelineOwner();
  acceptedOwner.claim(8080, now);
  acceptedOwner.markListening(now);
  const healthy = buildBackendLifelineSnapshot({
    now,
    owner: acceptedOwner.getOwner(),
    symbols: ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((ticker) => symbol({ symbol: ticker })),
    alert: alert(),
    marketUniverse: marketUniverse(),
    internalTasks: internalTasks(),
  });
  assert.equal(healthy.overall.state, "healthy");
  assert.equal(healthy.recovery.phase, "running");
  assert.equal(healthy.marketEvents.freshSymbols, 5);
  assert.equal(healthy.marketEvents.missingSymbols, 0);
  assert.equal(healthy.persistenceBoundary.marketWindow, "memory_rebuilt_after_restart");
  assert.equal(healthy.persistenceBoundary.shadowLearning, "sidecar_not_on_lifeline");
  assert.equal(healthy.internalTasks.registryState, "healthy", "lifeline must expose the independent internal task governance projection");
  assert.equal(healthy.alertDelivery.health, "healthy", "AlertService heartbeat must be independently observable");
  assert.equal(healthy.marketUniverse.state, "healthy", "reference-universe lifeline must be independent and observable");
  assert.match(healthy.auditHash, /^[a-f0-9]{64}$/);

  const recovering = buildBackendLifelineSnapshot({
    now,
    owner: acceptedOwner.getOwner(),
    symbols: [
      symbol({
        connectionState: "error",
        transportState: "error",
        reconnectState: "scheduled",
        reconnectAttempt: 2,
        heartbeatFresh: true,
        lastMarketEventAt: new Date(now.getTime() - 30_000),
        marketEventAgeMs: 30_000,
        marketEventFresh: false,
        schedulerState: "inactive",
        recoveryPhase: "reconnecting",
        recoveryWindowState: "not_started",
        reason: "Bounded reconnect fixture.",
      }),
    ],
    alert: alert({ vapid: { available: false, reason: "VAPID is absent" } }),
    marketUniverse: marketUniverse({ state: "degraded", freshness: "stale", dataQuality: "degraded" }),
    internalTasks: internalTasks({ registryState: "blocked", timedOutCount: 1 }),
  });
  assert.equal(recovering.overall.state, "degraded", "provider recovery and unavailable push capability must remain visible");
  assert.equal(recovering.recovery.phase, "reconnecting");
  assert.equal(recovering.marketEvents.freshSymbols, 0, "stale pre-interruption events must never be counted as fresh recovery input");
  assert.equal(recovering.scanners.inactiveSymbols, 1);
  assert.match(recovering.recovery.reason, /new verified market events/i);

  const staleAlertConsumer = buildBackendLifelineSnapshot({
    now,
    owner: acceptedOwner.getOwner(),
    symbols: ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((ticker) => symbol({ symbol: ticker })),
    alert: alert({ lastConsumeAt: null, lastActivityAt: null }),
    marketUniverse: marketUniverse(),
    internalTasks: internalTasks(),
  });
  assert.equal(staleAlertConsumer.alertDelivery.health, "stale", "a self-heartbeat cannot hide a disconnected AlertService consumer");
  assert.equal(staleAlertConsumer.overall.state, "degraded", "stale alert consumption must remain fail-closed");

  const sameHealthy = buildBackendLifelineSnapshot({
    now,
    owner: acceptedOwner.getOwner(),
    symbols: ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((ticker) => symbol({ symbol: ticker })),
    alert: alert(),
    marketUniverse: marketUniverse(),
    internalTasks: internalTasks(),
  });
  assert.equal(healthy.auditHash, sameHealthy.auditHash, "same read-only lifeline inputs require a stable audit hash");

  const indexSource = readFileSync(resolve("artifacts/api-server/src/index.ts"), "utf8");
  const lifecycleSource = readFileSync(resolve("artifacts/api-server/src/lib/serverLifecycle.ts"), "utf8");
  assert.match(indexSource, /backendLifeline\.owner\.claim\(port\)/);
  assert.match(indexSource, /EADDRINUSE/);
  assert.match(indexSource, /process\.once\("SIGTERM"/);
  assert.match(indexSource, /createGracefulShutdown/);
  assert.match(indexSource, /closeEventStreams: \(reason\) => radarSseConnections\.closeAll\(reason\)/);
  assert.match(lifecycleSource, /closeAllConnections/);
  assert.match(indexSource, /alertService\.stop\(\);\s*internalTaskRegistry\.stop\(\);\s*databentoLive\.stop\(\);\s*marketUniverse\.stop\(\)/s);
  const radarRouteSource = readFileSync(resolve("artifacts/api-server/src/routes/radar.ts"), "utf8");
  assert.doesNotMatch(radarRouteSource, /\/radar\/connect|\/radar\/disconnect/);

  console.log("Backend lifeline tests passed: ownership refusal, port-conflict supervision, separated health, fail-closed recovery, persistence boundaries, and deterministic audit.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}