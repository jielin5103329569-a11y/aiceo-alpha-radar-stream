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
    calculateAlphaRadar,
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

  const validHistory = [
    {
      generatedAt: new Date(now.getTime() - 65_000),
      score: (active.score ?? 70) - 10,
      momentumScore: (active.momentum.score ?? 60) - 8,
      volumeScore: (active.volumeIntensity.score ?? 60) - 6,
      orderFlowScore: (active.orderFlowPressure.score ?? 60) - 5,
    },
    {
      generatedAt: new Date(now.getTime() - 31_000),
      score: (active.score ?? 70) - 6,
      momentumScore: (active.momentum.score ?? 60) - 5,
      volumeScore: (active.volumeIntensity.score ?? 60) - 4,
      orderFlowScore: (active.orderFlowPressure.score ?? 60) - 3,
    },
    {
      generatedAt: new Date(now.getTime() - 5_000),
      score: (active.score ?? 70) - 2,
      momentumScore: (active.momentum.score ?? 60) - 2,
      volumeScore: (active.volumeIntensity.score ?? 60) - 2,
      orderFlowScore: (active.orderFlowPressure.score ?? 60) - 2,
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
  };
  let detected = updatePreBreakoutDetection(stronglyImproving, machine, now);
  machine = detected.machine;
  assert.equal(detected.snapshot.preBreakout.state, "watch", "the first valid scan establishes WATCH without skipping levels");
  for (const expectedState of ["accelerating", "pre_breakout", "confirmed"]) {
    detected = updatePreBreakoutDetection(
      stronglyImproving,
      machine,
      new Date(now.getTime() + (expectedState === "accelerating" ? 2 : expectedState === "pre_breakout" ? 4 : 6) * 1_000),
    );
    machine = detected.machine;
    detected = updatePreBreakoutDetection(
      stronglyImproving,
      machine,
      new Date(now.getTime() + (expectedState === "accelerating" ? 3 : expectedState === "pre_breakout" ? 5 : 7) * 1_000),
    );
    machine = detected.machine;
    assert.equal(detected.snapshot.preBreakout.state, expectedState, `two confirming scans should promote ${expectedState}`);
  }
  assert.equal(detected.snapshot.preBreakout.evidenceCount, 4, "confirmed detection must count only direct independent evidence");
  assert.equal(detected.snapshot.preBreakoutWatch, true, "pre-breakout and confirmed states retain the advisory flag");

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
      "pre_breakout",
      "two direct components plus derived Alpha Velocity must not reach pre-breakout",
    );
    assert.notEqual(
      result.snapshot.preBreakout.state,
      "confirmed",
      "two direct components plus derived Alpha Velocity must not reach confirmed",
    );
  }

  const unavailableDetection = updatePreBreakoutDetection(
    { ...detected.snapshot, scoreState: "stale", score: null, dataQuality: "stale" },
    machine,
    new Date(now.getTime() + 8_000),
  );
  assert.equal(unavailableDetection.snapshot.preBreakout.state, "unavailable", "stale data must revoke the real-time detection state");
  assert.equal(unavailableDetection.snapshot.preBreakoutWatch, false, "stale data must not retain the advisory flag");

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

  console.log("Alpha Radar calculation tests passed: fresh score, stale invalidation, missing data, interrupted feed, sparse inputs, and fresh-window recovery.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}