import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "databento-live-test-"));

function transpile(sourcePath, outputName, transform = (source) => source) {
  const source = transform(readFileSync(resolve(sourcePath), "utf8"));
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(join(outputDirectory, outputName), output);
}

function marketEvent(timestamp, price, side = "B") {
  return {
    type: "mbp",
    timestamp: timestamp.toISOString(),
    bidPrice: price - 0.01,
    askPrice: price + 0.01,
    bidSize: 200,
    askSize: 100,
    trade: {
      price,
      size: 100,
      timestamp: timestamp.toISOString(),
      side,
    },
  };
}

function seedIncompleteFreshWindow(service, now) {
  service.applyEvent({ type: "ready" });
  service.applyEvent(marketEvent(new Date(now.getTime() - 7_000), 100, "A"));
  service.applyEvent(marketEvent(new Date(now.getTime() - 3_000), 100.2, "B"));
  service.applyEvent(marketEvent(now, 100.5, "B"));
}

function seedCompleteLegacyWindow(service, now) {
  service.applyEvent({ type: "ready" });
  service.analysisWindowStartedAt = new Date(now.getTime() - 190_000);
  service.recordTrade({
    timestamp: new Date(now.getTime() - 190_000),
    price: 99.5,
    size: 100,
    side: "A",
  });
  service.recordTrade({
    timestamp: new Date(now.getTime() - 70_000),
    price: 99.8,
    size: 100,
    side: "B",
  });
  service.applyEvent(marketEvent(new Date(now.getTime() - 7_000), 100, "A"));
  service.applyEvent(marketEvent(new Date(now.getTime() - 3_000), 100.2, "B"));
  service.applyEvent(marketEvent(now, 100.5, "B"));
}

try {
  transpile("artifacts/api-server/src/lib/alphaRadar.ts", "alphaRadar.js");
  transpile("artifacts/api-server/src/lib/marketFeed.ts", "marketFeed.js");
  transpile(
    "artifacts/api-server/src/lib/databentoLive.ts",
    "databentoLive.js",
    (source) => source.replace(
      'const currentDir = path.dirname(fileURLToPath(import.meta.url));',
      'const currentDir = ".";',
    ),
  );
  writeFileSync(
    join(outputDirectory, "logger.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.logger = { info() {}, warn() {}, error() {} };',
  );
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  const require = createRequire(import.meta.url);
  const {
    DatabentoLiveService,
    DatabentoUniverseService,
    MONITORED_SYMBOLS,
    scanProfileAt,
  } = require(join(outputDirectory, "databentoLive.js"));
  assert.deepEqual(
    scanProfileAt(new Date("2026-08-17T13:27:00.000Z")),
    { scanMode: "pre_open", scanIntervalMs: 3_000 },
    "the five minutes before a weekday U.S. open should use the faster pre-open cadence",
  );
  assert.deepEqual(
    scanProfileAt(new Date("2026-08-17T13:31:00.000Z")),
    { scanMode: "opening", scanIntervalMs: 1_000 },
    "the first thirty minutes after open should use the high-frequency opening cadence",
  );
  assert.deepEqual(
    scanProfileAt(new Date("2026-08-17T14:05:00.000Z")),
    { scanMode: "normal", scanIntervalMs: 5_000 },
    "normal session time should retain the bounded five-second cadence",
  );
  const universe = new DatabentoUniverseService();
  const universeStatus = universe.getStatus();
  assert.deepEqual(
    universeStatus.symbolRadars.map((radar) => radar.symbol),
    [...MONITORED_SYMBOLS],
    "the scan universe must expose independent NVDA, MU, VRT, CRDO, and AMD radar windows",
  );
  const muService = new DatabentoLiveService("MU");
  muService.applyEvent({ type: "ready" });
  muService.applyEvent(marketEvent(new Date(), 100, "B"));
  assert.equal(muService.getStatus().symbol, "MU", "a symbol-specific service must retain its own configured symbol");
  assert.equal(
    universe.getStatus().symbolRadars.find((radar) => radar.symbol === "MU")?.lastUpdatedAt,
    null,
    "events in an isolated symbol service must not contaminate the universe MU window",
  );
  const now = new Date();
  const incompleteService = new DatabentoLiveService();
  seedIncompleteFreshWindow(incompleteService, now);
  const incomplete = incompleteService.getStatus();
  assert.equal(incomplete.radar.score, null, "fresh but incomplete evidence must not produce a composite score");
  assert.equal(incomplete.radar.status, "insufficient", "fresh but incomplete evidence must be explicitly insufficient");
  assert.equal(incomplete.radar.momentum.score, null, "incomplete evidence must not publish momentum");
  assert.equal(incomplete.radar.pressure.score, null, "incomplete evidence must not publish order flow");
  assert.equal(incomplete.radar.spread.score, null, "incomplete evidence must not publish spread");
  assert.equal(incomplete.radar.volumeIntensity.score, null, "incomplete evidence must not publish volume");
  assert.deepEqual(incomplete.radar.activityFlags, [], "incomplete evidence must not publish activity alerts");

  const freshAlphaService = new DatabentoLiveService();
  const freshAlphaNow = new Date();
  freshAlphaService.applyEvent({ type: "ready" });
  freshAlphaService.applyEvent(marketEvent(new Date(freshAlphaNow.getTime() - 8_000), 100, null));
  freshAlphaService.applyEvent(marketEvent(new Date(freshAlphaNow.getTime() - 4_000), 100.1, null));
  freshAlphaService.applyEvent(marketEvent(freshAlphaNow, 100.2, null));
  const freshAlpha = freshAlphaService.getStatus().alphaRadar;
  assert.equal(freshAlpha.scoreState, "available", "fresh incoming MBP events must establish an Alpha Radar window");
  assert.equal(typeof freshAlpha.score, "number", "a valid fresh service window must publish an Alpha Radar score");
  assert.equal(freshAlpha.confidence, 100, "complete fresh service evidence must report full confidence");
  assert.equal(freshAlpha.diagnostics.scoring_gate_reason, "ready", "the service must expose a ready scoring gate");
  assert.ok(freshAlpha.diagnostics.fresh_quotes >= 2, "the service must count fresh quote observations");
  assert.ok(freshAlpha.diagnostics.fresh_trades >= 2, "the service must count fresh trade observations");
  assert.ok(freshAlpha.diagnostics.fresh_prices >= 2, "the service must count fresh price timestamps");
  assert.ok(freshAlpha.diagnostics.fresh_volume >= 2, "the service must count fresh volume observations");
  assert.equal(
    freshAlpha.orderFlowPressure.source,
    "Quote-depth proxy because classified trade sides are unavailable",
    "unclassified live trades must use the fresh quote-depth proxy",
  );

  const eventTriggeredService = new DatabentoLiveService();
  const eventNow = new Date();
  eventTriggeredService.applyEvent({ type: "ready" });
  eventTriggeredService.applyEvent(marketEvent(new Date(eventNow.getTime() - 6_000), 100, null));
  eventTriggeredService.applyEvent(marketEvent(eventNow, 100.08, null));
  const eventTriggeredAlpha = eventTriggeredService.getStatus().alphaRadar;
  assert.equal(eventTriggeredAlpha.scan.eventTriggered, true, "a material fresh midpoint move must request an event scan");
  assert.equal(eventTriggeredAlpha.scan.triggerReason, "rapid_midpoint_change", "the scan should identify the triggering market change");

  freshAlphaService.status.lastUpdatedAt = new Date(Date.now() - 16_000);
  const staleAlpha = freshAlphaService.getStatus().alphaRadar;
  assert.equal(staleAlpha.score, null, "a stale market feed must immediately clear the effective Alpha score");
  assert.equal(staleAlpha.alphaVelocity.rate30s, null, "stale data must not publish Alpha Velocity");
  assert.equal(staleAlpha.preBreakoutWatch, false, "stale data must not publish a pre-breakout advisory");

  const quietMixedService = new DatabentoLiveService();
  const quietMixedNow = new Date();
  const quietTimestamp = new Date(quietMixedNow.getTime() - 70_000);
  quietMixedService.applyEvent({ type: "ready" });
  quietMixedService.analysisWindowStartedAt = quietTimestamp;
  quietMixedService.status.connectionState = "streaming";
  quietMixedService.status.lastUpdatedAt = quietMixedNow;
  quietMixedService.recordQuote({
    timestamp: quietTimestamp,
    bidPrice: 99.99,
    askPrice: 100.01,
    bidSize: 100,
    askSize: 100,
  });
  quietMixedService.recordTrade({
    timestamp: quietTimestamp,
    price: 100,
    size: 100,
    side: "B",
  });
  quietMixedService.applyEvent({
    type: "ohlcv",
    timestamp: quietMixedNow.toISOString(),
    close: 100,
    volume: 100,
  });
  const quietMixed = quietMixedService.getStatus();
  assert.equal(quietMixed.marketFeedState, "streaming", "the fresh bar should keep the market feed current");
  assert.equal(quietMixed.radar.score, null, "quiet quote/trade evidence must not produce a score");
  assert.equal(quietMixed.radar.status, "insufficient", "quiet and incomplete quote/trade evidence must be unavailable");
  assert.deepEqual(quietMixed.radar.activityFlags, [], "an ineligible mixed-freshness window must not publish a quiet flag");

  const service = new DatabentoLiveService();

  seedCompleteLegacyWindow(service, now);
  const live = service.getStatus();
  assert.equal(typeof live.radar.score, "number", "fresh live service observations should produce the legacy radar score");
  assert.ok(
    live.radar.status === "watch" || live.radar.status === "breakout_setup",
    "fresh live service observations may produce a setup classification",
  );

  service.fail("deterministic interruption");
  const interrupted = service.getStatus();
  assert.equal(interrupted.radar.score, null, "an interrupted feed must clear the secondary composite score");
  assert.equal(interrupted.radar.status, "data_stale", "interrupted historical data must be explicitly stale");
  assert.equal(interrupted.radar.momentum.score, null, "interrupted momentum must not publish a score");
  assert.equal(interrupted.radar.pressure.score, null, "interrupted order flow must not publish a score");
  assert.deepEqual(interrupted.radar.activityFlags, [], "interrupted data must not publish activity alerts");

  service.applyEvent({ type: "ready" });
  const shortReconnect = service.getStatus();
  assert.equal(
    shortReconnect.marketFeedState,
    "stale",
    "a short reconnect must remain stale until a post-recovery market event arrives",
  );
  service.applyEvent(marketEvent(new Date(), 101, "B"));
  const shortRecovery = service.getStatus();
  assert.equal(service.quotes.length, 1, "a short reconnect must reset the old quote window");
  assert.equal(service.trades.length, 1, "a short reconnect must reset the old trade window");
  assert.equal(service.tradeBuckets.size, 1, "a short reconnect must reset old trade buckets");
  assert.equal(shortRecovery.radar.score, null, "a short reconnect must not reuse the previous score");
  assert.equal(shortRecovery.radar.status, "insufficient", "a short reconnect must rebuild before scoring");

  const heartbeatService = new DatabentoLiveService();
  seedCompleteLegacyWindow(heartbeatService, new Date());
  heartbeatService.status.connectionState = "streaming";
  heartbeatService.status.lastUpdatedAt = new Date(Date.now() - 16_000);
  const heartbeatOnly = heartbeatService.getStatus();
  assert.equal(heartbeatOnly.marketFeedState, "stale", "heartbeat-compatible transport cannot hide stale market data");
  assert.equal(heartbeatOnly.radar.score, null, "heartbeat-only freshness must not restore a score");
  assert.equal(heartbeatOnly.radar.status, "data_stale", "heartbeat-only freshness must retain the stale state");

  const delayedRecoveryService = new DatabentoLiveService();
  const delayedRecoveryNow = new Date();
  seedCompleteLegacyWindow(delayedRecoveryService, delayedRecoveryNow);
  delayedRecoveryService.fail("deterministic short interruption");
  delayedRecoveryService.applyEvent({ type: "ready" });
  const retainedTradeCount = delayedRecoveryService.trades.length;
  delayedRecoveryService.applyEvent(
    marketEvent(new Date(delayedRecoveryNow.getTime() - 30_000), 99, "A"),
  );
  assert.equal(
    delayedRecoveryService.trades.length,
    retainedTradeCount,
    "a delayed recovery event must not enter or reset the retained diagnostic window",
  );
  assert.equal(
    delayedRecoveryService.getStatus().marketFeedState,
    "stale",
    "a delayed recovery event must not make the market feed current",
  );
  delayedRecoveryService.applyEvent(marketEvent(new Date(), 101, "B"));
  const recovering = delayedRecoveryService.getStatus();
  assert.equal(delayedRecoveryService.quotes.length, 1, "the fresh recovery event must start a new quote analysis window");
  assert.equal(delayedRecoveryService.trades.length, 1, "the fresh recovery event must start a new trade analysis window");
  assert.equal(delayedRecoveryService.tradeBuckets.size, 1, "the fresh recovery event must discard stale trade buckets");
  assert.equal(recovering.radar.score, null, "the first recovery event must not reuse the stale score");
  assert.equal(recovering.radar.status, "insufficient", "the rebuilt service window must collect before scoring");
  assert.equal(recovering.alphaRadar.score, null, "the first recovery event must not restore the Alpha Radar score");
  assert.equal(recovering.alphaRadar.scoreState, "insufficient", "Alpha Radar must rebuild its valid data window");

  const staleNestedTradeService = new DatabentoLiveService();
  const nestedTradeNow = new Date();
  seedCompleteLegacyWindow(staleNestedTradeService, nestedTradeNow);
  staleNestedTradeService.fail("deterministic nested-trade interruption");
  staleNestedTradeService.applyEvent({ type: "ready" });
  const mixedTimestampEvent = marketEvent(new Date(), 102, "B");
  mixedTimestampEvent.trade.timestamp = new Date(Date.now() - 30_000).toISOString();
  staleNestedTradeService.applyEvent(mixedTimestampEvent);
  const staleNestedTrade = staleNestedTradeService.getStatus();
  assert.equal(staleNestedTradeService.quotes.length, 1, "the fresh quote should start the rebuilt window");
  assert.equal(staleNestedTradeService.trades.length, 0, "a stale nested trade must not enter the rebuilt window");
  assert.equal(staleNestedTradeService.tradeBuckets.size, 0, "a stale nested trade must not create a trade bucket");
  assert.equal(staleNestedTrade.radar.score, null, "a stale nested trade must not restore the secondary score");
  assert.equal(staleNestedTrade.alphaRadar.score, null, "a stale nested trade must not restore Alpha Radar");

  console.log("Databento live service tests passed: multi-symbol isolation, adaptive scans, interruption gating, heartbeat-only stale state, and recovery-window reset.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}