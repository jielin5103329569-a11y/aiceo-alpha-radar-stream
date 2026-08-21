import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "diagnostics-center-test-"));
const outputPath = join(outputDirectory, "diagnosticsCenter.cjs");
const now = new Date("2026-08-21T18:00:00.000Z");

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
  writeFileSync(
    join(outputDirectory, "logger.js"),
    "module.exports = { logger: { info() {}, warn() {} } };",
  );
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);

  const { DiagnosticsCenter, DIAGNOSTICS_EVENT_LIMIT } = createRequire(import.meta.url)(outputPath);
  const center = new DiagnosticsCenter();

  const healthy = center.getSnapshot(inputs());
  assert.equal(healthy.overall.state, "healthy", "healthy independent observations remain healthy");
  assert.equal(healthy.overall.score, 100);
  assert.equal(healthy.knownIssues.length, 0);
  assert.equal(healthy.validations.every((check) => check.state === "passed"), true);
  assert.equal(healthy.futureEngines.selfHealing, "read_only_suggestions_only");

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

  const permissionConstrained = center.getSnapshot(inputs({
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
  assert.match(permissionReport.recommendedFix, /entitlement|subscription/i);

  const recovered = center.getSnapshot(inputs());
  assert.equal(recovered.overall.state, "healthy", "fresh recovery evidence clears the local issue projection");
  assert.equal(
    recovered.recentEvents.some((event) => event.kind === "recovery"),
    true,
    "recovery emits a bounded structured event and reruns validation",
  );
  assert.equal(recovered.recentEvents.length <= DIAGNOSTICS_EVENT_LIMIT, true);
  assert.match(recovered.persistence.reason, /never blocks Alpha Radar runtime paths/i);
  assert.doesNotMatch(
    source,
    /databentoLive|alertService\.start|marketEventFresh\s*=/,
    "the diagnostics projection cannot control market or Alert services",
  );

  console.log("Diagnostics Center tests passed: unified health, constrained attribution, recovery verification, bounded evidence, and production-path isolation.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}