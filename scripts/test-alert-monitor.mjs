/**
 * Unit tests for the alert monitor library (Task #18).
 *
 * Runs in-process via TypeScript transpile — no database or live data needed.
 * Usage: node scripts/test-alert-monitor.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "alert-monitor-test-"));

function transpile(sourcePath, outputName) {
  const source = readFileSync(resolve(sourcePath), "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: false,
    },
  }).outputText;
  writeFileSync(join(outputDirectory, outputName), output);
}

try {
  transpile("artifacts/api-server/src/lib/alertMonitor.ts", "alertMonitor.js");
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  const require = createRequire(import.meta.url);
  const {
    AlertMonitor,
    createSymbolState,
    deriveEventKey,
    classifySeverity,
    classifyTriggerReason,
    evaluateAlertGates,
    observeRadarStatus,
  } = require(join(outputDirectory, "alertMonitor.js"));

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a fully-passing RadarSymbolStatus fixture.
   * Now includes `streams` as required by the fail-closed gate.
   */
  function buildPassingSnapshot({
    symbol = "NVDA",
    detectionState = "confirmed",
    confirmationStatus = "confirmed",
    score = 82,
    marketFeedState = "streaming",
    connectionState = "streaming",
    scoreState = "available",
    dataQuality = "good",
    dataFresh = true,
    velocityGateSatisfied = true,
    subscriptionVerified = true,
    realMarketEventReceived = true,
    enteredScoringWindow = true,
    scoringEligible = true,
    triggerEvidenceAvailable = true,
    eventTriggered = true,
    transitionAt = new Date(Date.now() - 5_000),
    postState = "unavailable",
    postActive = false,
    postDataFresh = false,
    postTransitionAt = null,
    latestPrice = 134.56,
    streams = [
      { schema: "mbp-1", state: "receiving", eventCount: 100, lastEventAt: new Date() },
      { schema: "ohlcv-1s", state: "receiving", eventCount: 80, lastEventAt: new Date() },
    ],
  } = {}) {
    return {
      symbol,
      connectionState,
      marketFeedState,
      lastUpdatedAt: new Date(),
      // streams is now a first-class field on RadarSymbolStatus (fail-closed gate)
      streams,
      scanHealth: {
        schedulerState: "scheduled",
        scanMode: "opening",
        scanIntervalMs: 1_000,
        lastScanAt: new Date(),
        lastScanAgeMs: 0,
        nextScanAt: new Date(Date.now() + 1_000),
        scanLagMs: 0,
        lastMarketEventAt: new Date(),
        lastMarketEventAgeMs: 0,
        marketDataState: "fresh",
        marketDataGateReady: true,
        degradation: "ready",
        reason: "Deterministic verified scan-health fixture.",
      },
      network: {
        transportState: "streaming",
        heartbeatAt: new Date(),
        heartbeatAgeMs: 0,
        heartbeatFresh: true,
        marketEventAt: new Date(),
        marketEventAgeMs: 0,
        marketEventFresh: true,
        lastTransportLatencyMs: 20,
        lastProcessingLatencyMs: 5,
        lastEndToEndLatencyMs: 25,
        jitterMs: 2,
        latencyState: "healthy",
        latencyReason: "Deterministic healthy network fixture.",
        queue: {
          depth: 0,
          highWatermark: 3,
          capacity: 256,
          state: "normal",
          enqueued: 100,
          processed: 100,
          rejected: 0,
        },
        integrity: {
          state: "healthy",
          duplicateEvents: 0,
          outOfOrderEvents: 0,
          malformedEvents: 0,
          lastEventKey: "fixture-event",
          reason: "Ordered event fixture.",
        },
        recovery: {
          generation: 1,
          state: "running",
          windowResetRequired: false,
          lastResetAt: new Date(Date.now() - 60_000),
          recoveredAt: new Date(),
          reason: "Fixture recovery complete.",
        },
        marketEventPathHealthy: true,
        alertReady: true,
        reason: "Deterministic healthy network fixture.",
      },
      alphaRadar: {
        score,
        scoreState,
        dataQuality,
        status: "Breakout Setup",
        confidence: 100,
        generatedAt: new Date(),
        warnings: [],
        diagnostics: {
          fresh_quotes: 5,
          fresh_trades: 5,
          fresh_prices: 5,
          fresh_volume: 5,
          valid_window_age: 120_000,
          scoring_gate_reason: "ready",
        },
        scan: {
          lastScannedAt: new Date(),
          scanIntervalMs: 1_000,
          scanMode: "opening",
          triggerReason: "rapid_midpoint_change",
          eventTriggered,
        },
        alphaVelocity: { delta30s: 8, delta60s: 12, rate30s: 8, rate60s: 6 },
        changeIndicators: {
          momentumAcceleration: 10,
          volumeAcceleration: 9,
          orderFlowShift: 7,
          spreadTightening: 5,
        },
        preBreakoutWatch: true,
        preBreakout: {
          state: detectionState,
          latentScore: detectionState === "latent" ? 100 : null,
          breakoutCriticalScore: detectionState === "breakout_critical" ? 80 : null,
          evidenceCount: 4,
          velocityGateSatisfied,
          reasons: ["Strong momentum", "Volume surge"],
          deteriorationReasons: [],
          transitionEvidenceCount: 4,
          transitionReasons: ["Multi-factor convergence"],
          lastTransitionAt: transitionAt,
          lastEvaluatedAt: new Date(),
          dataFresh,
          cooldownRemainingMs: null,
          confirmation: {
            status: confirmationStatus,
            evidence: [],
            satisfiedEvidence: ["Fresh price momentum", "Volume acceleration", "Alpha Velocity", "Score strength"],
            missingEvidence: [],
            persistenceScans: 4,
            requiredPersistenceScans: 3,
            evaluatedAt: new Date(),
            reason: "All required evidence satisfied across multiple scans.",
          },
        },
        postBreakout: {
          state: postState,
          active: postActive,
          dataFresh: postDataFresh,
          breakoutPrice: postActive ? 132 : null,
          highSinceBreakout: postActive ? 135 : null,
          drawdownFromHighPercent: postActive ? -1.2 : null,
          latestPrice,
          activeBuyPressure: postActive ? -22 : null,
          l1BidPressure: postActive ? -30 : null,
          volumeAcceleration: postActive ? -12 : null,
          tradeRateChange: postActive ? -0.4 : null,
          supportReasons: [],
          deteriorationReasons: postActive ? ["Live flow weakens", "Price lost the confirmed breakout level"] : [],
          consecutiveWeakScans: postActive ? 2 : 0,
          consecutiveReversalScans: postState === "trend_reversal_confirmed" ? 2 : 0,
          lastTransitionAt: postTransitionAt,
          lastEvaluatedAt: new Date(),
          reason: postActive ? "Post-breakout structure weakened." : "Not active.",
        },
        momentum: {
          value: 0.12,
          unit: "%",
          score: 82,
          observedAt: new Date(),
          freshnessMs: 2_000,
          freshness: "fresh",
          available: true,
          scoreEligible: true,
          referenceValue: 0,
          referenceLabel: null,
          source: "live",
        },
        spread: {
          value: 0.01,
          unit: "bps",
          score: 78,
          observedAt: new Date(),
          freshnessMs: 2_000,
          freshness: "fresh",
          available: true,
          scoreEligible: true,
          referenceValue: null,
          referenceLabel: null,
          source: "live",
        },
        volumeIntensity: {
          value: 2.5,
          unit: "x",
          score: 85,
          observedAt: new Date(),
          freshnessMs: 2_000,
          freshness: "fresh",
          available: true,
          scoreEligible: true,
          referenceValue: null,
          referenceLabel: null,
          source: "live",
        },
        orderFlowPressure: {
          value: 0.6,
          unit: "ratio",
          score: 75,
          observedAt: new Date(),
          freshnessMs: 2_000,
          freshness: "fresh",
          available: true,
          scoreEligible: true,
          referenceValue: null,
          referenceLabel: null,
          source: "live",
        },
        unusualActivity: {
          value: 1,
          unit: "",
          score: 90,
          observedAt: new Date(),
          freshnessMs: 2_000,
          freshness: "fresh",
          available: true,
          scoreEligible: true,
          detected: true,
          referenceValue: null,
          referenceLabel: null,
          source: "live",
        },
      },
      signalHistory: [],
      market: {
        latestPrice,
        bidPrice: 134.55,
        askPrice: 134.57,
        bidSize: 200,
        askSize: 100,
        lastTradeSize: 150,
        sessionVolume: 5_000_000,
        lastTradeAt: new Date(),
      },
      liveIngestion: {
        subscription: {
          dataset: "EQUS.MINI",
          symbol,
          symbolType: "raw_symbol",
          schemas: ["mbp-1", "ohlcv-1s"],
          acceptedRecordTypes: ["mbp", "ohlcv"],
        },
        marketSession: {
          timezone: "America/New_York",
          phase: "regular",
          filterApplied: false,
          detail: "Regular session",
        },
        recentMarketEvents: [],
        verifiedMarketEventCount: 10,
        currentWindowMarketEventCount: 10,
        lastMarketEventAt: new Date(),
        lastMarketEventReceivedAt: new Date(),
        lastMarketEventAgeMs: 500,
        windowStartedAt: new Date(Date.now() - 60_000),
        lastWindowEntryAt: new Date(Date.now() - 500),
        freshnessCounters: { quotes: 8, trades: 5, prices: 8, volume: 5 },
        enteredScoringWindow: true,
        acceptanceState: "scoring_eligible",
        conditions: {
          subscriptionVerified,
          realMarketEventReceived,
          enteredScoringWindow,
          quoteFresh: true,
          tradeFresh: true,
          priceFresh: true,
          volumeFresh: true,
          scoringEligible,
          triggerEvidenceAvailable,
        },
        triggerEvidence: {
          eventTriggered,
          triggerReason: "rapid_midpoint_change",
          scanAt: new Date(),
          sourceEventAt: new Date(),
          sourceEventType: "trade",
          sourceReceiveAt: new Date(),
          evidenceCount: 4,
          satisfiedEvidence: ["Fresh price momentum"],
          missingEvidence: [],
        },
        scoringStatus: {
          scoreState: "available",
          status: "Breakout Setup",
          score,
          freshness: "fresh",
          dataQuality: "good",
          gateReason: "ready",
        },
        reason: "Scoring eligible.",
      },
      error: null,
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Pure helpers
  // ---------------------------------------------------------------------------

  const passingSnapshot = buildPassingSnapshot();

  const postExitTransitionAt = new Date(Date.now() - 2_000);
  const takeProfitSnapshot = buildPassingSnapshot({
    detectionState: "watch",
    confirmationStatus: "rejected",
    velocityGateSatisfied: false,
    postState: "take_profit_watch",
    postActive: true,
    postDataFresh: true,
    postTransitionAt: postExitTransitionAt,
  });
  const takeProfitResult = evaluateAlertGates(takeProfitSnapshot);
  assert.equal(takeProfitResult.ok, true, "an already-proven fresh breakout must be able to alert when current exit evidence weakens");
  if (takeProfitResult.ok) {
    assert.equal(takeProfitResult.candidate.triggerReason, "take_profit_watch");
    assert.match(takeProfitResult.candidate.eventKey, /post_breakout:take_profit_watch$/);
  }
  const reversalSnapshot = buildPassingSnapshot({
    detectionState: "watch",
    confirmationStatus: "rejected",
    velocityGateSatisfied: false,
    postState: "trend_reversal_confirmed",
    postActive: true,
    postDataFresh: true,
    postTransitionAt: new Date(Date.now() - 1_000),
  });
  const reversalResult = evaluateAlertGates(reversalSnapshot);
  assert.equal(reversalResult.ok, true, "confirmed reversal must use its own post-breakout transition gate");
  if (reversalResult.ok) {
    assert.equal(reversalResult.candidate.triggerReason, "trend_reversal_confirmed");
    assert.match(reversalResult.candidate.eventKey, /post_breakout:trend_reversal_confirmed$/);
  }
  const staleExitSnapshot = buildPassingSnapshot({
    detectionState: "watch",
    confirmationStatus: "rejected",
    velocityGateSatisfied: false,
    postState: "take_profit_watch",
    postActive: true,
    postDataFresh: false,
    postTransitionAt: postExitTransitionAt,
    dataFresh: false,
  });
  const staleExitResult = evaluateAlertGates(staleExitSnapshot);
  assert.equal(staleExitResult.ok, false, "stale post-breakout observations must remain alert-gated");

  const eventKey = deriveEventKey("NVDA", passingSnapshot);
  assert.ok(eventKey.startsWith("alert:NVDA:"), "event key must include symbol");
  assert.ok(eventKey.includes("confirmed"), "event key must include detection state");
  assert.ok(eventKey.includes("confirmed"), "event key must include confirmation status");
  assert.ok(
    eventKey.includes(passingSnapshot.alphaRadar.preBreakout.lastTransitionAt.toISOString()),
    "event key must include the actual transition timestamp",
  );

  // Different state → different key
  const differentStateSnapshot = buildPassingSnapshot({ detectionState: "latent", confirmationStatus: "pending" });
  const differentKey = deriveEventKey("NVDA", differentStateSnapshot);
  assert.notEqual(eventKey, differentKey, "different detection state must produce a different event key");

  assert.equal(classifySeverity("confirmed", "confirmed"), "critical", "confirmed/confirmed must be critical");
  assert.equal(classifySeverity("breakout_critical", "pending"), "alert", "breakout-critical must be alert");
  assert.equal(classifySeverity("latent", "pending"), "watch", "latent must be watch");
  assert.equal(classifySeverity("watch", "rejected"), "info", "watch must be info");

  assert.equal(classifyTriggerReason("confirmed", "confirmed"), "breakout_confirmed");
  assert.equal(classifyTriggerReason("breakout_critical", "pending"), "breakout_critical");
  assert.equal(classifyTriggerReason("latent", "pending"), "latent_candidate");
  assert.equal(classifyTriggerReason("watch", "rejected"), "watch_state_elevated");

  // ---------------------------------------------------------------------------
  // 2. evaluateAlertGates — passing case
  // ---------------------------------------------------------------------------

  const passingResult = evaluateAlertGates(passingSnapshot);
  assert.equal(passingResult.ok, true, "all gates passing must return ok=true");
  assert.ok(passingResult.candidate, "passing evaluation must return a candidate");
  assert.equal(passingResult.candidate.symbol, "NVDA", "candidate must carry the correct symbol");
  assert.equal(typeof passingResult.candidate.alphaScore, "number", "candidate must carry the alpha score");
  assert.equal(passingResult.candidate.severity, "critical", "confirmed state must map to critical severity");
  assert.ok(Object.isFrozen(passingResult.candidate), "candidate must be frozen (immutable)");
  assert.ok(Object.isFrozen(passingResult.candidate.gateSnapshot), "gate snapshot must be frozen");

  const latentResult = evaluateAlertGates(buildPassingSnapshot({
    detectionState: "latent",
    confirmationStatus: "rejected",
  }));
  assert.equal(
    latentResult.ok,
    true,
    "a fully gated latent setup with an observed latent score may alert before final confirmation",
  );
  assert.equal(latentResult.candidate?.triggerReason, "latent_candidate");
  const weakLatentSnapshot = buildPassingSnapshot({ detectionState: "latent", confirmationStatus: "rejected" });
  weakLatentSnapshot.alphaRadar.preBreakout.latentScore = 60;
  const weakLatentResult = evaluateAlertGates(weakLatentSnapshot);
  assert.equal(weakLatentResult.ok, false, "a latent stage without an adequate observed score must remain blocked");
  assert.equal(weakLatentResult.failedGate, "noRankingVeto");
  assert.ok(Object.isFrozen(passingResult.candidate.satisfiedEvidence), "satisfied evidence array must be frozen");

  // All gates must be true in snapshot
  const gateSnap = passingResult.candidate.gateSnapshot;
  for (const [key, value] of Object.entries(gateSnap)) {
    assert.equal(value, true, `gate ${key} must be true when all conditions are met`);
  }

  // A scheduled scan must never turn an already-valid state into a new alert.
  const scheduledResult = evaluateAlertGates(buildPassingSnapshot({ eventTriggered: false }));
  assert.equal(scheduledResult.ok, false, "scheduled/non-event scan must be blocked");

  const degradedScanHealth = buildPassingSnapshot();
  degradedScanHealth.scanHealth = {
    ...degradedScanHealth.scanHealth,
    schedulerState: "delayed",
    marketDataState: "stale",
    marketDataGateReady: false,
    degradation: "stale_market_data",
    reason: "Deterministic stale protected scanner.",
  };
  const degradedScanHealthResult = evaluateAlertGates(degradedScanHealth);
  assert.equal(
    degradedScanHealthResult.ok,
    false,
    "a stale or delayed protected scanner must fail closed before alert creation",
  );
  assert.equal(
    degradedScanHealthResult.failedGate,
    "scanHealthMarketDataReady",
    "scan-health rejection must be auditable as its own gate",
  );
  assert.equal(scheduledResult.failedGate, "eventTriggeredScan", "event-triggered scan gate must explain the block");

  const backpressuredNetwork = buildPassingSnapshot();
  backpressuredNetwork.network = {
    ...backpressuredNetwork.network,
    alertReady: false,
    marketEventPathHealthy: false,
    queue: {
      ...backpressuredNetwork.network.queue,
      depth: 256,
      state: "blocked",
      rejected: 1,
    },
    integrity: {
      ...backpressuredNetwork.network.integrity,
      state: "blocked",
      reason: "Bounded queue overflow fixture.",
    },
    reason: "Bounded queue overflow fixture.",
  };
  const backpressuredNetworkResult = evaluateAlertGates(backpressuredNetwork);
  assert.equal(backpressuredNetworkResult.ok, false, "a backpressured or integrity-unknown network path must fail closed");
  assert.equal(
    backpressuredNetworkResult.failedGate,
    "networkAlertReady",
    "network readiness must be an auditable independent alert gate",
  );

  // Score movement within the same transition is not a new candidate.
  const fixedTransitionAt = new Date("2026-08-20T12:00:00.000Z");
  const sameTransitionA = buildPassingSnapshot({ score: 72, transitionAt: fixedTransitionAt });
  const sameTransitionB = buildPassingSnapshot({ score: 91, transitionAt: fixedTransitionAt });
  assert.equal(
    deriveEventKey("NVDA", sameTransitionA),
    deriveEventKey("NVDA", sameTransitionB),
    "score movement within one transition must keep one immutable event identity",
  );
  const laterTransition = buildPassingSnapshot({
    score: 72,
    transitionAt: new Date("2026-08-20T12:01:00.000Z"),
  });
  assert.notEqual(
    deriveEventKey("NVDA", sameTransitionA),
    deriveEventKey("NVDA", laterTransition),
    "a later genuine recurrence must have a new transition identity",
  );

  // ---------------------------------------------------------------------------
  // 3. Stream gate — FAIL-CLOSED: must block when streams absent or not receiving
  // ---------------------------------------------------------------------------

  // 3a: missing streams array (null) → must block
  const noStreamsResult = evaluateAlertGates(buildPassingSnapshot({ streams: null }));
  assert.equal(noStreamsResult.ok, false, "null streams must block (fail-closed)");
  assert.equal(noStreamsResult.failedGate, "bothStreamsReceiving", "null streams must fail bothStreamsReceiving gate");

  // 3b: empty streams array → must block
  const emptyStreamsResult = evaluateAlertGates(buildPassingSnapshot({ streams: [] }));
  assert.equal(emptyStreamsResult.ok, false, "empty streams must block (fail-closed)");
  assert.equal(emptyStreamsResult.failedGate, "bothStreamsReceiving", "empty streams must fail bothStreamsReceiving gate");

  // 3c: only one stream → must block
  const oneStreamResult = evaluateAlertGates(buildPassingSnapshot({
    streams: [{ schema: "mbp-1", state: "receiving", eventCount: 5, lastEventAt: new Date() }],
  }));
  assert.equal(oneStreamResult.ok, false, "single stream must block (fail-closed — need both)");
  assert.equal(oneStreamResult.failedGate, "bothStreamsReceiving", "single stream must fail bothStreamsReceiving gate");

  // 3d: both streams present but one in "waiting" state → must block
  const waitingStreamResult = evaluateAlertGates(buildPassingSnapshot({
    streams: [
      { schema: "mbp-1", state: "receiving", eventCount: 10, lastEventAt: new Date() },
      { schema: "ohlcv-1s", state: "waiting", eventCount: 0, lastEventAt: null },
    ],
  }));
  assert.equal(waitingStreamResult.ok, false, "one stream waiting must block (fail-closed)");
  assert.equal(waitingStreamResult.failedGate, "bothStreamsReceiving", "waiting stream must fail bothStreamsReceiving gate");

  // 3e: both streams in "error" state → must block
  const errorStreamsResult = evaluateAlertGates(buildPassingSnapshot({
    streams: [
      { schema: "mbp-1", state: "error", eventCount: 0, lastEventAt: null },
      { schema: "ohlcv-1s", state: "error", eventCount: 0, lastEventAt: null },
    ],
  }));
  assert.equal(errorStreamsResult.ok, false, "error streams must block (fail-closed)");

  // 3f: both streams "receiving" → must pass this gate
  const goodStreamsResult = evaluateAlertGates(buildPassingSnapshot({
    streams: [
      { schema: "mbp-1", state: "receiving", eventCount: 50, lastEventAt: new Date() },
      { schema: "ohlcv-1s", state: "receiving", eventCount: 40, lastEventAt: new Date() },
    ],
  }));
  assert.equal(goodStreamsResult.ok, true, "both streams receiving must pass (full gates pass)");

  // ---------------------------------------------------------------------------
  // 4. Individual gate failures — each gate must block independently
  // ---------------------------------------------------------------------------

  const gateTests = [
    {
      label: "marketFeedState not streaming",
      override: { marketFeedState: "stale" },
      expectedGate: "marketFeedStreaming",
    },
    {
      label: "scoreState not available",
      override: { scoreState: "insufficient" },
      expectedGate: "scoreAvailable",
    },
    {
      label: "dataQuality not good",
      override: { dataQuality: "degraded" },
      expectedGate: "scoreGood",
    },
    {
      label: "score null",
      override: { score: null },
      expectedGate: "scoreNonNull",
    },
    {
      label: "preBreakout not dataFresh",
      override: { dataFresh: false },
      expectedGate: "preBreakoutDataFresh",
    },
    {
      label: "connectionState not streaming (heartbeat veto)",
      override: { connectionState: "connected" },
      expectedGate: "noHeartbeatVeto",
    },
    {
      label: "subscriptionVerified false",
      override: { subscriptionVerified: false },
      expectedGate: "subscriptionVerified",
    },
    {
      label: "realMarketEventReceived false",
      override: { realMarketEventReceived: false },
      expectedGate: "realMarketEventReceived",
    },
    {
      label: "enteredScoringWindow false",
      override: { enteredScoringWindow: false },
      expectedGate: "enteredScoringWindow",
    },
    {
      label: "scoringEligible false",
      override: { scoringEligible: false },
      expectedGate: "scoringEligible",
    },
    {
      label: "triggerEvidenceAvailable false",
      override: { triggerEvidenceAvailable: false },
      expectedGate: "triggerEvidenceAvailable",
    },
    {
      label: "velocityGateSatisfied false (focused leader veto)",
      override: { velocityGateSatisfied: false },
      expectedGate: "noFocusedLeaderVeto",
    },
    {
      label: "detectionState watch (shadow veto)",
      override: { detectionState: "watch", confirmationStatus: "pending" },
      expectedGate: "noShadowVeto",
    },
    {
      label: "detectionState unavailable (shadow veto)",
      override: { detectionState: "unavailable", confirmationStatus: "unavailable" },
      expectedGate: "noShadowVeto",
    },
    {
      label: "confirmation status rejected (ranking veto)",
      override: { confirmationStatus: "rejected" },
      expectedGate: "noRankingVeto",
    },
    {
      label: "confirmation status unavailable (ranking veto)",
      override: { detectionState: "breakout_critical", confirmationStatus: "unavailable" },
      expectedGate: "noRankingVeto",
    },
    {
      // dataQuality "missing" is caught by the scoreGood gate (checks dataQuality === "good")
      // which comes before the defence-in-depth noMissingDataVeto gate
      label: "dataQuality missing (caught at scoreGood gate)",
      override: { dataQuality: "missing", scoreState: "available", score: 82 },
      expectedGate: "scoreGood",
    },
  ];

  for (const { label, override, expectedGate } of gateTests) {
    const snapshot = buildPassingSnapshot(override);
    const result = evaluateAlertGates(snapshot);
    assert.equal(result.ok, false, `[${label}] gate must block evaluation`);
    assert.equal(
      result.failedGate,
      expectedGate,
      `[${label}] wrong gate blocked — expected "${expectedGate}", got "${result.failedGate}"`,
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Core component scoreEligible gates
  // ---------------------------------------------------------------------------

  const componentNames = ["momentum", "volumeIntensity", "orderFlowPressure", "spread"];
  for (const component of componentNames) {
    const snapshot = buildPassingSnapshot();
    snapshot.alphaRadar[component] = { ...snapshot.alphaRadar[component], scoreEligible: false };
    const result = evaluateAlertGates(snapshot);
    assert.equal(result.ok, false, `scoreEligible=false on ${component} must block`);
    assert.equal(result.failedGate, "coreComponentsScoreEligible", `component ${component} ineligible must fail coreComponentsScoreEligible gate`);
  }

  // ---------------------------------------------------------------------------
  // 6. AlertMonitor — cooldown
  // ---------------------------------------------------------------------------

  const cooldownMonitor = new AlertMonitor({ cooldownMs: 5_000, maxOutcomeHistory: 10 });
  const s1 = buildPassingSnapshot({ symbol: "NVDA" });

  const obs1 = cooldownMonitor.observe(s1);
  assert.equal(obs1.isNewCandidate, true, "first passing observation must be a new candidate");
  assert.equal(obs1.result.ok, true, "first observation must succeed");

  // Second immediate call — same event key → deduped
  const obs2 = cooldownMonitor.observe(s1);
  assert.equal(obs2.isNewCandidate, false, "same event key within cooldown must not be a new candidate");
  assert.equal(obs2.result.ok, false, "deduped observation must return ok=false");

  // Different event key but still in cooldown
  const s2 = buildPassingSnapshot({ symbol: "NVDA", detectionState: "latent", confirmationStatus: "pending", score: 70 });
  const obs3 = cooldownMonitor.observe(s2);
  assert.equal(obs3.isNewCandidate, false, "different event key but within cooldown must still be blocked");
  assert.equal(obs3.result.ok, false, "within-cooldown observation must return ok=false");

  const immediateTakeProfit = buildPassingSnapshot({
    symbol: "NVDA",
    detectionState: "watch",
    confirmationStatus: "rejected",
    velocityGateSatisfied: false,
    postState: "take_profit_watch",
    postActive: true,
    postDataFresh: true,
    postTransitionAt: new Date(Date.now() - 1_000),
  });
  const takeProfitObservation = cooldownMonitor.observe(immediateTakeProfit);
  assert.equal(
    takeProfitObservation.isNewCandidate,
    true,
    "a fresh take-profit transition immediately after entry must use its own cooldown lane",
  );
  assert.equal(takeProfitObservation.result.ok, true);
  const immediateReversal = buildPassingSnapshot({
    symbol: "NVDA",
    detectionState: "watch",
    confirmationStatus: "rejected",
    velocityGateSatisfied: false,
    postState: "trend_reversal_confirmed",
    postActive: true,
    postDataFresh: true,
    postTransitionAt: new Date(),
  });
  const reversalObservation = cooldownMonitor.observe(immediateReversal);
  assert.equal(
    reversalObservation.isNewCandidate,
    true,
    "a confirmed reversal immediately after take-profit watch must use its own cooldown lane",
  );
  assert.equal(reversalObservation.result.ok, true);
  const duplicateReversal = cooldownMonitor.observe(immediateReversal);
  assert.equal(duplicateReversal.isNewCandidate, false, "the exact exit transition must still be deduplicated");

  // ---------------------------------------------------------------------------
  // 7. AlertMonitor — different symbols are independent
  // ---------------------------------------------------------------------------

  const multiMonitor = new AlertMonitor({ cooldownMs: 60_000 });
  const nvdaSnap = buildPassingSnapshot({ symbol: "NVDA" });
  const muSnap = buildPassingSnapshot({ symbol: "MU" });

  const nvdaObs = multiMonitor.observe(nvdaSnap);
  const muObs = multiMonitor.observe(muSnap);
  assert.equal(nvdaObs.isNewCandidate, true, "NVDA must generate its own candidate");
  assert.equal(muObs.isNewCandidate, true, "MU must generate an independent candidate");
  assert.equal(nvdaObs.result.ok, true, "NVDA result must be ok");
  assert.equal(muObs.result.ok, true, "MU result must be ok");

  // Repeated NVDA with same key → deduped; MU still independent
  const nvdaObs2 = multiMonitor.observe(nvdaSnap);
  const muObs2 = multiMonitor.observe(buildPassingSnapshot({ symbol: "MU", score: 75 }));
  assert.equal(nvdaObs2.isNewCandidate, false, "repeated NVDA same key must be deduped");
  assert.equal(muObs2.isNewCandidate, false, "MU within cooldown must not re-trigger");

  // ---------------------------------------------------------------------------
  // 8. AlertMonitor — health snapshot
  // ---------------------------------------------------------------------------

  const healthMonitor = new AlertMonitor({ cooldownMs: 60_000, maxOutcomeHistory: 20 });
  assert.equal(healthMonitor.getSymbolHealth("NVDA"), undefined, "unobserved symbol health must be undefined");

  const hSnap = buildPassingSnapshot({ symbol: "NVDA" });
  healthMonitor.observe(hSnap);
  healthMonitor.observe(buildPassingSnapshot({ symbol: "NVDA", marketFeedState: "stale" }));
  healthMonitor.observe(buildPassingSnapshot({ symbol: "NVDA", marketFeedState: "stale" }));

  const health = healthMonitor.getSymbolHealth("NVDA");
  assert.ok(health, "observed symbol must have health data");
  assert.equal(health.symbol, "NVDA", "health snapshot must carry the symbol");
  assert.ok(health.lastCandidateAt instanceof Date, "health must record last candidate time");
  assert.ok(health.consecutiveBlocked >= 2, "blocked observations must increment consecutiveBlocked");
  assert.ok(health.recentOutcomeCount >= 3, "outcome history must be retained");

  // ---------------------------------------------------------------------------
  // 9. AlertMonitor — resetSymbol clears state
  // ---------------------------------------------------------------------------

  healthMonitor.resetSymbol("NVDA");
  const afterReset = healthMonitor.getSymbolHealth("NVDA");
  assert.equal(afterReset, undefined, "resetSymbol must clear the health entry");

  // ---------------------------------------------------------------------------
  // 10. AlertMonitor — non-throwing on malformed input
  // ---------------------------------------------------------------------------

  const errorMonitor = new AlertMonitor();
  const badResult = errorMonitor.observe(null);
  assert.equal(badResult.result.ok, false, "null input must not throw — must return blocked/error result");
  assert.equal(badResult.isNewCandidate, false, "null input must not generate a candidate");

  const badResult2 = errorMonitor.observe({});
  assert.equal(badResult2.result.ok, false, "empty object input must not throw (streams absent = fail-closed)");

  // ---------------------------------------------------------------------------
  // 11. observeRadarStatus helper — multi-symbol
  // ---------------------------------------------------------------------------

  const radarStatus = {
    symbolRadars: [
      buildPassingSnapshot({ symbol: "NVDA" }),
      buildPassingSnapshot({ symbol: "MU" }),
      buildPassingSnapshot({ symbol: "AMD", marketFeedState: "stale" }), // should be blocked
    ],
  };

  const statusMonitor = new AlertMonitor({ cooldownMs: 60_000 });
  const observations = observeRadarStatus(statusMonitor, radarStatus);
  assert.equal(observations.length, 3, "observeRadarStatus must return one observation per symbol");
  assert.equal(
    observations.filter((o) => o.isNewCandidate).length,
    2,
    "only symbols with all gates passing must generate new candidates",
  );
  assert.equal(
    observations.find((o) => o.symbol === "AMD")?.isNewCandidate,
    false,
    "AMD with stale feed must not generate a candidate",
  );

  // ---------------------------------------------------------------------------
  // 12. createSymbolState baseline
  // ---------------------------------------------------------------------------

  const freshState = createSymbolState();
  assert.equal(freshState.lastEventKey, undefined, "fresh state must have no last event key");
  assert.equal(freshState.lastCandidateAt, 0, "fresh state must have zero last candidate timestamp");
  assert.deepEqual(freshState.recentOutcomes, [], "fresh state must have empty outcome history");
  assert.equal(freshState.consecutiveBlocked, 0, "fresh state must have zero consecutive blocks");
  assert.equal(freshState.consecutiveErrors, 0, "fresh state must have zero consecutive errors");

  // ---------------------------------------------------------------------------
  // 13. Bounded outcome history
  // ---------------------------------------------------------------------------

  const boundedMonitor = new AlertMonitor({ cooldownMs: 0, maxOutcomeHistory: 5 });
  for (let i = 0; i < 10; i++) {
    boundedMonitor.observe(buildPassingSnapshot({
      symbol: "CRDO",
      transitionAt: new Date(Date.now() + i + 1),
    }));
  }
  const boundedHealth = boundedMonitor.getSymbolHealth("CRDO");
  assert.ok(
    boundedHealth.recentOutcomeCount <= 5,
    "outcome history must be bounded to maxOutcomeHistory",
  );

  // ---------------------------------------------------------------------------
  // 14. Immutable candidate — no modification after creation
  // ---------------------------------------------------------------------------

  const immMonitor = new AlertMonitor({ cooldownMs: 0 });
  const immObs = immMonitor.observe(buildPassingSnapshot({ symbol: "VRT" }));
  assert.equal(immObs.result.ok, true, "immutability test prerequisite: must pass gates");
  const candidate = immObs.result.candidate;
  assert.throws(
    () => { candidate.symbol = "MODIFIED"; },
    "frozen candidate must throw on mutation attempt",
  );

  // ---------------------------------------------------------------------------
  // 15. Stale/disconnect scenarios — feed going stale must block
  // ---------------------------------------------------------------------------

  // Stale marketFeedState while streams still show receiving — feed gate wins
  const staleFeedResult = evaluateAlertGates(buildPassingSnapshot({
    symbol: "NVDA",
    marketFeedState: "stale",
    streams: [
      { schema: "mbp-1", state: "receiving", eventCount: 10, lastEventAt: new Date() },
      { schema: "ohlcv-1s", state: "receiving", eventCount: 8, lastEventAt: new Date() },
    ],
  }));
  assert.equal(staleFeedResult.ok, false, "stale marketFeedState must block even when streams show receiving");
  assert.equal(staleFeedResult.failedGate, "marketFeedStreaming", "stale feed must fail marketFeedStreaming gate");

  // Streams go to waiting while marketFeedState still says streaming — streams gate wins
  const streamGoneResult = evaluateAlertGates(buildPassingSnapshot({
    symbol: "NVDA",
    marketFeedState: "streaming",
    streams: [
      { schema: "mbp-1", state: "waiting", eventCount: 0, lastEventAt: null },
      { schema: "ohlcv-1s", state: "receiving", eventCount: 8, lastEventAt: new Date() },
    ],
  }));
  assert.equal(streamGoneResult.ok, false, "one stream going waiting must block");
  assert.equal(streamGoneResult.failedGate, "bothStreamsReceiving", "waiting stream must fail stream gate");

  // Complete disconnect (connectionState error) — heartbeat veto
  const disconnectResult = evaluateAlertGates(buildPassingSnapshot({
    symbol: "NVDA",
    connectionState: "error",
    marketFeedState: "offline",
  }));
  assert.equal(disconnectResult.ok, false, "disconnected state must block");
  // bothStreamsReceiving will fail first (streams present but feed offline context)
  assert.ok(
    ["bothStreamsReceiving", "marketFeedStreaming", "noHeartbeatVeto"].includes(disconnectResult.failedGate),
    `disconnect must fail an appropriate gate, got: ${disconnectResult.failedGate}`,
  );

  // ---------------------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------------------

  console.log("Alert monitor tests passed: fail-closed stream gate, gate evaluation, deduplication, cooldown, multi-symbol isolation, health snapshots, bounded history, immutability, non-throwing error handling, stale/disconnect scenarios.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
