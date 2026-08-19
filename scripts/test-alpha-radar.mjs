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
  const { calculateAlphaRadar } = require(outputPath);
  const now = new Date("2026-08-19T14:30:00.000Z");

  const timestamps = Array.from({ length: 11 }, (_, index) => new Date(now.getTime() - (10 - index) * 30_000));
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
  assert.equal(active.status, "Breakout Setup", "aligned live activity should produce the setup status");
  assert.equal(typeof active.score, "number", "fresh complete inputs should produce a numeric score");
  assert.ok(active.score >= 72, "aligned activity should create a high transparent score");
  assert.ok(active.confidence >= 90, "complete fresh components should be high confidence");
  assert.equal(active.unusualActivity.detected, true, "volume burst should be detected");
  assert.ok((active.orderFlowPressure.value ?? 0) > 0, "buy-heavy live trades should show positive pressure");

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
  assert.equal(bearish.status, "Neutral", "negative pressure should not produce a bullish setup label");

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
  assert.equal(sparse.confidence, 0, "sparse inputs must have no scoring confidence");

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

  const recoveryTimestamps = Array.from(
    { length: 11 },
    (_, index) => new Date(recoveryStart.getTime() - (10 - index) * 30_000),
  );
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