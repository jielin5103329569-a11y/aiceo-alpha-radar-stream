import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "autonomous-operations-test-"));
const outputPath = join(outputDirectory, "autonomousOperationsCoordinator.cjs");
const now = new Date("2026-08-20T21:00:00.000Z");

class PersistenceStub {
  work = new Map();
  audit = [];
  health = { state: "ready", lastError: null };

  async loadWork() {
    return [...this.work.values()];
  }

  async saveWork(work, { expectedRunId } = {}) {
    const existing = this.work.get(work.workId);
    if (expectedRunId && (!existing || existing.runId !== expectedRunId)) return false;
    this.work.set(work.workId, structuredClone(work));
    return true;
  }

  async claimWork({ workId, runId, now, leaseExpiresAt }) {
    const work = this.work.get(workId);
    if (
      !work
      || !["internally_accepted", "stalled"].includes(work.state)
      || (work.nextRunAt && work.nextRunAt.getTime() > now.getTime())
    ) return null;
    const claimed = {
      ...work,
      state: "running",
      attempts: work.attempts + 1,
      runId,
      leaseExpiresAt,
      lastHeartbeatAt: now,
      nextRunAt: null,
      lastError: null,
      updatedAt: now,
    };
    this.work.set(workId, structuredClone(claimed));
    return {
      attempts: claimed.attempts,
      runId,
      leaseExpiresAt,
      lastHeartbeatAt: now,
      updatedAt: now,
    };
  }

  async appendAudit(event) {
    this.audit.push(structuredClone(event));
    return true;
  }

  getHealth() {
    return this.health;
  }
}

class TerminalWriteFailurePersistence extends PersistenceStub {
  failVerifiedWrites = true;

  async saveWork(work, options) {
    if (this.failVerifiedWrites && work.state === "verified") {
      this.health = { state: "unavailable", lastError: "Simulated terminal write outage." };
      return false;
    }
    return super.saveWork(work, options);
  }
}

class DelayedRecoveryPersistence extends PersistenceStub {
  releaseLoad = null;

  async loadWork() {
    return new Promise((resolve) => {
      this.releaseLoad = () => resolve([]);
    });
  }
}

function observation() {
  return {
    process: "healthy",
    protectedFeed: "healthy",
    alertService: "healthy",
    internalLeases: "healthy",
    providerProbe: "ready",
    validationReadiness: "ready",
    reason: "Test-only diagnostic observation.",
  };
}

function definition(overrides = {}) {
  return {
    workId: "foundation",
    title: "Foundation check",
    ownerModule: "operations_test",
    implementationKey: "foundation-v1",
    handler: () => ({
      outcome: "verified",
      reason: "Static diagnostic completed.",
      evidence: { staticHandler: true },
    }),
    validate: () => true,
    ...overrides,
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/autonomousOperationsCoordinator.ts"), "utf8");
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const { AutonomousOperationsCoordinator } = createRequire(import.meta.url)(outputPath);

  const delayedRecovery = new DelayedRecoveryPersistence();
  const shutdownDuringStart = new AutonomousOperationsCoordinator(delayedRecovery);
  const pendingStart = shutdownDuringStart.start({ getObservation: observation }, now);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof delayedRecovery.releaseLoad, "function");
  await shutdownDuringStart.stop(now);
  delayedRecovery.releaseLoad();
  await pendingStart;
  assert.equal(shutdownDuringStart.getSnapshot(now).running, false, "shutdown prevents a delayed recovery from starting later");
  assert.equal((await shutdownDuringStart.register(definition({ workId: "late-start" }), now)).accepted, false);

  const persistence = new PersistenceStub();
  const coordinator = new AutonomousOperationsCoordinator(persistence);
  await coordinator.start({ getObservation: observation }, now);

  assert.equal((await coordinator.register(definition(), now)).accepted, true);
  assert.equal(
    (await coordinator.register(definition({ workId: "duplicate", implementationKey: "foundation-v1" }), now)).accepted,
    false,
    "duplicate static implementation identities are rejected",
  );
  assert.equal((await coordinator.acceptInternally("foundation", now)).accepted, true);
  await coordinator.tick(now);
  let snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "foundation").state, "verified");
  assert.equal(snapshot.observation.process, "healthy");
  assert.equal(snapshot.externalPlatform.taskBoard, "unobservable_external_boundary");
  assert.equal(snapshot.externalPlatform.affectsApplicationHealth, false);

  const sharedPersistence = new PersistenceStub();
  let concurrentHandlerCalls = 0;
  const coordinatorA = new AutonomousOperationsCoordinator(sharedPersistence);
  const coordinatorB = new AutonomousOperationsCoordinator(sharedPersistence);
  const concurrentDefinition = definition({
    workId: "atomic-claim",
    implementationKey: "atomic-claim-v1",
    handler: () => {
      concurrentHandlerCalls += 1;
      return { outcome: "verified", reason: "Atomic claim holder completed.", evidence: { calls: concurrentHandlerCalls } };
    },
  });
  await coordinatorA.register(concurrentDefinition, now);
  await coordinatorB.register(concurrentDefinition, now);
  await coordinatorA.start({ getObservation: observation }, now);
  await coordinatorB.start({ getObservation: observation }, now);
  await coordinatorA.acceptInternally("atomic-claim", now);
  await coordinatorB.acceptInternally("atomic-claim", now);
  await Promise.all([
    coordinatorA.tick(new Date(now.getTime() + 1)),
    coordinatorB.tick(new Date(now.getTime() + 1)),
  ]);
  assert.equal(concurrentHandlerCalls, 1, "a shared persistence claim permits only one coordinator process to invoke a handler");

  assert.equal((await coordinator.register(definition({
    workId: "dependent",
    implementationKey: "dependent-v1",
    dependsOn: ["foundation"],
  }), now)).accepted, true);
  assert.equal((await coordinator.acceptInternally("dependent", now)).accepted, true);
  await coordinator.tick(new Date(now.getTime() + 1));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "dependent").state, "verified");

  let retryCalls = 0;
  assert.equal((await coordinator.register(definition({
    workId: "retryable",
    implementationKey: "retryable-v1",
    retryBaseDelayMs: 1_000,
    handler: () => {
      retryCalls += 1;
      return retryCalls === 1
        ? { outcome: "retryable", reason: "Transient diagnostic interruption." }
        : { outcome: "verified", reason: "Retry recovered.", evidence: { retries: retryCalls } };
    },
  }), now)).accepted, true);
  await coordinator.acceptInternally("retryable", now);
  await coordinator.tick(new Date(now.getTime() + 2));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "retryable").state, "stalled");
  await coordinator.tick(new Date(now.getTime() + 1_100));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "retryable").state, "verified");
  assert.equal(retryCalls, 2, "retry uses bounded backoff and a new local execution");

  assert.equal((await coordinator.register(definition({
    workId: "external",
    implementationKey: "external-v1",
    handler: () => ({ outcome: "blocked_external", reason: "User authorization is required." }),
  }), now)).accepted, true);
  await coordinator.acceptInternally("external", now);
  await coordinator.tick(new Date(now.getTime() + 2_000));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "external").state, "blocked_external");
  coordinator.recordExternalUserEscalation("authorization-needed", "Only the user can authorize the external provider.", now);
  assert.equal(snapshot.externalPlatform.userEscalations.length, 0);
  assert.equal(coordinator.getSnapshot(now).externalPlatform.userEscalations.length, 1);

  let checkpointAccepted = false;
  assert.equal((await coordinator.register(definition({
    workId: "checkpointed",
    implementationKey: "checkpointed-v1",
    handler: (context) => {
      checkpointAccepted = context.checkpoint("read_only_probe", { bounded: true });
      return { outcome: "verified", reason: "Checkpointed diagnostic complete.", evidence: { checkpointAccepted } };
    },
  }), now)).accepted, true);
  await coordinator.acceptInternally("checkpointed", now);
  await coordinator.tick(new Date(now.getTime() + 3_000));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(checkpointAccepted, true);
  assert.equal(snapshot.workItems.find((work) => work.workId === "checkpointed").checkpointPhase, "read_only_probe");

  assert.equal((await coordinator.register(definition({
    workId: "throwing-handler",
    implementationKey: "throwing-handler-v1",
    maxAttempts: 1,
    handler: () => {
      throw new Error("Synchronous handler failure.");
    },
  }), now)).accepted, true);
  await coordinator.acceptInternally("throwing-handler", now);
  await coordinator.tick(new Date(now.getTime() + 3_500));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "throwing-handler").state, "failed");

  assert.equal((await coordinator.register(definition({
    workId: "throwing-validator",
    implementationKey: "throwing-validator-v1",
    maxAttempts: 1,
    handler: () => ({ outcome: "verified", reason: "Handler completed.", evidence: { handler: true } }),
    validate: () => {
      throw new Error("Synchronous validation failure.");
    },
  }), now)).accepted, true);
  await coordinator.acceptInternally("throwing-validator", now);
  await coordinator.tick(new Date(now.getTime() + 3_750));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(snapshot.workItems.find((work) => work.workId === "throwing-validator").state, "failed");

  let validatorAborted = false;
  let validationCalls = 0;
  let releaseFirstValidation;
  assert.equal((await coordinator.register(definition({
    workId: "validator-timeout",
    implementationKey: "validator-timeout-v1",
    executionTimeoutMs: 1_000,
    handler: () => ({ outcome: "verified", reason: "Handler finished before validation.", evidence: { handler: true } }),
    validate: (_result, context) => new Promise((resolve) => {
      context.signal.addEventListener("abort", () => {
        validatorAborted = true;
      }, { once: true });
      validationCalls += 1;
      if (validationCalls > 1) {
        resolve(true);
        return;
      }
      releaseFirstValidation = () => resolve(false);
    }),
  }), now)).accepted, true);
  await coordinator.acceptInternally("validator-timeout", now);
  await coordinator.tick(new Date(now.getTime() + 4_000));
  snapshot = coordinator.getSnapshot(now);
  assert.equal(validatorAborted, true, "a hung validator receives the same bounded abort signal as a handler");
  assert.equal(snapshot.workItems.find((work) => work.workId === "validator-timeout").state, "blocked");
  await coordinator.tick(new Date(now.getTime() + 5_001));
  assert.equal(validationCalls, 1, "an abort-ignoring validator is never automatically retried");
  releaseFirstValidation();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await coordinator.tick(new Date(now.getTime() + 10_000));
  assert.equal(
    validationCalls,
    1,
    `an unverified validator must remain blocked after it settles: ${JSON.stringify(coordinator.getSnapshot(now).workItems.find((work) => work.workId === "validator-timeout"))}`,
  );

  const ignoredHandlerPersistence = new PersistenceStub();
  let ignoredHandlerCalls = 0;
  let releaseIgnoredHandler;
  const ignoredHandler = new AutonomousOperationsCoordinator(ignoredHandlerPersistence);
  await ignoredHandler.start({ getObservation: observation }, now);
  await ignoredHandler.register(definition({
    workId: "abort-ignoring-handler",
    implementationKey: "abort-ignoring-handler-v1",
    executionTimeoutMs: 1_000,
    handler: (context) => new Promise((resolve) => {
      ignoredHandlerCalls += 1;
      context.signal.addEventListener("abort", () => undefined, { once: true });
      releaseIgnoredHandler = () => resolve({ outcome: "verified", reason: "Late handler completion.", evidence: { calls: ignoredHandlerCalls } });
    }),
  }), now);
  await ignoredHandler.acceptInternally("abort-ignoring-handler", now);
  await ignoredHandler.tick(new Date(now.getTime() + 4_500));
  assert.equal(
    ignoredHandler.getSnapshot(now).workItems.find((work) => work.workId === "abort-ignoring-handler").state,
    "blocked",
  );
  const ignoredHandlerRecovery = new AutonomousOperationsCoordinator(ignoredHandlerPersistence);
  await ignoredHandlerRecovery.register(definition({
    workId: "abort-ignoring-handler",
    implementationKey: "abort-ignoring-handler-v1",
    handler: () => {
      ignoredHandlerCalls += 1;
      return { outcome: "verified", reason: "Unsafe duplicate.", evidence: { calls: ignoredHandlerCalls } };
    },
  }), now);
  await ignoredHandlerRecovery.start({ getObservation: observation }, new Date(now.getTime() + 5_000));
  await ignoredHandlerRecovery.tick(new Date(now.getTime() + 5_001));
  assert.equal(ignoredHandlerCalls, 1, "an abort-ignoring handler cannot be claimed by a replacement coordinator");
  assert.equal((await ignoredHandlerRecovery.acceptInternally("abort-ignoring-handler", now)).accepted, false);
  releaseIgnoredHandler();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const fencingPersistence = new PersistenceStub();
  let releaseStaleHandler;
  const staleOwner = new AutonomousOperationsCoordinator(fencingPersistence);
  await staleOwner.start({ getObservation: observation }, now);
  await staleOwner.register(definition({
    workId: "fenced-stale-handler",
    implementationKey: "fenced-stale-handler-v1",
    handler: () => new Promise((resolve) => {
      releaseStaleHandler = () => resolve({
        outcome: "verified",
        reason: "Stale handler completed after recovery.",
        evidence: { stale: true },
      });
    }),
  }), now);
  await staleOwner.acceptInternally("fenced-stale-handler", now);
  const staleTick = staleOwner.tick(new Date(now.getTime() + 4_750));
  await new Promise((resolve) => setImmediate(resolve));
  const recoveryOwner = new AutonomousOperationsCoordinator(fencingPersistence);
  await recoveryOwner.register(definition({
    workId: "fenced-stale-handler",
    implementationKey: "fenced-stale-handler-v1",
    handler: () => ({ outcome: "verified", reason: "Replacement must not execute.", evidence: {} }),
  }), now);
  await recoveryOwner.start({ getObservation: observation }, new Date(now.getTime() + 5_000));
  assert.equal(
    recoveryOwner.getSnapshot(now).workItems.find((work) => work.workId === "fenced-stale-handler").state,
    "blocked",
  );
  releaseStaleHandler();
  await staleTick;
  const fencedPersisted = (await fencingPersistence.loadWork()).find((work) => work.workId === "fenced-stale-handler");
  assert.equal(fencedPersisted.state, "blocked", "a stale run token cannot overwrite recovery protection");
  assert.equal(fencedPersisted.verificationEvidence, null);

  const recoveredPersistence = new PersistenceStub();
  await recoveredPersistence.saveWork({
    workId: "restart-safe",
    title: "Restart-safe diagnostic",
    ownerModule: "operations_test",
    implementationKey: "restart-safe-v1",
    state: "running",
    dependsOn: [],
    resourceClaims: [],
    attempts: 1,
    maxAttempts: 3,
    retryBaseDelayMs: 1_000,
    executionTimeoutMs: 1_000,
    nextRunAt: null,
    runId: "invalid-after-restart",
    leaseExpiresAt: new Date(now.getTime() + 1_000),
    lastHeartbeatAt: now,
    checkpoint: { phase: "saved", attempt: 1, details: { safe: true } },
    verificationEvidence: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  const recovered = new AutonomousOperationsCoordinator(recoveredPersistence);
  await recovered.register(definition({
    workId: "restart-safe",
    implementationKey: "restart-safe-v1",
    handler: () => ({ outcome: "verified", reason: "Recovered from bounded checkpoint.", evidence: { resumed: true } }),
  }), now);
  await recovered.start({ getObservation: observation }, new Date(now.getTime() + 5_000));
  await recovered.tick(new Date(now.getTime() + 5_001));
  assert.equal(
    recovered.getSnapshot(now).workItems.find((work) => work.workId === "restart-safe").state,
    "blocked",
    "a process restart locks an unverified in-flight lease instead of replaying it",
  );
  assert.equal((await recovered.acceptInternally("restart-safe", now)).accepted, false);

  const terminalFailurePersistence = new TerminalWriteFailurePersistence();
  let terminalFailureHandlerCalls = 0;
  const terminalFailure = new AutonomousOperationsCoordinator(terminalFailurePersistence);
  await terminalFailure.start({ getObservation: observation }, now);
  await terminalFailure.register(definition({
    workId: "terminal-write-failure",
    implementationKey: "terminal-write-failure-v1",
    handler: () => {
      terminalFailureHandlerCalls += 1;
      return { outcome: "verified", reason: "Handler completed before terminal write outage.", evidence: { call: terminalFailureHandlerCalls } };
    },
  }), now);
  await terminalFailure.acceptInternally("terminal-write-failure", now);
  await terminalFailure.tick(new Date(now.getTime() + 12_000));
  assert.equal(
    terminalFailure.getSnapshot(now).workItems.find((work) => work.workId === "terminal-write-failure").state,
    "blocked",
    "a failed terminal write never appears as verified in memory",
  );
  assert.match(terminalFailure.getSnapshot(now).reason, /suspended/i);

  terminalFailurePersistence.health = { state: "ready", lastError: null };
  const terminalFailureRecovery = new AutonomousOperationsCoordinator(terminalFailurePersistence);
  await terminalFailureRecovery.register(definition({
    workId: "terminal-write-failure",
    implementationKey: "terminal-write-failure-v1",
    handler: () => {
      terminalFailureHandlerCalls += 1;
      return { outcome: "verified", reason: "Should not run automatically.", evidence: { call: terminalFailureHandlerCalls } };
    },
  }), now);
  await terminalFailureRecovery.start({ getObservation: observation }, new Date(now.getTime() + 13_000));
  await terminalFailureRecovery.tick(new Date(now.getTime() + 13_001));
  assert.equal(terminalFailureHandlerCalls, 1, "restart never replays a handler whose terminal state was not durably committed");
  assert.equal((await terminalFailureRecovery.acceptInternally("terminal-write-failure", now)).accepted, false);

  const routeSource = readFileSync(resolve("artifacts/api-server/src/routes/radar.ts"), "utf8");
  assert.match(routeSource, /router\.get\("\/radar\/operations-coordinator"/);
  assert.doesNotMatch(routeSource, /router\.(post|put|patch|delete)\(".*(?:operations|task|lease|reclaim|resume)/i);
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(|fetch\(|agentSessionId|buildId/);
  assert.doesNotMatch(source, /from "\.\/(?:databentoLive|alertService|alphaRadar|marketUniverse)"/);
  assert.doesNotMatch(source, /marketEventFresh|alertAuthority|signalScore/);

  coordinator.stop();
  coordinatorA.stop();
  coordinatorB.stop();
  ignoredHandler.stop();
  ignoredHandlerRecovery.stop();
  staleOwner.stop();
  recoveryOwner.stop();
  recovered.stop();
  terminalFailure.stop();
  terminalFailureRecovery.stop();
  console.log("Autonomous operations coordinator tests passed: durable recovery, static-handler admission, dependencies, one-at-a-time execution, bounded retry, validation, checkpoints, external escalation, read-only API exposure, and market/Alert isolation.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}