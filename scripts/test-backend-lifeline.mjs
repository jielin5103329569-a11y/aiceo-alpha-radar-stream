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
  });
  assert.equal(healthy.overall.state, "healthy");
  assert.equal(healthy.recovery.phase, "running");
  assert.equal(healthy.marketEvents.freshSymbols, 5);
  assert.equal(healthy.marketEvents.missingSymbols, 0);
  assert.equal(healthy.persistenceBoundary.marketWindow, "memory_rebuilt_after_restart");
  assert.equal(healthy.persistenceBoundary.shadowLearning, "sidecar_not_on_lifeline");
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
  });
  assert.equal(recovering.overall.state, "degraded", "provider recovery and unavailable push capability must remain visible");
  assert.equal(recovering.recovery.phase, "reconnecting");
  assert.equal(recovering.marketEvents.freshSymbols, 0, "stale pre-interruption events must never be counted as fresh recovery input");
  assert.equal(recovering.scanners.inactiveSymbols, 1);
  assert.match(recovering.recovery.reason, /new verified market events/i);

  const sameHealthy = buildBackendLifelineSnapshot({
    now,
    owner: acceptedOwner.getOwner(),
    symbols: ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((ticker) => symbol({ symbol: ticker })),
    alert: alert(),
  });
  assert.equal(healthy.auditHash, sameHealthy.auditHash, "same read-only lifeline inputs require a stable audit hash");

  const indexSource = readFileSync(resolve("artifacts/api-server/src/index.ts"), "utf8");
  assert.match(indexSource, /backendLifeline\.owner\.claim\(port\)/);
  assert.match(indexSource, /EADDRINUSE/);
  assert.match(indexSource, /process\.once\("SIGTERM"/);
  assert.match(indexSource, /closeAllConnections/);
  assert.match(indexSource, /alertService\.stop\(\);\s*databentoLive\.stop\(\);\s*marketUniverse\.stop\(\)/s);
  const radarRouteSource = readFileSync(resolve("artifacts/api-server/src/routes/radar.ts"), "utf8");
  assert.doesNotMatch(radarRouteSource, /\/radar\/connect|\/radar\/disconnect/);

  console.log("Backend lifeline tests passed: ownership refusal, port-conflict supervision, separated health, fail-closed recovery, persistence boundaries, and deterministic audit.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}