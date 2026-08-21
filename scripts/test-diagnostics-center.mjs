import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "diagnostics-center-test-"));
const outputPath = join(outputDirectory, "diagnosticsCenter.cjs");
const now = new Date("2026-08-21T18:00:00.000Z");

class DiagnosticStoreStub {
  records = [];
  restored = { incidents: [], events: [] };
  health = { state: "ready", lastPersistedAt: null, lastErrorAt: null, lastError: null };
  shouldThrowOnRestore = false;

  getHealth() {
    return this.health;
  }

  async recordDiagnostic(input) {
    this.records.push(structuredClone(input));
    this.health = { state: "ready", lastPersistedAt: input.occurredAt, lastErrorAt: null, lastError: null };
  }

  async listRecentDiagnostics() {
    if (this.shouldThrowOnRestore) throw new Error("development persistence probe unavailable");
    return structuredClone(this.restored);
  }
}

function lifeline(overrides = {}) {
  return {
    owner: { listenerState: "listening", lastError: null, port: 8080, duplicateStartAttempts: 0 },
    overall: { state: "healthy", reason: "All lifeline observations are current." },
    transport: { configuredSymbols: 5, state: "streaming", errorSymbols: 0, reason: "Protected bridges are streaming." },
    marketEvents: { freshSymbols: 5, staleSymbols: 0, missingSymbols: 0, reason: "Verified market events are fresh." },
    alertDelivery: {
      serviceRunning: true,
      health: "healthy",
      capability: "available",
      deliveriesFailed: 0,
      reason: "Alert delivery is independently healthy.",
    },
    marketUniverse: {
      state: "healthy",
      freshness: "fresh",
      dataQuality: "good",
      serviceRunning: true,
      reason: "Authorized reference data is fresh.",
    },
    internalTasks: {
      registryState: "healthy",
      lastAuditAt: now,
      timedOutCount: 0,
      zombieCount: 0,
      blockedCount: 0,
      reason: "Internal task registry is healthy.",
    },
    ...overrides,
  };
}

function inputs(lifelineOverrides = {}, supervisorOverrides = {}, governanceOverrides = {}) {
  return {
    now,
    lifeline: lifeline(lifelineOverrides),
    supervisor: {
      state: "healthy",
      lastInspectionAt: now,
      reason: "Supervisor is healthy.",
      incidents: [],
      recovery: { activeAttempts: 0 },
      persistence: { state: "ready" },
      application: { dashboardDelivery: { activeSseConnections: 1 } },
      ...supervisorOverrides,
    },
    engineeringGovernance: {
      state: "healthy",
      healthScore: 100,
      alerts: [],
      recommendations: [],
      ...governanceOverrides,
    },
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/diagnosticsCenter.ts"), "utf8");
  writeFileSync(join(outputDirectory, "logger.js"), "module.exports = { logger: { info() {}, warn() {} } };");
  writeFileSync(
    join(outputDirectory, "runtimeIncidentStore.js"),
    "module.exports = { runtimeIncidentStore: { getHealth() { return { state: 'ready', lastPersistedAt: null, lastErrorAt: null, lastError: null }; }, async recordDiagnostic() {}, async listRecentDiagnostics() { return { incidents: [], events: [] }; } } };",
  );
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);

  const { DiagnosticsCenter, DIAGNOSTICS_EVENT_LIMIT } = createRequire(import.meta.url)(outputPath);
  const store = new DiagnosticStoreStub();
  const center = new DiagnosticsCenter(store);

  const healthy = center.getSnapshot(inputs());
  assert.equal(healthy.overall.state, "healthy", "healthy independent observations remain healthy");
  assert.equal(healthy.overall.score, 100);
  assert.equal(healthy.knownIssues.length, 0);
  assert.equal(healthy.persistence.state, "restoring", "unrestored state does not claim persisted evidence is live");

  const configurationBlocked = center.getSnapshot(inputs({
    transport: { configuredSymbols: 0, state: "not_configured", errorSymbols: 0, reason: "No protected provider is configured." },
  }));
  const configurationReport = configurationBlocked.knownIssues.find((report) => report.moduleId === "provider_configuration");
  assert.ok(configurationReport, "missing provider configuration is reportable");
  assert.equal(configurationReport.category, "configuration");
  assert.equal(configurationReport.disposition, "configuration");
  assert.equal(configurationReport.priority, "P0");
  assert.equal(configurationReport.rootCause, null, "configuration is not asserted to be a code defect");
  assert.equal(configurationReport.verification.state, "failed", "configuration remediation receives a recheck");
  assert.equal(configurationReport.origin, "live");
  center.getSnapshot(inputs({
    transport: { configuredSymbols: 0, state: "not_configured", errorSymbols: 0, reason: "Protected provider configuration remains absent after a safe recheck." },
  }));
  await center.stop();
  assert.equal(store.records.length, 2, "detected and materially changed observations are durably queued before planned shutdown");
  assert.equal(store.records[0].payload.report.moduleId, "provider_configuration");
  assert.equal(store.records[0].payload.event.kind, "detected");
  assert.equal(store.records[1].payload.event.kind, "observed");

  const restartStore = new DiagnosticStoreStub();
  restartStore.restored = {
    incidents: [{ diagnosticPayload: store.records[0].payload }],
    events: [{ diagnosticPayload: store.records[0].payload }],
  };
  const afterRestart = new DiagnosticsCenter(restartStore);
  await afterRestart.restore();
  const restored = afterRestart.getSnapshot(inputs());
  assert.equal(restored.overall.state, "healthy", "restored history cannot change current live health");
  assert.equal(restored.persistence.state, "ready");
  assert.equal(restored.persistence.restoredReports.length, 1, "most recent diagnostic report restores after a simulated restart");
  assert.equal(restored.persistence.restoredReports[0].origin, "restored");
  assert.equal(restored.persistence.restoredEvents[0].origin, "restored");
  assert.equal(restored.knownIssues.length, 0, "historical active reports are not reactivated without current evidence");

  const corruptedStore = new DiagnosticStoreStub();
  const nestedFactsPayload = structuredClone(store.records[0].payload);
  nestedFactsPayload.report.evidence[0].facts = { nested: { unsupported: true } };
  corruptedStore.restored = {
    incidents: [
      { diagnosticPayload: { schemaVersion: 1, report: { moduleId: "partial" } } },
      { diagnosticPayload: nestedFactsPayload },
    ],
    events: [],
  };
  const corrupted = new DiagnosticsCenter(corruptedStore);
  await corrupted.restore();
  const corruptedSnapshot = corrupted.getSnapshot(inputs());
  assert.equal(corruptedSnapshot.persistence.state, "corrupted", "partial or nested-facts payloads are rejected instead of becoming diagnostic facts");
  assert.equal(corruptedSnapshot.overall.state, "healthy", "corrupt history never changes live Alpha Radar diagnostics");

  const emptyStore = new DiagnosticStoreStub();
  const empty = new DiagnosticsCenter(emptyStore);
  await empty.restore();
  assert.equal(empty.getSnapshot(inputs()).persistence.state, "empty", "an empty store safely reports no historical evidence");

  const unavailableStore = new DiagnosticStoreStub();
  unavailableStore.shouldThrowOnRestore = true;
  const unavailable = new DiagnosticsCenter(unavailableStore);
  await unavailable.restore();
  const unavailableSnapshot = unavailable.getSnapshot(inputs());
  assert.equal(unavailableSnapshot.persistence.state, "unavailable");
  assert.equal(unavailableSnapshot.overall.state, "healthy", "persistence outage cannot influence live health or fail-closed market rules");

  const permissionStore = new DiagnosticStoreStub();
  const permissionCenter = new DiagnosticsCenter(permissionStore);
  const permissionConstrained = permissionCenter.getSnapshot(inputs({
    alertDelivery: {
      serviceRunning: true,
      health: "degraded",
      capability: "unavailable",
      deliveriesFailed: 0,
      reason: "Web Push capability is not provisioned.",
    },
  }));
  const permissionReport = permissionConstrained.knownIssues.find((report) => report.moduleId === "alert_delivery");
  assert.ok(permissionReport, "missing alert capability is visible");
  assert.equal(permissionReport.category, "permission_subscription");
  assert.equal(permissionReport.disposition, "permission_subscription");
  assert.equal(permissionReport.rootCause, null, "external capability remains an evidence constraint, not a code root cause");
  assert.equal(permissionReport.verification.state, "waiting");
  await permissionCenter.stop();

  assert.doesNotMatch(
    source,
    /databentoLive|alertService\.start|marketEventFresh\s*=/,
    "the diagnostics projection cannot control market or Alert services",
  );
  assert.match(source, /listRecentDiagnostics/);
  assert.match(source, /restore\(\)/);
  assert.equal(store.records.length <= DIAGNOSTICS_EVENT_LIMIT, true);

  console.log("Diagnostics Center tests passed: durable write, planned-restart restore, restored/live isolation, corrupt and unavailable persistence handling, empty recovery, and production-path isolation.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}