import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const sourcePath = resolve("artifacts/api-server/src/lib/alphaRadar.ts");
const outputDirectory = mkdtempSync(join(tmpdir(), "alpha-radar-test-"));
const outputPath = join(outputDirectory, "alphaRadar.cjs");

try {
  const source = readFileSync(sourcePath, "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(outputPath, output);

  const require = createRequire(import.meta.url);
  const {
    addAlphaRadarDynamics,
    appendSignalHistoryEntry,
    calculateAlphaRadar,
    updatePostBreakoutMonitoring,
    updatePreBreakoutDetection,
  } = require(outputPath);
  const now = new Date("2026-08-19T14:30:00.000Z");

  const timestamps = [
    ...Array.from({ length: 9 }, (_, index) => new Date(now.getTime() - (300_000 - index * 30_000))),
    new Date(now.getTime() - 7_000),
    now,
  ];
  const quotes = timestamps.map((timestamp, index) => {
    const bid = 100 + index * 0.05;
    return {
      timestamp,
      bidPrice: bid,
      askPrice: bid + 0.01,
      bidSize: index === timestamps.length - 1 ? 300 : 100,
      askSize: index === timestamps.length - 1 ? 100 : 100,
    };
  });
  const trades = timestamps.map((timestamp, index) => ({
    timestamp,
    price: 100 + index * 0.05,
    size: index === timestamps.length - 1 ? 100 : 10,
    side: index === timestamps.length - 1 ? "B" : index % 2 === 0 ? "A" : "B",
  }));

  const active = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes,
    trades,
    bars: [],
  });
  assert.equal(active.dataQuality, "good", "fresh observations should be marked good");
  assert.equal(active.scoreState, "available", "fresh complete inputs should make scoring available");
  assert.ok(
    active.status === "Watch" || active.status === "Breakout Setup",
    "aligned live activity should produce an available live status",
  );
  assert.equal(typeof active.score, "number", "fresh complete inputs should produce a numeric score");
  assert.ok(active.score >= 72, "aligned activity should create a high transparent score");
  assert.ok(active.confidence >= 90, "complete fresh components should be high confidence");
  assert.equal(active.unusualActivity.detected, true, "volume burst should be detected");
  assert.ok((active.orderFlowPressure.value ?? 0) > 0, "buy-heavy live trades should show positive pressure");
  assert.equal(active.diagnostics.scoring_gate_reason, "ready", "complete fresh inputs should expose a ready gate reason");
  assert.ok(active.diagnostics.fresh_quotes >= 2, "diagnostics should count fresh quotes");
  assert.ok(active.diagnostics.fresh_trades >= 2, "diagnostics should count fresh trades");
  assert.ok(active.diagnostics.fresh_prices >= 2, "diagnostics should count distinct fresh price timestamps");
  assert.ok(active.diagnostics.fresh_volume >= 2, "diagnostics should count fresh volume observations");
  assert.ok((active.diagnostics.valid_window_age ?? 0) >= 0, "diagnostics should report the valid window age");

  const confirmedSnapshot = {
    ...active,
    preBreakout: {
      ...active.preBreakout,
      state: "confirmed",
      dataFresh: true,
      confirmation: { ...active.preBreakout.confirmation, status: "confirmed" },
    },
    changeIndicators: { ...active.changeIndicators, volumeAcceleration: 2 },
    orderFlowPressure: { ...active.orderFlowPressure, value: 25 },
  };
  const breakoutTrades = [29_000, 24_000, 19_000, 14_000, 9_000, 0].map((offset, index) => ({
    timestamp: new Date(now.getTime() - offset),
    price: index === 5 ? 100.6 : 100 + index * 0.1,
    size: 10,
    side: "B",
  }));
  const postStart = updatePostBreakoutMonitoring(
    confirmedSnapshot,
    {
      active: false,
      state: "unavailable",
      breakoutPrice: null,
      highSinceBreakout: null,
      consecutiveWeakScans: 0,
      consecutiveReversalScans: 0,
      lastTransitionAt: null,
    },
    {
      now,
      connectionState: "streaming",
      quotes,
      trades: breakoutTrades,
      bars: [],
    },
  );
  assert.equal(
    postStart.snapshot.postBreakout.state,
    "trend_continuation",
    `a confirmed real rolling-high break should activate follow monitoring: ${postStart.snapshot.postBreakout.reason}`,
  );
  assert.equal(postStart.snapshot.postBreakout.active, true, "only a proven live break should activate monitoring");
  assert.ok(
    (postStart.snapshot.postBreakout.breakoutPrice ?? 0) > 100
      && (postStart.snapshot.postBreakout.breakoutPrice ?? 0) < (postStart.snapshot.postBreakout.latestPrice ?? Infinity),
    "monitoring should retain an observed prior high, not invent a target",
  );

  const weakSnapshot = {
    ...confirmedSnapshot,
    changeIndicators: { ...confirmedSnapshot.changeIndicators, volumeAcceleration: -12 },
    orderFlowPressure: { ...confirmedSnapshot.orderFlowPressure, value: -25 },
  };
  const weakTrades = breakoutTrades.map((trade, index) => ({
    ...trade,
    price: index === breakoutTrades.length - 1 ? 99.7 : trade.price,
    side: "A",
  }));
  const weakQuotes = [...quotes, {
    timestamp: now,
    bidPrice: 99.69,
    askPrice: 99.71,
    bidSize: 50,
    askSize: 400,
  }];
  const firstWeak = updatePostBreakoutMonitoring(postStart.snapshot, postStart.machine, {
    now,
    connectionState: "streaming",
    quotes: weakQuotes,
    trades: weakTrades,
    bars: [],
  });
  assert.equal(firstWeak.snapshot.postBreakout.state, "take_profit_watch", "weak live flow and a lost break should warn without a fixed-percent target");
  assert.equal(
    firstWeak.snapshot.counterEvidence.strength,
    "strong",
    "a lost real breakout and weakening post-breakout structure must be published as strong counter-evidence",
  );
  const secondWeak = updatePostBreakoutMonitoring(firstWeak.snapshot, firstWeak.machine, {
    now: new Date(now.getTime() + 1_000),
    connectionState: "streaming",
    quotes: weakQuotes.map((quote) => ({ ...quote, timestamp: new Date(now.getTime() + 1_000) })),
    trades: weakTrades.map((trade) => ({ ...trade, timestamp: new Date(now.getTime() + 1_000) })),
    bars: [],
  });
  assert.equal(secondWeak.snapshot.postBreakout.state, "trend_reversal_confirmed", "reversal requires consecutive real weak scans");
  const stalePost = updatePostBreakoutMonitoring(secondWeak.snapshot, secondWeak.machine, {
    now: new Date(now.getTime() + 30_000),
    connectionState: "streaming",
    quotes: weakQuotes,
    trades: weakTrades,
    bars: [],
  });
  assert.equal(stalePost.snapshot.postBreakout.state, "unavailable", "stale observations must suppress post-breakout exit signals");
  assert.equal(stalePost.machine.active, false, "a stale interval must discard the prior breakout context");
  const recoveredWithoutBreak = updatePostBreakoutMonitoring(stalePost.snapshot, stalePost.machine, {
    now: new Date(now.getTime() + 31_000),
    connectionState: "streaming",
    quotes: [{
      timestamp: new Date(now.getTime() + 31_000),
      bidPrice: 99.69,
      askPrice: 99.71,
      bidSize: 50,
      askSize: 400,
    }],
    trades: [31_000, 25_000, 20_000, 15_000, 10_000, 0].map((offset) => ({
      timestamp: new Date(now.getTime() + 31_000 - offset),
      price: 99.7,
      size: 10,
      side: "A",
    })),
    bars: [],
  });
  assert.equal(
    recoveredWithoutBreak.snapshot.postBreakout.state,
    "unavailable",
    "fresh recovery without a newly confirmed crossing must not resume old exit monitoring",
  );

  const validHistory = [
    {
      generatedAt: new Date(now.getTime() - 65_000),
      score: (active.score ?? 70) - 10,
      momentumScore: (active.momentum.score ?? 60) - 8,
      volumeScore: (active.volumeIntensity.score ?? 60) - 6,
      orderFlowScore: (active.orderFlowPressure.score ?? 60) - 5,
      spreadScore: (active.spread.score ?? 60) - 4,
    },
    {
      generatedAt: new Date(now.getTime() - 31_000),
      score: (active.score ?? 70) - 6,
      momentumScore: (active.momentum.score ?? 60) - 5,
      volumeScore: (active.volumeIntensity.score ?? 60) - 4,
      orderFlowScore: (active.orderFlowPressure.score ?? 60) - 3,
      spreadScore: (active.spread.score ?? 60) - 3,
    },
    {
      generatedAt: new Date(now.getTime() - 5_000),
      score: (active.score ?? 70) - 2,
      momentumScore: (active.momentum.score ?? 60) - 2,
      volumeScore: (active.volumeIntensity.score ?? 60) - 2,
      orderFlowScore: (active.orderFlowPressure.score ?? 60) - 2,
      spreadScore: (active.spread.score ?? 60) - 2,
    },
  ];
  const dynamicActive = addAlphaRadarDynamics(
    { ...active, status: "Watch" },
    validHistory,
    {
      lastScannedAt: now,
      scanIntervalMs: 1_000,
      scanMode: "opening",
      triggerReason: "rapid_midpoint_change",
      eventTriggered: true,
    },
  );
  assert.ok((dynamicActive.alphaVelocity.delta30s ?? 0) > 0, "a valid 30-second baseline should produce Alpha Velocity");
  assert.ok((dynamicActive.alphaVelocity.rate30s ?? 0) > 0, "Alpha Velocity should express positive score speed");
  assert.ok((dynamicActive.alphaVelocity.delta60s ?? 0) > 0, "a valid 60-second baseline should produce longer-horizon velocity");
  assert.ok((dynamicActive.changeIndicators.momentumAcceleration ?? 0) > 0, "momentum acceleration must use valid scan history");
  assert.ok((dynamicActive.changeIndicators.volumeAcceleration ?? 0) > 0, "volume acceleration must use valid scan history");
  assert.ok((dynamicActive.changeIndicators.orderFlowShift ?? 0) > 0, "order-flow shift must use valid scan history");
  assert.equal(dynamicActive.preBreakoutWatch, true, "multiple improving fresh components should enable the advisory watch");
  assert.equal(dynamicActive.scan.scanMode, "opening", "scan metadata should retain the adaptive opening mode");
  assert.equal(dynamicActive.scan.eventTriggered, true, "scan metadata should retain the event trigger");
  assert.equal(
    dynamicActive.multiTimeframe.alignment,
    "aligned",
    "short-window strength must be explained by supportive observed medium and higher contexts",
  );
  assert.equal(
    dynamicActive.dataConfidence.state,
    "high",
    "complete fresh evidence with aligned observed contexts should earn high Data Confidence",
  );
  assert.equal(
    dynamicActive.score,
    active.score,
    "Data Confidence and timeframe context must not alter the Signal Score opportunity-strength formula",
  );

  const stronglyImproving = {
    ...dynamicActive,
    score: 78,
    alphaVelocity: { ...dynamicActive.alphaVelocity, rate30s: 18 },
    changeIndicators: {
      momentumAcceleration: 18,
      volumeAcceleration: 16,
      orderFlowShift: 14,
      spreadTightening: 12,
    },
  };
  let machine = {
    state: "unavailable",
    pendingState: null,
    pendingCount: 0,
    lastTransitionAt: null,
    lastTransitionEvidenceCount: 0,
    lastTransitionReasons: [],
    confirmationPersistenceScans: 0,
  };
  let detected = updatePreBreakoutDetection(stronglyImproving, machine, now);
  machine = detected.machine;
  assert.equal(detected.snapshot.preBreakout.state, "watch", "the first valid scan establishes WATCH without skipping levels");
  assert.equal(
    detected.snapshot.preBreakout.confirmation.status,
    "pending",
    "a single converging scan must remain pending",
  );
  assert.equal(
    detected.snapshot.preBreakout.confirmation.persistenceScans,
    1,
    "the first converging scan should begin, not complete, trajectory persistence",
  );
  assert.ok(
    detected.snapshot.preBreakout.confirmation.missingEvidence.includes("Persistent multi-scan trajectory"),
    "single-scan confirmation should explain the missing trajectory persistence",
  );
  for (const expectedState of ["latent", "breakout_critical", "confirmed"]) {
    detected = updatePreBreakoutDetection(
      stronglyImproving,
      machine,
      new Date(now.getTime() + (expectedState === "latent" ? 2 : expectedState === "breakout_critical" ? 4 : 6) * 1_000),
    );
    machine = detected.machine;
    detected = updatePreBreakoutDetection(
      stronglyImproving,
      machine,
      new Date(now.getTime() + (expectedState === "latent" ? 3 : expectedState === "breakout_critical" ? 5 : 7) * 1_000),
    );
    machine = detected.machine;
    assert.equal(detected.snapshot.preBreakout.state, expectedState, `two confirming scans should promote ${expectedState}`);
  }
  assert.equal(detected.snapshot.preBreakout.evidenceCount, 4, "confirmed detection must count only direct independent evidence");
  assert.equal(detected.snapshot.preBreakoutWatch, true, "pre-breakout and confirmed states retain the advisory flag");
  assert.equal(
    detected.snapshot.preBreakout.confirmation.status,
    "confirmed",
    "all fresh factors persisting across scans should confirm the strongest detection",
  );
  assert.ok(
    detected.snapshot.preBreakout.confirmation.persistenceScans >= 3,
    "confirmed evidence must persist across at least three consecutive observations",
  );
  assert.deepEqual(
    detected.snapshot.preBreakout.confirmation.missingEvidence,
    [],
    "confirmed evidence should not report missing categories",
  );
  const strongCounterEvidence = updatePreBreakoutDetection(
    {
      ...stronglyImproving,
      dataConfidence: { ...stronglyImproving.dataConfidence, state: "high", score: 100 },
      orderFlowPressure: { ...stronglyImproving.orderFlowPressure, value: -25 },
      changeIndicators: {
        ...stronglyImproving.changeIndicators,
        orderFlowShift: -12,
        volumeAcceleration: -12,
      },
    },
    detected.machine,
    new Date(now.getTime() + 9_000),
  );
  assert.equal(
    strongCounterEvidence.snapshot.counterEvidence.strength,
    "strong",
    "independent observed selling pressure and price/volume divergence must be recorded as strong counter-evidence",
  );
  assert.notEqual(
    strongCounterEvidence.snapshot.preBreakout.state,
    "confirmed",
    "strong counter-evidence must prevent a highest-grade stage from persisting",
  );
  assert.equal(
    strongCounterEvidence.snapshot.preBreakout.state,
    "watch",
    "a confirmed signal losing confirmation under strong counter-evidence must not degrade into an alertable breakout-critical state",
  );
  const strongestEvidenceLossCases = [
    {
      label: "a required direct factor",
      snapshot: {
        ...stronglyImproving,
        changeIndicators: {
          ...stronglyImproving.changeIndicators,
          volumeAcceleration: 0,
        },
      },
    },
    {
      label: "the Alpha Velocity gate",
      snapshot: {
        ...stronglyImproving,
        alphaVelocity: { ...stronglyImproving.alphaVelocity, rate30s: 2 },
      },
    },
    {
      label: "the Alpha score-strength gate",
      snapshot: {
        ...stronglyImproving,
        score: 50,
      },
    },
  ];
  for (const [index, lossCase] of strongestEvidenceLossCases.entries()) {
    const forcedDowngrade = updatePreBreakoutDetection(
      lossCase.snapshot,
      detected.machine,
      new Date(now.getTime() + 10_000 + index * 1_000),
    );
    assert.notEqual(
      forcedDowngrade.snapshot.preBreakout.state,
      "confirmed",
      `losing ${lossCase.label} must immediately remove CONFIRMED`,
    );
    assert.ok(
      ["watch", "latent", "breakout_critical"].includes(forcedDowngrade.snapshot.preBreakout.state),
      `losing ${lossCase.label} must immediately downgrade to a non-confirmed stage`,
    );
    assert.notEqual(
      forcedDowngrade.snapshot.preBreakout.confirmation.status,
      "confirmed",
      `losing ${lossCase.label} must immediately revoke confirmation`,
    );
    assert.ok(
      forcedDowngrade.snapshot.preBreakout.transitionReasons.some((reason) =>
        reason.startsWith("Confirmation no longer met:"),
      ),
      "a forced downgrade must record the confirmation loss as transition evidence",
    );
  }

  const twoDirectSignals = {
    ...stronglyImproving,
    changeIndicators: {
      momentumAcceleration: 18,
      volumeAcceleration: 16,
      orderFlowShift: 0,
      spreadTightening: 0,
    },
  };
  let twoSignalMachine = {
    state: "unavailable",
    pendingState: null,
    pendingCount: 0,
    lastTransitionAt: null,
    lastTransitionEvidenceCount: 0,
    lastTransitionReasons: [],
    confirmationPersistenceScans: 0,
  };
  for (let scan = 0; scan < 8; scan += 1) {
    const result = updatePreBreakoutDetection(
      twoDirectSignals,
      twoSignalMachine,
      new Date(now.getTime() + 20_000 + scan * 1_000),
    );
    twoSignalMachine = result.machine;
    assert.notEqual(
      result.snapshot.preBreakout.state,
      "breakout_critical",
      "two direct components plus derived Alpha Velocity must not reach breakout-critical",
    );
    assert.notEqual(
      result.snapshot.preBreakout.state,
      "confirmed",
      "two direct components plus derived Alpha Velocity must not reach confirmed",
    );
  }

  const spikeMachine = {
    state: "unavailable",
    pendingState: null,
    pendingCount: 0,
    lastTransitionAt: null,
    lastTransitionEvidenceCount: 0,
    lastTransitionReasons: [],
    confirmationPersistenceScans: 0,
  };
  const isolatedSpike = updatePreBreakoutDetection(
    stronglyImproving,
    spikeMachine,
    new Date(now.getTime() + 40_000),
  );
  assert.equal(
    isolatedSpike.snapshot.preBreakout.confirmation.status,
    "pending",
    "one isolated spike must not qualify as confirmed",
  );
  assert.notEqual(
    isolatedSpike.snapshot.preBreakout.state,
    "breakout_critical",
    "the confirmation gate must block BREAKOUT-CRITICAL after one spike",
  );
  assert.notEqual(
    isolatedSpike.snapshot.preBreakout.state,
    "confirmed",
    "the confirmation gate must block CONFIRMED after one spike",
  );
  const evidenceLost = updatePreBreakoutDetection(
    {
      ...stronglyImproving,
      alphaVelocity: { ...stronglyImproving.alphaVelocity, rate30s: 2 },
      changeIndicators: {
        momentumAcceleration: 18,
        volumeAcceleration: 0,
        orderFlowShift: 0,
        spreadTightening: 0,
      },
    },
    isolatedSpike.machine,
    new Date(now.getTime() + 41_000),
  );
  assert.equal(
    evidenceLost.snapshot.preBreakout.confirmation.persistenceScans,
    0,
    "losing one or more required factors must reset confirmation persistence",
  );
  assert.ok(
    evidenceLost.snapshot.preBreakout.confirmation.missingEvidence.includes("Volume acceleration"),
    "pending or rejected confirmation must name missing volume evidence",
  );
  assert.ok(
    evidenceLost.snapshot.preBreakout.confirmation.missingEvidence.includes("Positive Alpha Velocity"),
    "pending or rejected confirmation must name missing Velocity support",
  );

  const unavailableDetection = updatePreBreakoutDetection(
    { ...detected.snapshot, scoreState: "stale", score: null, dataQuality: "stale" },
    machine,
    new Date(now.getTime() + 8_000),
  );
  assert.equal(unavailableDetection.snapshot.preBreakout.state, "unavailable", "stale data must revoke the real-time detection state");
  assert.equal(unavailableDetection.snapshot.preBreakoutWatch, false, "stale data must not retain the advisory flag");
  assert.equal(
    unavailableDetection.snapshot.preBreakout.confirmation.status,
    "unavailable",
    "stale data must immediately invalidate confirmation",
  );
  assert.equal(
    unavailableDetection.machine.confirmationPersistenceScans,
    0,
    "stale data must clear confirmation persistence",
  );

  const historyEntry = (index, overrides = {}) => ({
    occurredAt: new Date(now.getTime() + index * 1_000),
    fromState: index % 2 === 0 ? "watch" : "latent",
    toState: index % 2 === 0 ? "latent" : "watch",
    fromConfirmationStatus: index % 2 === 0 ? "rejected" : "pending",
    toConfirmationStatus: index % 2 === 0 ? "pending" : "rejected",
    score: 60 + index,
    confidence: 100,
    alphaVelocity: 6 + index,
    evidenceCount: 3,
    satisfiedEvidence: ["Fresh price momentum"],
    missingEvidence: ["Persistent multi-scan trajectory"],
    dataFresh: true,
    reason: "Deterministic trajectory test.",
    ...overrides,
  });
  let signalHistory = appendSignalHistoryEntry([], historyEntry(0));
  signalHistory = appendSignalHistoryEntry(
    signalHistory,
    historyEntry(1, {
      fromState: "latent",
      toState: "latent",
      fromConfirmationStatus: "pending",
      toConfirmationStatus: "pending",
    }),
  );
  assert.equal(
    signalHistory.length,
    1,
    "repeated scans with the same detection and confirmation state must be deduplicated",
  );
  for (let index = 1; index <= 30; index += 1) {
    signalHistory = appendSignalHistoryEntry(signalHistory, historyEntry(index));
  }
  assert.equal(signalHistory.length, 24, "signal trajectory retention must remain bounded");
  assert.ok(
    signalHistory.every((entry, index, entries) =>
      index === 0 || entry.occurredAt.getTime() >= entries[index - 1].occurredAt.getTime(),
    ),
    "retained trajectory entries must remain chronological",
  );
  const withInvalidation = appendSignalHistoryEntry(
    signalHistory,
    historyEntry(31, {
      fromState: signalHistory.at(-1).toState,
      toState: "unavailable",
      fromConfirmationStatus: signalHistory.at(-1).toConfirmationStatus,
      toConfirmationStatus: "unavailable",
      score: null,
      alphaVelocity: null,
      evidenceCount: 0,
      satisfiedEvidence: [],
      missingEvidence: ["Fresh price momentum"],
      dataFresh: false,
      reason: "Live data became stale.",
    }),
  );
  assert.equal(withInvalidation.at(-1).toState, "unavailable", "trajectory must retain explicit live-state invalidation");
  assert.equal(
    withInvalidation.at(-1).toConfirmationStatus,
    "unavailable",
    "trajectory must retain confirmation invalidation without recording every scan",
  );

  const minimumFreshWindow = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes: [
      {
        timestamp: new Date(now.getTime() - 6_000),
        bidPrice: 100,
        askPrice: 100.01,
        bidSize: 120,
        askSize: 80,
      },
      {
        timestamp: now,
        bidPrice: 100.04,
        askPrice: 100.05,
        bidSize: 150,
        askSize: 50,
      },
    ],
    trades: [
      { timestamp: new Date(now.getTime() - 6_000), price: 100, size: 20, side: null },
      { timestamp: now, price: 100.05, size: 30, side: null },
    ],
    bars: [],
  });
  assert.equal(minimumFreshWindow.scoreState, "available", "two fresh prices and real trade sizes should establish the minimum window");
  assert.equal(typeof minimumFreshWindow.score, "number", "a minimum fresh window should automatically produce a score");
  assert.equal(minimumFreshWindow.confidence, 100, "complete fresh evidence should report full confidence");
  assert.equal(
    minimumFreshWindow.orderFlowPressure.source,
    "Quote-depth proxy because classified trade sides are unavailable",
    "unclassified trades should use the live quote-depth proxy",
  );
  assert.equal(minimumFreshWindow.diagnostics.scoring_gate_reason, "ready", "a minimum fresh window should report a ready gate");

  const oneFreshObservation = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes: [minimumFreshWindow.momentum.observedAt
      ? {
          timestamp: now,
          bidPrice: 100,
          askPrice: 100.01,
          bidSize: 100,
          askSize: 100,
        }
      : quotes.at(-1)],
    trades: [],
    bars: [],
  });
  assert.equal(oneFreshObservation.score, null, "one fresh price must not produce a composite score");
  assert.equal(oneFreshObservation.confidence, 45, "confidence should reflect the fresh spread and depth evidence already available");
  assert.equal(oneFreshObservation.diagnostics.fresh_prices, 1, "diagnostics should show one fresh price");
  assert.equal(oneFreshObservation.diagnostics.scoring_gate_reason, "waiting_for_two_fresh_prices", "the gate should explain the missing prior price");

  const staleReferenceExcluded = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes: [
      {
        timestamp: new Date(now.getTime() - 120_000),
        bidPrice: 90,
        askPrice: 90.01,
        bidSize: 100,
        askSize: 100,
      },
      {
        timestamp: now,
        bidPrice: 100,
        askPrice: 100.01,
        bidSize: 100,
        askSize: 100,
      },
    ],
    trades: [],
    bars: [],
  });
  assert.equal(staleReferenceExcluded.score, null, "a stale price must not be used as a live momentum reference");
  assert.equal(staleReferenceExcluded.diagnostics.fresh_prices, 1, "only the fresh price should count toward the gate");
  assert.equal(staleReferenceExcluded.diagnostics.scoring_gate_reason, "waiting_for_two_fresh_prices", "the gate should reject stale price history");

  const bearishQuotes = quotes.map((quote, index) => ({
    ...quote,
    bidPrice: 100 - index * 0.05,
    askPrice: 100 - index * 0.05 + 0.03,
    bidSize: 50,
    askSize: 300,
  }));
  const bearishTrades = trades.map((trade) => ({ ...trade, side: "A", size: 100 }));
  const bearish = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes: bearishQuotes,
    trades: bearishTrades,
    bars: [],
  });
  assert.equal(typeof bearish.score, "number", "fresh bearish inputs should remain scoreable");
  assert.ok(bearish.score < active.score, "the score should change when live market inputs change");
  assert.notEqual(bearish.status, "Breakout Setup", "negative pressure should not produce the highest setup label");

  const stale = calculateAlphaRadar({
    now: new Date(now.getTime() + 120_000),
    connectionState: "streaming",
    quotes,
    trades,
    bars: [],
  });
  assert.equal(stale.dataQuality, "stale", "old observations should be clearly marked stale");
  assert.equal(stale.scoreState, "stale", "old observations should make the score explicitly stale");
  assert.equal(stale.status, null, "stale data must not publish any setup classification");
  assert.equal(stale.score, null, "stale data must make the composite score unavailable");
  assert.equal(stale.confidence, 0, "stale data must have no live confidence");
  assert.equal(stale.momentum.score, null, "stale momentum must not retain its old component score");
  assert.equal(stale.spread.score, null, "stale spread must not retain its old component score");
  assert.equal(stale.volumeIntensity.score, null, "stale volume must not retain its old component score");
  assert.equal(stale.orderFlowPressure.score, null, "stale order flow must not retain its old component score");
  assert.equal(stale.momentum.scoreEligible, false, "stale component scores must be excluded");
  assert.notEqual(stale.momentum.value, null, "historical momentum values should remain available for diagnosis");
  assert.equal(stale.unusualActivity.detected, false, "stale activity must not retain a live alert");

  const interrupted = calculateAlphaRadar({
    now,
    connectionState: "stopped",
    quotes,
    trades,
    bars: [],
  });
  assert.equal(interrupted.dataQuality, "degraded", "a stopped feed should be degraded even with recent history");
  assert.equal(interrupted.scoreState, "stale", "interrupted historical observations should be marked stale");
  assert.equal(interrupted.status, null, "a stopped feed must not retain a setup label");
  assert.equal(interrupted.score, null, "a stopped feed must make the score unavailable");
  assert.equal(interrupted.confidence, 0, "a stopped feed must have no live confidence");

  const sparse = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes: [quotes.at(-1)],
    trades: [],
    bars: [],
  });
  assert.equal(sparse.dataQuality, "degraded", "incomplete decision inputs must not be reported as good data");
  assert.equal(sparse.scoreState, "insufficient", "sparse inputs should be explicitly insufficient");
  assert.equal(sparse.status, null, "sparse inputs must not produce a setup status");
  assert.equal(sparse.score, null, "sparse inputs must not produce a composite score");
  assert.equal(sparse.confidence, 45, "sparse fresh inputs should report their available spread and depth confidence");

  const missing = calculateAlphaRadar({
    now,
    connectionState: "connected",
    quotes: [],
    trades: [],
    bars: [],
  });
  assert.equal(missing.dataQuality, "missing", "no observations should be marked missing");
  assert.equal(missing.scoreState, "insufficient", "missing observations should be explicitly insufficient");
  assert.equal(missing.status, null, "missing data must not publish a setup status");
  assert.equal(missing.score, null, "missing data should make the score unavailable");
  assert.equal(missing.confidence, 0, "missing data should have no confidence");

  const recoveryStart = new Date(now.getTime() + 180_000);
  const firstRecoveredObservation = calculateAlphaRadar({
    now: recoveryStart,
    connectionState: "streaming",
    quotes: [{
      timestamp: recoveryStart,
      bidPrice: 101,
      askPrice: 101.01,
      bidSize: 150,
      askSize: 100,
    }],
    trades: [],
    bars: [],
  });
  assert.equal(firstRecoveredObservation.score, null, "the first recovered event must not reuse the stale score");
  assert.equal(firstRecoveredObservation.scoreState, "insufficient", "recovery must rebuild its evidence window");

  const recoveryTimestamps = [
    ...Array.from(
      { length: 9 },
      (_, index) => new Date(recoveryStart.getTime() - (300_000 - index * 30_000)),
    ),
    new Date(recoveryStart.getTime() - 7_000),
    recoveryStart,
  ];
  const recoveredQuotes = recoveryTimestamps.map((timestamp, index) => ({
    timestamp,
    bidPrice: 101 + index * 0.05,
    askPrice: 101 + index * 0.05 + 0.01,
    bidSize: index === recoveryTimestamps.length - 1 ? 300 : 100,
    askSize: 100,
  }));
  const recoveredTrades = recoveryTimestamps.map((timestamp, index) => ({
    timestamp,
    price: 101 + index * 0.05,
    size: index === recoveryTimestamps.length - 1 ? 100 : 10,
    side: index === recoveryTimestamps.length - 1 ? "B" : index % 2 === 0 ? "A" : "B",
  }));
  const recovered = calculateAlphaRadar({
    now: recoveryStart,
    connectionState: "streaming",
    quotes: recoveredQuotes,
    trades: recoveredTrades,
    bars: [],
  });
  assert.equal(recovered.scoreState, "available", "a newly rebuilt fresh window should restore scoring");
  assert.equal(typeof recovered.score, "number", "a newly rebuilt fresh window should produce a score");
  assert.notEqual(recovered.status, null, "a valid rebuilt window should restore a setup classification");

  console.log("Alpha Radar calculation tests passed: multi-factor convergence, single-spike rejection, trajectory retention, stale invalidation, and fresh-window recovery.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}