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
  assert.equal(active.status, "Breakout Setup", "aligned live activity should produce the setup status");
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
  assert.equal(stale.status, "Neutral", "stale data must not retain a setup label");
  assert.equal(stale.score, 50, "stale data must neutralize the published score");
  assert.ok(stale.confidence < active.confidence, "stale data must reduce confidence");

  const interrupted = calculateAlphaRadar({
    now,
    connectionState: "stopped",
    quotes,
    trades,
    bars: [],
  });
  assert.equal(interrupted.dataQuality, "degraded", "a stopped feed should be degraded even with recent history");
  assert.equal(interrupted.status, "Neutral", "a stopped feed must not retain a setup label");
  assert.equal(interrupted.score, 50, "a stopped feed must neutralize the published score");
  assert.equal(interrupted.confidence, 0, "a stopped feed must have no live confidence");

  const sparse = calculateAlphaRadar({
    now,
    connectionState: "streaming",
    quotes: [quotes.at(-1)],
    trades: [],
    bars: [],
  });
  assert.equal(sparse.dataQuality, "degraded", "incomplete decision inputs must not be reported as good data");
  assert.equal(sparse.status, "Neutral", "sparse inputs must not produce a directional status");
  assert.ok(sparse.confidence < active.confidence, "sparse inputs must reduce confidence");

  const missing = calculateAlphaRadar({
    now,
    connectionState: "connected",
    quotes: [],
    trades: [],
    bars: [],
  });
  assert.equal(missing.dataQuality, "missing", "no observations should be marked missing");
  assert.equal(missing.score, 50, "missing data should hold a neutral score");
  assert.equal(missing.confidence, 0, "missing data should have no confidence");

  console.log("Alpha Radar calculation tests passed: active, changed-input, stale, interrupted, sparse, and missing-data cases.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}