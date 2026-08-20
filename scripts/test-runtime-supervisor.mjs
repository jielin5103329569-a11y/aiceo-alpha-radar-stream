import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "runtime-supervisor-test-"));
const outputPath = join(outputDirectory, "runtimeSupervisor.cjs");
const now = new Date("2026-08-20T18:50:00.000Z");

class StoreStub {
  records = [];

  getHealth() {
    return {
      state: "ready",
      lastPersistedAt: null,
      lastErrorAt: null,
      lastError: null,
    };
  }

  async record(input) {
    this.records.push(input);
  }

  async listRecent() {
    return [];
  }

  markUnavailable(error) {
    this.lastUnavailableError = error instanceof Error ? error.message : String(error);
  }
}

class FailingStoreStub extends StoreStub {
  getHealth() {
    return {
      state: "unavailable",
      lastPersistedAt: null,
      lastErrorAt: now,
      lastError: "development persistence probe failed",
    };
  }

  async record() {
    throw new Error("development persistence probe failed");
  }
}

class DelayedStoreStub extends StoreStub {
  started = [];
  pending = [];

  record(input) {
    this.started.push(input);
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.records.push(input);
        resolve();
      });
    });
  }

  releaseNext() {
    const release = this.pending.shift();
    assert.ok(release, "a queued incident write must be ready before it can be released");
    release();
  }
}

class HangingStoreStub extends DelayedStoreStub {
  record(input) {
    this.started.push(input);
    return new Promise(() => {});
  }
}

function lifeline(overrides = {}) {
  return {
    owner: {
      listenerState: "listening",
      lastError: null,
      port: 8080,
    },
    transport: {
      state: "streaming",
      errorSymbols: 0,
      reason: "All protected bridges are streaming.",
    },
    recovery: { phase: "running" },
    alertDelivery: {
      health: "healthy",
      serviceRunning: true,
      capability: "available",
      reason: "Alert worker is consuming status.",
    },
    internalTasks: { tasks: [] },
    ...overrides,
  };
}

function staleTask(state = "zombie") {
  return {
    taskKey: "archive-validation",
    ownerModule: "audit_persistence",
    state,
    checkpointRecordedAt: now,
    lastError: "Lease heartbeat has exceeded the zombie threshold.",
  };
}

function uncheckpointedStaleTask(state = "zombie") {
  return {
    ...staleTask(state),
    checkpointRecordedAt: null,
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/runtimeSupervisor.ts"), "utf8");
  writeFileSync(
    join(outputDirectory, "runtimeIncidentStore.js"),
    `module.exports = { RuntimeIncidentStore: ${StoreStub.toString()} };`,
  );
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  writeFileSync(
    join(outputDirectory, "logger.js"),
    "module.exports = { logger: { info() {}, warn() {}, error() {} } };",
  );

  const { RuntimeSupervisor } = createRequire(import.meta.url)(outputPath);
  const store = new StoreStub();
  const supervisor = new RuntimeSupervisor(store);
  let currentLifeline = lifeline({
    internalTasks: { tasks: [staleTask()] },
  });
  let reclaims = 0;
  const inputs = {
    getLifeline: () => currentLifeline,
    getDashboardDelivery: () => ({ activeSseConnections: 2 }),
    reclaimInternalTask: (taskKey, operatorId) => {
      reclaims += 1;
      assert.equal(taskKey, "archive-validation");
      assert.equal(operatorId, "runtime-supervisor");
      return {
        accepted: true,
        task: { state: "recovering" },
        reason: "Expired local lease reclaimed for checkpoint-only recovery.",
      };
    },
  };

  supervisor.start(inputs, now);
  await new Promise((resolve) => setImmediate(resolve));
  let snapshot = supervisor.getSnapshot(now);
  assert.equal(snapshot.state, "recovering", "a zombie internal lease enters bounded recovery");
  assert.equal(snapshot.application.internalExecution, "recovering");
  assert.equal(snapshot.application.dashboardDelivery.activeSseConnections, 2);
  assert.equal(snapshot.externalPlatform.taskControlPlane, "unobservable");
  assert.equal(snapshot.externalPlatform.affectsApplicationHealth, false);
  assert.equal(reclaims, 1, "the supervisor may reclaim only the already unsafe local lease once");
  assert.equal(
    store.records.some((record) => record.event === "recovery_succeeded"),
    true,
    "lease recovery decisions must be audited independently of market data",
  );

  await supervisor.inspect(new Date(now.getTime() + 1_000));
  assert.equal(reclaims, 1, "bounded backoff prevents immediate duplicate reclaim attempts");

  currentLifeline = lifeline({
    internalTasks: { tasks: [staleTask("recovering")] },
  });
  await supervisor.inspect(new Date(now.getTime() + 2_000));
  snapshot = supervisor.getSnapshot(new Date(now.getTime() + 2_000));
  assert.equal(snapshot.state, "healthy", "supervisor recovery never needs market evidence to clear its own lease incident");
  assert.equal(snapshot.incidents.length, 0);
  assert.equal(
    store.records.some((record) => record.event === "resolved"),
    true,
    "resolved incident transitions remain append-only audit events",
  );
  assert.doesNotMatch(
    source,
    /databentoLive\.start|alertService\.start|marketEventFresh\s*=/,
    "supervisor cannot restart market/alert services or manufacture market freshness",
  );
  assert.match(source, /taskControlPlane:\s*"unobservable"/);
  assert.match(source, /RUNTIME_SUPERVISOR_MAX_RECOVERY_ATTEMPTS/);
  supervisor.stop();

  const persistenceFailureSupervisor = new RuntimeSupervisor(new FailingStoreStub());
  persistenceFailureSupervisor.start({
    getLifeline: () => lifeline({
      transport: {
        state: "interrupted",
        errorSymbols: 1,
        reason: "Feed reconnect is independently in progress.",
      },
    }),
    getDashboardDelivery: () => ({ activeSseConnections: 0 }),
    reclaimInternalTask: () => ({ accepted: false, task: null, reason: "Not used in this test." }),
  }, now);
  await new Promise((resolve) => setImmediate(resolve));
  const persistenceFailureSnapshot = persistenceFailureSupervisor.getSnapshot(now);
  assert.equal(
    persistenceFailureSnapshot.application.liveFeed,
    "recovering",
    "a persistence outage must not hide independently observed feed health",
  );
  assert.equal(
    persistenceFailureSnapshot.state,
    "degraded",
    "persistence audit failure does not turn a feed recovery observation into supervisor recovery authority",
  );
  assert.equal(
    persistenceFailureSnapshot.persistence.state,
    "unavailable",
    "persistence health is visible as operational evidence only",
  );
  assert.equal(
    Object.hasOwn(persistenceFailureSnapshot, "marketEventFresh")
      || Object.hasOwn(persistenceFailureSnapshot, "eligibility")
      || Object.hasOwn(persistenceFailureSnapshot, "alertAuthority"),
    false,
    "persistence failure cannot manufacture or revoke market/Alert authority",
  );
  persistenceFailureSupervisor.stop();

  const delayedStore = new DelayedStoreStub();
  const orderingSupervisor = new RuntimeSupervisor(delayedStore);
  orderingSupervisor.start({
    getLifeline: () => lifeline({ internalTasks: { tasks: [staleTask()] } }),
    getDashboardDelivery: () => ({ activeSseConnections: 0 }),
    reclaimInternalTask: () => ({ accepted: true, task: { state: "recovering" }, reason: "Controlled local reclaim accepted." }),
  }, now);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    delayedStore.started.map((record) => record.event),
    ["detected"],
    "the first incident upsert must settle before recovery audit writes begin",
  );
  delayedStore.releaseNext();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(delayedStore.started.map((record) => record.event), ["detected", "recovery_started"]);
  delayedStore.releaseNext();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    delayedStore.started.map((record) => record.event),
    ["detected", "recovery_started", "recovery_succeeded"],
    "the recovery outcome must follow its start audit for the same incident",
  );
  delayedStore.releaseNext();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    delayedStore.records.map((record) => record.event),
    ["detected", "recovery_started", "recovery_succeeded"],
    "delayed writes preserve append-only audit order and final deduplicated state intent",
  );
  orderingSupervisor.stop();

  const hangingStore = new HangingStoreStub();
  const boundedSupervisor = new RuntimeSupervisor(hangingStore, {
    persistenceTimeoutMs: 5,
    persistenceQueueMax: 3,
  });
  boundedSupervisor.start({
    getLifeline: () => lifeline({ internalTasks: { tasks: [staleTask()] } }),
    getDashboardDelivery: () => ({ activeSseConnections: 0 }),
    reclaimInternalTask: () => ({ accepted: true, task: { state: "recovering" }, reason: "Controlled local reclaim accepted." }),
  }, now);
  await new Promise((resolve) => setTimeout(resolve, 15));
  await boundedSupervisor.inspect(new Date(now.getTime() + 1_000));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hangingStore.started.length, 1, "a hung audit store allows at most one active write");
  assert.equal(hangingStore.lastUnavailableError.includes("timed out"), true);
  assert.equal(
    boundedSupervisor.getSnapshot(now).state,
    "recovering",
    "a hung audit store must not stop bounded local recovery supervision",
  );
  boundedSupervisor.stop();

  const blockedStore = new StoreStub();
  const blockedSupervisor = new RuntimeSupervisor(blockedStore);
  let blockedLifeline = lifeline({ internalTasks: { tasks: [uncheckpointedStaleTask()] } });
  blockedSupervisor.start({
    getLifeline: () => blockedLifeline,
    getDashboardDelivery: () => ({ activeSseConnections: 0 }),
    reclaimInternalTask: () => {
      blockedLifeline = lifeline({
        internalTasks: {
          tasks: [{
            ...uncheckpointedStaleTask("blocked"),
            lastError: "Lease reclaimed by runtime-supervisor; no checkpoint is available, so recovery is blocked.",
          }],
        },
      });
      return {
        accepted: true,
        task: { state: "blocked" },
        reason: "Lease reclaimed by runtime-supervisor; no checkpoint is available, so recovery is blocked.",
      };
    },
  }, now);
  await new Promise((resolve) => setImmediate(resolve));
  let blockedSnapshot = blockedSupervisor.getSnapshot(now);
  assert.equal(blockedSnapshot.application.internalExecution, "blocked");
  assert.equal(blockedSnapshot.state, "degraded");
  assert.equal(blockedSnapshot.incidents.length, 1);
  assert.equal(
    blockedStore.records.some((record) => record.event === "recovery_failed"),
    true,
    "a reclaimed task without a resumable checkpoint must be audited as failed recovery",
  );
  await blockedSupervisor.inspect(new Date(now.getTime() + 2_000));
  blockedSnapshot = blockedSupervisor.getSnapshot(new Date(now.getTime() + 2_000));
  assert.equal(blockedSnapshot.incidents.length, 1, "a no-checkpoint blocked task remains supervised until genuinely resolved");
  blockedSupervisor.stop();

  console.log("Runtime supervisor tests passed: bounded stale-lease recovery, blocked no-checkpoint retention, persistence failure isolation, ordered and bounded audit writes, external platform isolation, and no market-state mutation.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}