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
    source: "databento_live",
    schema: "mbp-1",
    timestamp: timestamp.toISOString(),
    receivedAt: timestamp.toISOString(),
    ingestedAt: new Date().toISOString(),
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
    "artifacts/api-server/src/lib/marketUniverse.ts",
    "marketUniverse.js",
    (source) => source.replace(
      'const currentDir = path.dirname(fileURLToPath(import.meta.url));',
      'const currentDir = ".";',
    ),
  );
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
  writeFileSync(
    join(outputDirectory, "signalValidation.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.signalValidation = { captureSignal() {}, observePrice() {} };',
  );
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  const require = createRequire(import.meta.url);
  const {
    DatabentoLiveService,
    DatabentoUniverseService,
    MONITORED_SYMBOLS,
    scanProfileAt,
    updateAlphaRadarRanking,
  } = require(join(outputDirectory, "databentoLive.js"));
  const {
    MarketUniverseRegistry,
    normalizeLifecycle,
    normalizeReferenceSymbol,
    normalizeSecurityType,
  } = require(join(outputDirectory, "marketUniverse.js"));
  assert.equal(normalizeReferenceSymbol(" nvda "), "NVDA", "reference symbols must be normalized");
  assert.equal(normalizeReferenceSymbol("not a symbol"), null, "invalid reference symbols must be rejected");
  assert.equal(
    normalizeSecurityType("CS", null),
    "common_stock",
    "verified common-stock source types must normalize to common_stock",
  );
  assert.equal(
    normalizeLifecycle("D", null, null).status,
    "delisted",
    "definition delete actions must map to an explicit delisted lifecycle",
  );
  assert.equal(
    normalizeLifecycle(null, "H", null).status,
    "halted",
    "reference listing halts must map to an explicit halted lifecycle",
  );
  const referenceAt = new Date("2026-08-19T12:00:00.000Z");
  const referenceRegistry = new MarketUniverseRegistry();
  referenceRegistry.replace(
    [
      {
        providerSymbol: "ACME",
        instrumentId: "101",
        providerSecurityType: "CS",
        listingStatus: "A",
        listingExchange: "XNAS",
        primaryExchange: "XNAS",
        sector: "Information Technology",
        industryGroup: "Software",
        industry: "Application Software",
        classificationSource: "Deterministic fixture",
        referenceUpdatedAt: referenceAt.toISOString(),
        primaryListing: true,
      },
      {
        providerSymbol: "ACME",
        instrumentId: "101-secondary",
        providerSecurityType: "CS",
        listingStatus: "A",
        listingExchange: "XNYS",
        referenceUpdatedAt: new Date(referenceAt.getTime() + 1_000).toISOString(),
        primaryListing: false,
      },
      {
        providerSymbol: "HALT",
        instrumentId: "102",
        providerSecurityType: "CS",
        listingStatus: "H",
        referenceUpdatedAt: referenceAt.toISOString(),
      },
      {
        providerSymbol: "ETFQ",
        instrumentId: "103",
        providerSecurityType: "ETF",
        listingStatus: "A",
        referenceUpdatedAt: referenceAt.toISOString(),
      },
      {
        providerSymbol: "UNVERIFIED",
        instrumentId: "104",
        instrumentClass: "K",
        securityUpdateAction: "A",
        tradingStatus: "17",
        referenceUpdatedAt: referenceAt.toISOString(),
      },
    ],
    {
      dataset: "Fixture",
      source: "Deterministic reference fixture",
      sourceKind: "security_master",
      sourceTimestamp: referenceAt,
      maxAgeMs: 60_000,
      reason: "Deterministic reference fixture.",
    },
    referenceAt,
  );
  const freshReference = referenceRegistry.getSummary(new Date(referenceAt.getTime() + 10_000));
  assert.equal(freshReference.totalCount, 4, "primary-listing deduplication must retain one record per normalized symbol");
  assert.equal(freshReference.eligibleCount, 1, "only an active verified common stock may be a candidate");
  assert.equal(freshReference.classificationCoverageCount, 1, "complete supplied sector hierarchy must be counted");
  assert.equal(
    referenceRegistry.query({}, new Date(referenceAt.getTime() + 10_000)).items[0]?.symbol,
    "ACME",
    "default discovery must return only currently eligible common-equity candidates",
  );
  assert.equal(
    referenceRegistry.query({ eligibility: "ineligible" }, new Date(referenceAt.getTime() + 10_000)).total,
    3,
    "inactive, non-common, and unverified records must remain inspectable but ineligible",
  );
  const staleReference = referenceRegistry.getSummary(new Date(referenceAt.getTime() + 61_000));
  assert.equal(staleReference.freshness, "stale", "expired reference snapshots must report stale freshness");
  assert.equal(staleReference.eligibleCount, 0, "stale reference data must clear every candidate immediately");
  assert.equal(
    referenceRegistry.query({}, new Date(referenceAt.getTime() + 61_000)).total,
    0,
    "stale reference data must never be returned by default candidate discovery",
  );
  assert.deepEqual(
    staleReference.eligibleSample,
    [],
    "stale reference summaries must not advertise an obsolete candidate sample",
  );
  const definitionsOnlyRegistry = new MarketUniverseRegistry();
  definitionsOnlyRegistry.replace(
    [
      {
        providerSymbol: "DEFINITIONONLY",
        instrumentId: "200",
        providerSecurityType: "CS",
        cfi: "ESVUFR",
        securityUpdateAction: "A",
        tradingStatus: "17",
        referenceUpdatedAt: referenceAt.toISOString(),
      },
    ],
    {
      dataset: "EQUS.MINI",
      source: "Databento EQUS.MINI instrument definitions",
      sourceKind: "definitions",
      sourceTimestamp: referenceAt,
      reason: "Definitions only.",
    },
    referenceAt,
  );
  assert.equal(
    definitionsOnlyRegistry.getSummary(referenceAt).eligibleCount,
    0,
    "definition-only fallback records must remain ineligible even when a CFI resembles common equity",
  );
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
  assert.equal(
    universeStatus.marketUniverse?.deliveryMode,
    "reference_only",
    "the broad reference registry must be visible without creating broad live subscriptions",
  );
  assert.ok(
    universeStatus.symbolRadars.every((radar) => Array.isArray(radar.signalHistory)),
    "every monitored symbol must expose its own bounded signal trajectory",
  );
  assert.deepEqual(
    universeStatus.alphaRanking.entries.map((entry) => entry.symbol),
    [...MONITORED_SYMBOLS],
    "the ranking board must include every monitored symbol even when all live windows are ineligible",
  );
  assert.ok(
    universeStatus.alphaRanking.entries.every(
      (entry) => entry.rank === null && entry.eligibility === "ineligible",
    ),
    "stopped universe symbols must never receive an apparently valid rank",
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
  assert.deepEqual(
    universe.getStatus().symbolRadars.find((radar) => radar.symbol === "MU")?.signalHistory,
    [],
    "events in a separate MU service must not contaminate the universe MU trajectory",
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
  const freshAlphaStatus = freshAlphaService.getStatus();
  const freshAlpha = freshAlphaStatus.alphaRadar;
  assert.equal(freshAlpha.scoreState, "available", "fresh incoming MBP events must establish an Alpha Radar window");
  assert.equal(typeof freshAlpha.score, "number", "a valid fresh service window must publish an Alpha Radar score");
  assert.equal(freshAlpha.confidence, 100, "complete fresh service evidence must report full confidence");
  assert.equal(freshAlpha.diagnostics.scoring_gate_reason, "ready", "the service must expose a ready scoring gate");
  assert.ok(
    ["pending", "rejected"].includes(freshAlpha.preBreakout.confirmation.status),
    "a fresh isolated service window should explain why confirmation is not yet complete",
  );
  assert.ok(
    freshAlphaService.getStatus().signalHistory.length >= 1,
    "the first meaningful detection or confirmation transition should enter signal history",
  );
  assert.ok(freshAlpha.diagnostics.fresh_quotes >= 2, "the service must count fresh quote observations");
  assert.ok(freshAlpha.diagnostics.fresh_trades >= 2, "the service must count fresh trade observations");
  assert.ok(freshAlpha.diagnostics.fresh_prices >= 2, "the service must count fresh price timestamps");
  assert.ok(freshAlpha.diagnostics.fresh_volume >= 2, "the service must count fresh volume observations");
  assert.equal(
    freshAlpha.orderFlowPressure.source,
    "Quote-depth proxy because classified trade sides are unavailable",
    "unclassified live trades must use the fresh quote-depth proxy",
  );

  function rankingSymbol({
    symbol,
    score,
    velocity,
    scanAt,
    trajectory = "strengthening",
    marketFeedState = "streaming",
  }) {
    const strengthening = trajectory === "strengthening";
    const historyEntry = {
      occurredAt: new Date(scanAt.getTime() - 1_000),
      fromState: strengthening ? "watch" : "confirmed",
      toState: strengthening ? "accelerating" : "watch",
      fromConfirmationStatus: strengthening ? "rejected" : "confirmed",
      toConfirmationStatus: strengthening ? "pending" : "rejected",
      score,
      confidence: 100,
      alphaVelocity: velocity,
      evidenceCount: 3,
      satisfiedEvidence: ["Fresh price momentum"],
      missingEvidence: ["Persistent multi-scan trajectory"],
      dataFresh: marketFeedState === "streaming",
      reason: "Deterministic ranking trajectory.",
    };
    return {
      symbol,
      connectionState: marketFeedState === "streaming" ? "streaming" : "error",
      marketFeedState,
      lastUpdatedAt: scanAt,
      alphaRadar: {
        ...freshAlpha,
        score,
        scoreState: marketFeedState === "streaming" ? "available" : "stale",
        dataQuality: marketFeedState === "streaming" ? "good" : "stale",
        confidence: marketFeedState === "streaming" ? 100 : 0,
        scan: { ...freshAlpha.scan, lastScannedAt: scanAt },
        alphaVelocity: {
          ...freshAlpha.alphaVelocity,
          rate30s: marketFeedState === "streaming" ? velocity : null,
        },
        changeIndicators: {
          momentumAcceleration: marketFeedState === "streaming" ? 8 : null,
          volumeAcceleration: marketFeedState === "streaming" ? 7 : null,
          orderFlowShift: marketFeedState === "streaming" ? 6 : null,
          spreadTightening: marketFeedState === "streaming" ? 5 : null,
        },
        preBreakout: {
          ...freshAlpha.preBreakout,
          state: marketFeedState === "streaming" ? "accelerating" : "unavailable",
          dataFresh: marketFeedState === "streaming",
          confirmation: {
            ...freshAlpha.preBreakout.confirmation,
            status: marketFeedState === "streaming" ? "pending" : "unavailable",
          },
        },
      },
      signalHistory: [historyEntry],
      market: freshAlphaStatus.market,
      error: marketFeedState === "streaming" ? null : "Deterministic stale window.",
    };
  }

  const emptyRankingMachine = () => ({
    order: [],
    pendingOrder: null,
    pendingObservationCount: 0,
    lastInputSignature: null,
  });
  const rankingAt = new Date("2026-08-19T14:30:00.000Z");
  const initialRanking = updateAlphaRadarRanking(
    [
      rankingSymbol({ symbol: "NVDA", score: 82, velocity: 8, scanAt: rankingAt }),
      rankingSymbol({ symbol: "MU", score: 70, velocity: 5, scanAt: rankingAt }),
    ],
    emptyRankingMachine(),
    rankingAt,
  );
  assert.equal(initialRanking.snapshot.leaderSymbol, "NVDA", "the stronger fresh combined ranking evidence should lead");
  assert.equal(initialRanking.snapshot.entries[0].rank, 1, "the server ranking must publish the current rank");
  assert.match(
    initialRanking.snapshot.entries[0].reason,
    /Score 82.*Alpha Velocity \+8\/min.*component acceleration \+6\.5\/min.*trajectory/,
    "each ranked symbol must expose a concise evidence-based explanation",
  );
  const initialFactors = initialRanking.snapshot.entries[0].factorContributions;
  assert.ok(initialFactors, "a ranked symbol must expose transparent factor contributions");
  assert.equal(
    Math.round(
      (
        initialFactors.alphaScore
        + initialFactors.alphaVelocity
        + initialFactors.componentAcceleration
        + initialFactors.signalTrajectory
      ) * 10,
    ) / 10,
    initialRanking.snapshot.entries[0].rankingScore,
    "the published ranking index must equal the sum of its transparent factor contributions",
  );

  const oneTickReorderAt = new Date(rankingAt.getTime() + 1_000);
  const oneTickCandidates = [
    rankingSymbol({ symbol: "NVDA", score: 82, velocity: 8, scanAt: oneTickReorderAt }),
    rankingSymbol({ symbol: "MU", score: 96, velocity: 20, scanAt: oneTickReorderAt }),
    rankingSymbol({
      symbol: "AMD",
      score: 50,
      velocity: 0,
      scanAt: oneTickReorderAt,
      marketFeedState: "stale",
    }),
  ];
  const oneTickReorder = updateAlphaRadarRanking(
    oneTickCandidates,
    initialRanking.machine,
    oneTickReorderAt,
  );
  assert.equal(
    oneTickReorder.snapshot.leaderSymbol,
    "NVDA",
    "one isolated scan must not immediately reorder the established ranking",
  );
  assert.equal(oneTickReorder.snapshot.reorderPending, true, "a possible reorder must be exposed as pending");
  assert.equal(oneTickReorder.snapshot.pendingObservationCount, 1, "the first changed scan begins reorder confirmation");

  const repeatedPoll = updateAlphaRadarRanking(
    [
      oneTickCandidates[0],
      oneTickCandidates[1],
      rankingSymbol({
        symbol: "AMD",
        score: 50,
        velocity: 0,
        scanAt: new Date(oneTickReorderAt.getTime() + 500),
        marketFeedState: "stale",
      }),
    ],
    oneTickReorder.machine,
    oneTickReorderAt,
  );
  assert.equal(
    repeatedPoll.snapshot.pendingObservationCount,
    1,
    "repeated reads of the same eligible scans must not count when an unrelated stale peer timestamp changes",
  );
  assert.equal(repeatedPoll.snapshot.leaderSymbol, "NVDA", "polling alone must not advance the pending reorder");

  const confirmedReorderAt = new Date(rankingAt.getTime() + 2_000);
  const confirmedReorder = updateAlphaRadarRanking(
    [
      rankingSymbol({ symbol: "NVDA", score: 82, velocity: 8, scanAt: confirmedReorderAt }),
      rankingSymbol({ symbol: "MU", score: 96, velocity: 20, scanAt: confirmedReorderAt }),
    ],
    repeatedPoll.machine,
    confirmedReorderAt,
  );
  assert.equal(
    confirmedReorder.snapshot.leaderSymbol,
    "MU",
    "two independent agreeing scans should confirm the new ranking order",
  );
  assert.equal(confirmedReorder.snapshot.reorderPending, false, "a confirmed reorder must clear pending state");

  const trajectoryRanking = updateAlphaRadarRanking(
    [
      rankingSymbol({
        symbol: "VRT",
        score: 75,
        velocity: 9,
        scanAt: rankingAt,
        trajectory: "weakening",
      }),
      rankingSymbol({
        symbol: "CRDO",
        score: 75,
        velocity: 9,
        scanAt: rankingAt,
        trajectory: "strengthening",
      }),
    ],
    emptyRankingMachine(),
    rankingAt,
  );
  assert.equal(
    trajectoryRanking.snapshot.leaderSymbol,
    "CRDO",
    "bounded strengthening trajectory should outrank otherwise equal weakening evidence",
  );

  const staleInvalidation = updateAlphaRadarRanking(
    [
      rankingSymbol({
        symbol: "NVDA",
        score: 82,
        velocity: 8,
        scanAt: confirmedReorderAt,
        marketFeedState: "stale",
      }),
      rankingSymbol({ symbol: "MU", score: 70, velocity: 5, scanAt: confirmedReorderAt }),
    ],
    initialRanking.machine,
    confirmedReorderAt,
  );
  const staleNvdaRank = staleInvalidation.snapshot.entries.find((entry) => entry.symbol === "NVDA");
  assert.equal(staleNvdaRank.rank, null, "stale data must lose its rank immediately without hysteresis");
  assert.equal(staleNvdaRank.eligibility, "ineligible", "stale data must be explicitly ineligible");
  assert.equal(staleInvalidation.snapshot.leaderSymbol, "MU", "a fresh peer remains ranked independently");

  const eventTriggeredService = new DatabentoLiveService();
  const eventNow = new Date();
  eventTriggeredService.applyEvent({ type: "ready" });
  eventTriggeredService.applyEvent(marketEvent(new Date(eventNow.getTime() - 6_000), 100, null));
  eventTriggeredService.applyEvent(marketEvent(eventNow, 100.08, null));
  const eventTriggeredAlpha = eventTriggeredService.getStatus().alphaRadar;
  assert.equal(eventTriggeredAlpha.scan.eventTriggered, true, "a material fresh midpoint move must request an event scan");
  assert.equal(eventTriggeredAlpha.scan.triggerReason, "rapid_midpoint_change", "the scan should identify the triggering market change");

  const ingestionAuditService = new DatabentoLiveService();
  const ingestionAuditNow = new Date();
  ingestionAuditService.applyEvent({ type: "ready" });
  assert.equal(
    ingestionAuditService.getStatus().liveIngestion.verifiedMarketEventCount,
    0,
    "bridge readiness must never count as a market event",
  );
  assert.equal(
    ingestionAuditService.getStatus().liveIngestion.acceptanceState,
    "awaiting_live_event",
    "acceptance must remain explicitly ready-but-waiting until a real market record arrives",
  );
  ingestionAuditService.applyEvent({
    ...marketEvent(ingestionAuditNow, 100.25, "B"),
    source: "untrusted",
  });
  assert.equal(
    ingestionAuditService.getStatus().liveIngestion.verifiedMarketEventCount,
    0,
    "events without the Databento live source marker must never enter ingestion diagnostics",
  );
  ingestionAuditService.applyEvent(marketEvent(ingestionAuditNow, 100.25, "B"));
  const ingestionAudit = ingestionAuditService.getStatus().liveIngestion;
  assert.equal(ingestionAudit.verifiedMarketEventCount, 1, "a real Mbp record must be counted once");
  assert.equal(ingestionAudit.currentWindowMarketEventCount, 1, "a fresh Mbp record must enter the current scoring window");
  assert.equal(ingestionAudit.enteredScoringWindow, true, "accepted market evidence must report scoring-window entry");
  assert.equal(
    ingestionAudit.acceptanceState,
    "insufficient_sample",
    "a fresh first record must report Insufficient Sample instead of claiming scoring eligibility",
  );
  assert.equal(ingestionAudit.conditions.realMarketEventReceived, true, "the readiness audit must identify the real record");
  assert.equal(ingestionAudit.conditions.enteredScoringWindow, true, "the readiness audit must identify window entry");
  assert.equal(ingestionAudit.conditions.scoringEligible, false, "the readiness audit must not invent a score from one event");
  assert.ok(ingestionAudit.windowStartedAt, "the readiness audit must retain the scoring-window start time");
  assert.ok(ingestionAudit.lastWindowEntryAt, "the readiness audit must retain the window-entry time");
  assert.equal(ingestionAudit.triggerEvidence.sourceEventType, "trade", "trigger evidence must retain the real source type");
  assert.equal(
    ingestionAudit.triggerEvidence.sourceEventAt?.getTime(),
    ingestionAuditNow.getTime(),
    "trigger evidence must retain the real source timestamp",
  );
  assert.equal(ingestionAudit.scoringStatus.scoreState, "insufficient", "the audit must expose the existing score state unchanged");
  assert.equal(
    ingestionAudit.scoringStatus.score,
    null,
    "the audit must not publish a score while the existing scoring gate is insufficient",
  );
  assert.equal(ingestionAudit.recentMarketEvents[0].schema, "mbp-1", "the real record schema must be retained");
  assert.equal(ingestionAudit.recentMarketEvents[0].eventType, "trade", "the nested real trade must retain its event type");
  assert.equal(ingestionAudit.recentMarketEvents[0].enteredScoringWindow, true, "accepted event audit rows must identify scoring-window entry");
  ingestionAuditService.applyEvent(marketEvent(new Date(ingestionAuditNow.getTime() - 30_000), 99.9, "A"));
  const staleIngestionAudit = ingestionAuditService.getStatus().liveIngestion;
  assert.equal(staleIngestionAudit.verifiedMarketEventCount, 2, "a delayed real record remains visible for audit");
  assert.equal(
    staleIngestionAudit.currentWindowMarketEventCount,
    1,
    "a delayed real record must not enter the active scoring window",
  );
  assert.equal(
    staleIngestionAudit.recentMarketEvents[0].enteredScoringWindow,
    false,
    "a delayed real record must disclose that it was excluded from scoring",
  );
  assert.equal(
    staleIngestionAudit.conditions.realMarketEventReceived,
    true,
    "a delayed real record may remain in the audit but must not erase prior verified evidence",
  );

  freshAlphaService.status.lastUpdatedAt = new Date(Date.now() - 16_000);
  const staleAlpha = freshAlphaService.getStatus().alphaRadar;
  assert.equal(staleAlpha.score, null, "a stale market feed must immediately clear the effective Alpha score");
  assert.equal(staleAlpha.alphaVelocity.rate30s, null, "stale data must not publish Alpha Velocity");
  assert.equal(staleAlpha.preBreakoutWatch, false, "stale data must not publish a pre-breakout advisory");
  assert.equal(
    staleAlpha.preBreakout.confirmation.status,
    "unavailable",
    "stale market data must immediately invalidate multi-factor confirmation",
  );
  assert.equal(
    freshAlphaService.getStatus().signalHistory.at(-1)?.toConfirmationStatus,
    "unavailable",
    "stale invalidation should create one meaningful confirmation trajectory entry",
  );

  const resetHistoryService = new DatabentoLiveService("AMD");
  const resetNow = new Date();
  resetHistoryService.applyEvent({ type: "ready" });
  resetHistoryService.applyEvent(marketEvent(new Date(resetNow.getTime() - 8_000), 100, "A"));
  resetHistoryService.applyEvent(marketEvent(new Date(resetNow.getTime() - 4_000), 100.1, "B"));
  resetHistoryService.applyEvent(marketEvent(resetNow, 100.2, "B"));
  assert.ok(resetHistoryService.getStatus().signalHistory.length >= 1, "a live AMD trajectory should be isolated and recorded");
  const stoppedReset = resetHistoryService.stop();
  assert.ok(stoppedReset.signalHistory.length <= 1, "stopping must clear the old trajectory window");
  assert.equal(
    stoppedReset.signalHistory.at(-1)?.toConfirmationStatus,
    "unavailable",
    "stop/reset should retain only an explicit unavailable anchor when a live state existed",
  );
  assert.equal(
    stoppedReset.alphaRadar.preBreakout.confirmation.persistenceScans,
    0,
    "stop/reset must clear confirmation persistence",
  );

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
    source: "databento_live",
    schema: "ohlcv-1s",
    timestamp: quietMixedNow.toISOString(),
    receivedAt: quietMixedNow.toISOString(),
    ingestedAt: new Date().toISOString(),
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

  console.log("Databento live service tests passed: per-symbol confirmation history, stale invalidation, stop/reset isolation, adaptive scans, and recovery-window reset.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}