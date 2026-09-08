/**
 * Regression coverage for dashboard status selection during an SSE outage.
 *
 * The hook stores only newer server-generated revisions within an epoch. A
 * REST response can safely establish a new epoch after a server restart,
 * while delayed messages from the retired epoch stay rejected. This test
 * verifies that unchanged/null market timestamps do not block those updates
 * and that the unavailable indicator requires both paths to be unavailable.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "radar-stream-recovery-test-"));

try {
  const source = readFileSync(
    resolve("artifacts/alpha-radar-stream/src/hooks/use-radar-stream.ts"),
    "utf8",
  )
    .replace(/^import .*;\n/gm, "");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(join(outputDirectory, "use-radar-stream.js"), output);

  const require = createRequire(import.meta.url);
  const {
    createRadarBrowserRecoveryProjection,
    createRadarRecoveryProjection,
    hasCoherentRadarScan,
    isBackendUnavailable,
    shouldOpenRadarSse,
    shouldMarkRadarSseConnected,
    shouldPollRestStatus,
    shouldStartRadarForegroundRecovery,
    selectLatestRadarStatus,
  } = require(join(outputDirectory, "use-radar-stream.js"));
  const olderSnapshot = {
    symbol: "NVDA",
    statusEpoch: "server-a",
    statusRevision: 42,
    lastUpdatedAt: null,
    connectionState: "streaming",
  };
  const newerSnapshot = {
    symbol: "NVDA",
    statusEpoch: "server-a",
    statusRevision: 43,
    lastUpdatedAt: null,
    connectionState: "error",
  };
  const scanId = "shared-scan-a";
  const marketWindowSettlement = {
    scanId,
    settledAt: "2026-08-21T08:00:02.000Z",
    quote: true,
    trade: true,
    volume: true,
    heartbeat: true,
    complete: true,
    missingSegments: [],
  };
  const alphaRadar = {
    score: 82,
    scoreState: "available",
    dataQuality: "good",
    changeIndicators: {
      momentumAcceleration: 4,
      volumeAcceleration: 3,
      orderFlowShift: 2,
      spreadTightening: 1,
    },
    preBreakoutWatch: true,
    preBreakout: {
      dataFresh: true,
      confirmation: {
        status: "confirmed",
        reason: "Fresh confirmed fixture.",
      },
    },
  };
  const scanHealth = {
    marketDataState: "fresh",
    marketDataGateReady: true,
    degradation: "ready",
    reason: "Fresh complete fixture.",
  };
  const network = {
    heartbeatFresh: true,
    marketEventFresh: true,
    marketEventPathHealthy: true,
    alertReady: true,
    recovery: {
      state: "running",
      windowResetRequired: false,
      reason: "Fresh complete fixture.",
    },
    reason: "Fresh complete fixture.",
  };
  const liveIngestion = {
    network,
    acceptanceState: "scoring_eligible",
    conditions: {
      quoteFresh: true,
      tradeFresh: true,
      priceFresh: true,
      volumeFresh: true,
      scoringEligible: true,
      triggerEvidenceAvailable: true,
    },
    scoringStatus: {
      scoreState: "available",
      score: 82,
      freshness: "fresh",
      dataQuality: "good",
      gateReason: "eligible",
    },
    reason: "Fresh complete fixture.",
  };
  const coherentStatus = {
    scanId,
    statusEpoch: "server-a",
    statusRevision: 44,
    marketFeedState: "streaming",
    network,
    marketWindowSettlement,
    alphaRadar,
    scanHealth,
    liveIngestion,
    symbolRadars: ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((symbol) => ({
      scanId,
      symbol,
      marketFeedState: "streaming",
      network,
      marketWindowSettlement,
      alphaRadar,
      scanHealth,
      liveIngestion,
    })),
    opportunityCenter: {
      scanId,
      opportunities: ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((symbol) => ({
        scanId,
        symbol,
        triggerAt: marketWindowSettlement.settledAt,
        freshness: "fresh",
        direction: "upside",
        alphaVelocity30s: 5,
        acceleration: 3,
        state: "CONFIRMED",
        marketState: "fresh",
        alertReady: true,
        alertReadyReason: "Fresh confirmed fixture.",
        missingConfirmationItems: [],
      })),
      reason: "Fresh fixture.",
    },
  };

  assert.equal(hasCoherentRadarScan(coherentStatus), true);
  const recoveryProjection = createRadarRecoveryProjection(coherentStatus);
  assert.equal(recoveryProjection.marketFeedState, "stale");
  assert.equal(recoveryProjection.scanHealth.marketDataGateReady, false);
  assert.equal(recoveryProjection.marketWindowSettlement.complete, false);
  assert.equal(recoveryProjection.alphaRadar.score, null);
  assert.equal(recoveryProjection.alphaRadar.changeIndicators.volumeAcceleration, null);
  assert.equal(recoveryProjection.network.alertReady, false);
  assert.equal(recoveryProjection.liveIngestion.network.alertReady, false);
  assert.ok(
    recoveryProjection.symbolRadars.every(
      (symbol) =>
        symbol.marketFeedState === "stale"
        && symbol.scanHealth.marketDataGateReady === false
        && symbol.marketWindowSettlement.complete === false,
    ),
    "cached recovery must render one coherent stale/gated state across all five symbols",
  );
  assert.equal(
    recoveryProjection.opportunityCenter.opportunities[0].alertReady,
    false,
    "cached recovery must gate opportunity alerts until REST confirms the active epoch",
  );
  const mixedFeedStatus = structuredClone(coherentStatus);
  mixedFeedStatus.symbolRadars[0].marketFeedState = "offline";
  assert.equal(
    hasCoherentRadarScan(mixedFeedStatus),
    false,
    "a STREAMING/OFFLINE mixed snapshot must be rejected before presentation",
  );
  const mixedScanStatus = structuredClone(coherentStatus);
  mixedScanStatus.symbolRadars[0].scanId = "other-scan";
  assert.equal(
    hasCoherentRadarScan(mixedScanStatus),
    false,
    "a mixed scanId snapshot must be rejected before presentation",
  );
  const mixedCycleStatus = structuredClone(coherentStatus);
  mixedCycleStatus.symbolRadars[0].marketWindowSettlement.settledAt = "2026-08-21T08:00:03.000Z";
  assert.equal(
    hasCoherentRadarScan(mixedCycleStatus),
    false,
    "a mixed cycle timestamp must be rejected before presentation",
  );
  const mixedOpportunityCycleStatus = structuredClone(coherentStatus);
  mixedOpportunityCycleStatus.opportunityCenter.opportunities[0].triggerAt =
    "2026-08-21T08:00:03.000Z";
  assert.equal(
    hasCoherentRadarScan(mixedOpportunityCycleStatus),
    false,
    "an opportunity from another cycle must be rejected before presentation",
  );
  assert.equal(shouldOpenRadarSse(true, null), false);
  assert.equal(shouldOpenRadarSse(true, "server-a"), false);
  assert.equal(
    shouldOpenRadarSse(false, "server-a"),
    true,
    "SSE may open only after REST establishes the active server epoch",
  );
  assert.equal(
    shouldMarkRadarSseConnected(1, "server-a"),
    true,
    "an open EventSource on a REST-confirmed epoch must clear browser recovery immediately",
  );
  assert.equal(
    shouldMarkRadarSseConnected(0, "server-a"),
    false,
    "an EventSource that is not open must not clear browser recovery",
  );
  assert.equal(
    shouldMarkRadarSseConnected(1, null),
    false,
    "an open EventSource without a REST-confirmed epoch must remain fail-closed",
  );
  assert.equal(
    shouldStartRadarForegroundRecovery(10_000, 11_500, false),
    false,
    "focus and pageshow signals from one app return must not restart recovery",
  );
  assert.equal(
    shouldStartRadarForegroundRecovery(10_000, 13_000, false),
    true,
    "a later foreground return may start a new recovery attempt",
  );
  assert.equal(
    shouldStartRadarForegroundRecovery(0, 10_000, true),
    false,
    "an in-flight foreground REST confirmation must not be duplicated",
  );

  let selection = selectLatestRadarStatus(null, olderSnapshot, "sse", new Set());
  selection = selectLatestRadarStatus(selection.status, newerSnapshot, "rest", selection.retiredEpochs);
  assert.equal(
    selection.status,
    newerSnapshot,
    "a newer REST recovery snapshot must replace an older SSE snapshot even without a market event",
  );

  selection = selectLatestRadarStatus(null, newerSnapshot, "sse", new Set());
  selection = selectLatestRadarStatus(selection.status, olderSnapshot, "rest", selection.retiredEpochs);
  assert.equal(
    selection.status,
    newerSnapshot,
    "a delayed REST response must not replace a newer SSE connection/error snapshot",
  );

  selection = selectLatestRadarStatus(null, newerSnapshot, "sse", new Set());
  selection = selectLatestRadarStatus(selection.status, {
    symbol: "NVDA",
    statusEpoch: "server-a",
    statusRevision: 43,
    lastUpdatedAt: "2026-08-21T08:00:02.000Z",
    changedByDelayedDuplicate: true,
  }, "sse", selection.retiredEpochs);
  assert.equal(
    selection.status,
    newerSnapshot,
    "equal revision duplicates must preserve the first verified snapshot",
  );
  selection = selectLatestRadarStatus(
    selection.status,
    { symbol: "NVDA", statusEpoch: "server-b", statusRevision: 1, lastUpdatedAt: null, connectionState: "connected" },
    "rest",
    selection.retiredEpochs,
  );
  assert.equal(
    selection.status?.statusEpoch,
    "server-b",
    "a current REST response from a restarted server must replace a higher old-epoch revision",
  );
  selection = selectLatestRadarStatus(selection.status, newerSnapshot, "sse", selection.retiredEpochs);
  assert.equal(
    selection.status?.statusEpoch,
    "server-b",
    "a delayed old-epoch SSE response must not replace recovered REST state",
  );
  let needsRestEpochConfirmation = true;
  assert.equal(
    shouldPollRestStatus("connected", needsRestEpochConfirmation),
    true,
    "an SSE reconnect must keep REST polling until the new server epoch is confirmed",
  );
  const rejectedNewEpochSse = selectLatestRadarStatus(
    newerSnapshot,
    { symbol: "NVDA", statusEpoch: "server-b", statusRevision: 1, lastUpdatedAt: null, connectionState: "connected" },
    "sse",
    new Set(),
  );
  assert.equal(
    rejectedNewEpochSse.status,
    newerSnapshot,
    "a new-epoch SSE event must not switch epochs before REST confirmation",
  );
  const restRecoveredEpoch = selectLatestRadarStatus(
    rejectedNewEpochSse.status,
    { symbol: "NVDA", statusEpoch: "server-b", statusRevision: 1, lastUpdatedAt: null, connectionState: "connected" },
    "rest",
    rejectedNewEpochSse.retiredEpochs,
  );
  assert.equal(
    restRecoveredEpoch.status?.statusEpoch,
    "server-b",
    "REST polling after the SSE reconnect must adopt the restarted server epoch",
  );
  needsRestEpochConfirmation = false;
  assert.equal(
    shouldPollRestStatus("connected", needsRestEpochConfirmation),
    false,
    "REST polling may stop only after the current epoch is confirmed",
  );
  assert.equal(
    selectLatestRadarStatus(newerSnapshot, { symbol: "NVDA", lastUpdatedAt: "invalid" }, "sse", new Set()).status,
    newerSnapshot,
    "an invalid revision must not replace a verified snapshot",
  );
  assert.equal(
    isBackendUnavailable(true, "reconnecting", false),
    false,
    "a reconnecting browser link must not imply backend failure before REST fails",
  );
  assert.equal(
    isBackendUnavailable(true, "reconnecting", true),
    true,
    "the unavailable banner requires an explicit REST failure while SSE is unavailable",
  );
  const browserRecoveryProjection = createRadarBrowserRecoveryProjection(coherentStatus);
  assert.equal(
    browserRecoveryProjection.marketFeedState,
    "streaming",
    "browser-link recovery must not rewrite server-verified market transport as stale or offline",
  );
  assert.deepEqual(
    browserRecoveryProjection.marketWindowSettlement,
    coherentStatus.marketWindowSettlement,
    "browser-link recovery must preserve the last server-verified market evidence window",
  );
  assert.equal(
    browserRecoveryProjection.opportunityCenter.opportunities.every(
      (opportunity) => opportunity.alertReady === false,
    ),
    true,
    "browser-link recovery must keep every opportunity fail-closed",
  );
  assert.equal(
    browserRecoveryProjection.symbolRadars.every(
      (symbol) => symbol.scanId === coherentStatus.scanId,
    ),
    true,
    "browser-link recovery must preserve the atomic Universe identity",
  );

  console.log("Radar stream recovery tests passed: monotonic cross-transport status selection and dual-path availability.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}