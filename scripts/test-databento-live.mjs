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
  transpile("artifacts/api-server/src/lib/dataGovernance.ts", "dataGovernance.js");
  transpile("artifacts/api-server/src/lib/marketFeed.ts", "marketFeed.js");
  transpile(
    "artifacts/api-server/src/lib/marketUniverse.ts",
    "marketUniverse.js",
    (source) => source
      .replace(
        'const currentDir = path.dirname(fileURLToPath(import.meta.url));',
        'const currentDir = ".";',
      )
      .replace('from "node:child_process"', 'from "./child-process"'),
  );
  transpile("artifacts/api-server/src/lib/catalystRadar.ts", "catalystRadar.js");
  transpile("artifacts/api-server/src/lib/sectorPriority.ts", "sectorPriority.js");
  transpile("artifacts/api-server/src/lib/openingReadiness.ts", "openingReadiness.js");
  transpile("artifacts/api-server/src/lib/alertMonitor.ts", "alertMonitor.js");
  writeFileSync(
    join(outputDirectory, "aiIndustryTaxonomy.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.AI_INDUSTRY_TAXONOMY = [{ symbol: "AMAT", categories: ["semiconductor_equipment"] }, { symbol: "NVDA", categories: ["ai_chips"] }];',
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
    join(outputDirectory, "child-process.js"),
    `"use strict";
      const { EventEmitter } = require("node:events");
      const children = [];
      function spawn() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        children.push(child);
        return child;
      }
      exports.spawn = spawn;
      exports._children = children;`,
  );
  writeFileSync(
    join(outputDirectory, "signalValidation.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.signalValidation = { captureSignal() {}, observePrice() {} };',
  );
  writeFileSync(
    join(outputDirectory, "shadowLearningCore.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.SHADOW_MODEL_VERSION = "test"; exports.SHADOW_SCAN_PROFILE = "test"; exports.SHADOW_SCAN_WINDOW = "test"; exports.SHADOW_STRATEGY_VERSION = "test"; exports.shadowCohortKey = () => "test-cohort"; exports.evaluateShadowPreBreakout = () => null;',
  );
  writeFileSync(
    join(outputDirectory, "shadowLearning.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.shadowLearning = { captureObservation() {}, observePrice() {} };',
  );
  writeFileSync(
    join(outputDirectory, "aiIndustryStockPool.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.aiIndustryStockPool = { lastCandidates: null, considerPrequalifiedLiveCandidates(candidates) { this.lastCandidates = candidates; } };',
  );
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  const require = createRequire(import.meta.url);
  const {
    DatabentoLiveService,
    DatabentoUniverseService,
    AiIndustryLeaderProbeCoordinator,
    FocusedScanCoordinator,
    MONITORED_SYMBOLS,
    createSignedMarketLeaderEnvelope,
    scanProfileAt,
    updateAlphaRadarRanking,
  } = require(join(outputDirectory, "databentoLive.js"));
  const {
    MarketUniverseRegistry,
    MarketUniverseService,
    marketUniverse,
    normalizeLifecycle,
    normalizeReferenceSymbol,
    normalizeSecurityType,
  } = require(join(outputDirectory, "marketUniverse.js"));
  const { AlertMonitor, observeRadarStatus } = require(join(outputDirectory, "alertMonitor.js"));
  const { aiIndustryStockPool: poolSidecar } = require(join(outputDirectory, "aiIndustryStockPool.js"));
  const childProcess = require(join(outputDirectory, "child-process.js"));
  const previousDatabentoKey = process.env.DATABENTO_API_KEY;
  delete process.env.DATABENTO_API_KEY;
  const universeLifeline = new MarketUniverseService();
  assert.equal(
    universeLifeline.getLifelineHealth().state,
    "blocked",
    "an unstarted reference service must be independently blocked without affecting protected market data",
  );
  universeLifeline.start();
  await Promise.resolve();
  await Promise.resolve();
  const unavailableUniverse = universeLifeline.getLifelineHealth();
  assert.equal(unavailableUniverse.serviceRunning, true);
  assert.equal(unavailableUniverse.state, "degraded", "missing reference credentials must degrade reference discovery only");
  assert.equal(unavailableUniverse.freshness, "missing");
  universeLifeline.stop();
  assert.equal(universeLifeline.getLifelineHealth().state, "blocked", "stop must make reference service state explicit and fail-closed");
  if (previousDatabentoKey === undefined) delete process.env.DATABENTO_API_KEY;
  else process.env.DATABENTO_API_KEY = previousDatabentoKey;

  // A stopped in-flight reference bridge must retire before a replacement
  // generation starts. The old bridge can never fill the new service window.
  const keyBeforeRestartRehearsal = process.env.DATABENTO_API_KEY;
  process.env.DATABENTO_API_KEY = "test-only-reference-key";
  const restartableUniverse = new MarketUniverseService();
  const childCountBefore = childProcess._children.length;
  restartableUniverse.start();
  assert.equal(childProcess._children.length, childCountBefore + 1, "initial reference refresh must use the isolated child stub");
  const oldReferenceChild = childProcess._children.at(-1);
  restartableUniverse.stop();
  restartableUniverse.start();
  assert.equal(
    childProcess._children.length,
    childCountBefore + 1,
    "replacement must wait for the retiring refresh instead of creating an overlapping bridge",
  );
  oldReferenceChild.emit("close", 0);
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  assert.equal(childProcess._children.length, childCountBefore + 2, "replacement generation must begin a new refresh after retirement");
  const replacementReferenceChild = childProcess._children.at(-1);
  const replacementUniverseHealth = restartableUniverse.getLifelineHealth();
  assert.equal(replacementUniverseHealth.serviceRunning, true);
  assert.equal(replacementUniverseHealth.freshness, "missing", "old reference evidence must not become fresh after restart");
  restartableUniverse.stop();
  replacementReferenceChild.emit("close", 0);
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
  if (keyBeforeRestartRehearsal === undefined) delete process.env.DATABENTO_API_KEY;
  else process.env.DATABENTO_API_KEY = keyBeforeRestartRehearsal;
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
        classificationAuthorized: true,
        classificationUpdatedAt: referenceAt.toISOString(),
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
      authorizationState: "verified",
      authorizationReason: "Security Master fixture response verified.",
    },
    referenceAt,
  );
  const freshReference = referenceRegistry.getSummary(new Date(referenceAt.getTime() + 10_000));
  assert.equal(freshReference.totalCount, 4, "primary-listing deduplication must retain one record per normalized symbol");
  assert.equal(freshReference.eligibleCount, 1, "only an active verified common stock may be a candidate");
  assert.equal(freshReference.classificationCoverageCount, 1, "complete supplied sector hierarchy must be counted");
  assert.equal(freshReference.classificationQuality, "good", "good quality requires complete authorized classifications");
  assert.equal(freshReference.classificationSource, "Deterministic fixture");
  assert.equal(
    freshReference.authorization.state,
    "verified",
    "only a verified Security Master response may report trusted reference authorization",
  );
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
  assert.equal(staleReference.classificationQuality, "unavailable");

  const staleClassificationRegistry = new MarketUniverseRegistry();
  staleClassificationRegistry.replace(
    [{
      providerSymbol: "OLDC",
      providerSecurityType: "CS",
      listingStatus: "A",
      sector: "Information Technology",
      industryGroup: "Software",
      industry: "Application Software",
      classificationSource: "Authorized fixture",
      classificationAuthorized: true,
      classificationUpdatedAt: new Date(referenceAt.getTime() - 61_000).toISOString(),
      referenceUpdatedAt: referenceAt.toISOString(),
    }],
    {
      dataset: "Fixture",
      source: "Fresh reference fixture with old classification",
      sourceKind: "security_master",
      sourceTimestamp: referenceAt,
      maxAgeMs: 60_000,
      reason: "Fixture.",
    },
    referenceAt,
  );
  const staleClassificationSummary = staleClassificationRegistry.getSummary(
    new Date(referenceAt.getTime() + 10_000),
  );
  assert.equal(staleClassificationSummary.freshness, "fresh");
  assert.equal(staleClassificationSummary.classificationCoverageCount, 0);
  assert.equal(staleClassificationSummary.classificationQuality, "degraded");
  assert.equal(
    staleClassificationRegistry.query({}, new Date(referenceAt.getTime() + 10_000)).items[0]?.classificationAvailability,
    "stale",
    "an old taxonomy timestamp must remain unavailable even while the reference snapshot is fresh",
  );

  const unauthorizedClassificationRegistry = new MarketUniverseRegistry();
  unauthorizedClassificationRegistry.replace(
    [{
      providerSymbol: "UNTRUSTED",
      providerSecurityType: "CS",
      listingStatus: "A",
      sector: "Information Technology",
      industryGroup: "Software",
      industry: "Application Software",
      classificationSource: "Unlicensed fixture",
      classificationAuthorized: false,
      referenceUpdatedAt: referenceAt.toISOString(),
    }],
    {
      dataset: "Fixture",
      source: "Security Master fixture with unauthorized taxonomy",
      sourceKind: "security_master",
      sourceTimestamp: referenceAt,
      maxAgeMs: 60_000,
      reason: "Fixture.",
    },
    referenceAt,
  );
  const unauthorizedSummary = unauthorizedClassificationRegistry.getSummary(referenceAt);
  assert.equal(unauthorizedSummary.classificationCoverageCount, 0);
  assert.equal(unauthorizedSummary.classificationQuality, "degraded");
  assert.equal(
    unauthorizedClassificationRegistry.query({}, referenceAt).items[0]?.classificationAvailability,
    "unauthorized",
    "taxonomy fields without authorized provenance must remain explicitly unavailable",
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
        sector: "Information Technology",
        industryGroup: "Software",
        industry: "Application Software",
        classificationSource: "Definition guess",
        classificationAuthorized: true,
        referenceUpdatedAt: referenceAt.toISOString(),
      },
    ],
    {
      dataset: "EQUS.MINI",
      source: "Databento EQUS.MINI instrument definitions",
      sourceKind: "definitions",
      sourceTimestamp: referenceAt,
      reason: "Definitions only.",
      authorizationState: "blocked",
      authorizationReason: "Databento Security Master entitlement is not active for this key.",
    },
    referenceAt,
  );
  assert.equal(
    definitionsOnlyRegistry.getSummary(referenceAt).eligibleCount,
    0,
    "definition-only fallback records must remain ineligible even when a CFI resembles common equity",
  );
  assert.equal(
    definitionsOnlyRegistry.getSummary(referenceAt).authorization.state,
    "blocked",
    "an entitlement-blocked Security Master fallback must remain explicitly external and non-promoting",
  );
  assert.equal(
    definitionsOnlyRegistry.query({ eligibility: "all" }, referenceAt).items[0]?.classificationAvailability,
    "unauthorized",
    "definition-only metadata must never be treated as authorized classification",
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
  assert.equal(
    Number.isSafeInteger(universeStatus.statusRevision),
    true,
    "the global status snapshot must expose a server-issued revision",
  );
  assert.equal(
    typeof universeStatus.statusEpoch,
    "string",
    "the global status snapshot must identify the running server epoch",
  );
  assert.deepEqual(
    poolSidecar.lastCandidates,
    [],
    "protected five-symbol status reads must not be forwarded into the AI pool sidecar",
  );
  const protectedDecisionSnapshot = (status) => ({
    symbolRadars: status.symbolRadars.map((symbolStatus) => ({
      symbol: symbolStatus.symbol,
      marketFeedState: symbolStatus.marketFeedState,
      score: symbolStatus.alphaRadar.score,
      scoreState: symbolStatus.alphaRadar.scoreState,
      dataQuality: symbolStatus.alphaRadar.dataQuality,
      preBreakoutState: symbolStatus.alphaRadar.preBreakout.state,
      confirmationStatus: symbolStatus.alphaRadar.preBreakout.confirmation.status,
      dataFresh: symbolStatus.alphaRadar.preBreakout.dataFresh,
    })),
    alphaRanking: status.alphaRanking.entries.map((entry) => ({
      symbol: entry.symbol,
      eligibility: entry.eligibility,
      rankingScore: entry.rankingScore,
      reason: entry.reason,
    })),
  });
  const alertDecisionSnapshot = (status) => observeRadarStatus(new AlertMonitor(), status).map((observation) => ({
    symbol: observation.symbol,
    ok: observation.result.ok,
    failedGate: observation.result.ok ? null : observation.result.failedGate,
    isNewCandidate: observation.isNewCandidate,
  }));
  const protectedBeforeFocusedCoverage = protectedDecisionSnapshot(universeStatus);
  const alertObservationsBeforeFocusedCoverage = alertDecisionSnapshot(universeStatus);
  const integrationNow = new Date();
  marketUniverse.registry.replace(
    [{
      providerSymbol: "AMAT",
      instrumentId: "focused-integration-fixture",
      providerSecurityType: "CS",
      listingStatus: "A",
      listingExchange: "XNAS",
      primaryExchange: "XNAS",
      sector: "Information Technology",
      industryGroup: "Semiconductors",
      industry: "Semiconductor Equipment",
      classificationSource: "Deterministic focused integration fixture",
      classificationAuthorized: true,
      classificationUpdatedAt: integrationNow.toISOString(),
      referenceUpdatedAt: integrationNow.toISOString(),
      primaryListing: true,
    }],
    {
      dataset: "Fixture",
      source: "Deterministic focused integration fixture",
      sourceKind: "security_master",
      sourceTimestamp: integrationNow,
      maxAgeMs: 60_000,
      reason: "Deterministic fixture.",
      authorizationState: "verified",
      authorizationReason: "Fixture authorization verified.",
    },
    integrationNow,
  );
  marketUniverse.refreshState = "ready";
  marketUniverse.lastAttemptAt = integrationNow;

  const focusedService = new DatabentoLiveService("AMAT");
  seedCompleteLegacyWindow(focusedService, integrationNow);
  let focusedStatus = focusedService.getStatus();
  focusedStatus.scanHealth = {
    ...focusedStatus.scanHealth,
    schedulerState: "scheduled",
    marketDataState: "fresh",
    marketDataGateReady: true,
  };
  focusedStatus.liveIngestion = {
    ...focusedStatus.liveIngestion,
    conditions: {
      ...focusedStatus.liveIngestion.conditions,
      subscriptionVerified: true,
      realMarketEventReceived: true,
      enteredScoringWindow: true,
      scoringEligible: true,
    },
  };
  focusedStatus.alphaRadar = {
    ...focusedStatus.alphaRadar,
    confidence: 100,
    alphaVelocity: {
      ...focusedStatus.alphaRadar.alphaVelocity,
      delta30s: 4,
      delta60s: 6,
      rate30s: 4,
      rate60s: 3,
    },
    changeIndicators: {
      ...focusedStatus.alphaRadar.changeIndicators,
      momentumAcceleration: 4,
      volumeAcceleration: 3,
      orderFlowShift: 2,
      spreadTightening: 1,
    },
    preBreakout: {
      ...focusedStatus.alphaRadar.preBreakout,
      dataFresh: true,
      state: "confirmed",
      confirmation: {
        ...focusedStatus.alphaRadar.preBreakout.confirmation,
        status: "confirmed",
      },
    },
  };
  assert.equal(focusedStatus.connectionState, "streaming");
  assert.equal(focusedStatus.marketFeedState, "streaming");
  assert.equal(focusedStatus.alphaRadar.scoreState, "available");
  assert.equal(focusedStatus.alphaRadar.dataQuality, "good");
  assert.equal(focusedStatus.alphaRadar.preBreakout.dataFresh, true);
  const focusedFixtureService = {
    getStatus: () => focusedStatus,
    start: () => focusedStatus,
    stop: () => focusedStatus,
    on: () => focusedFixtureService,
  };
  const fixtureSigningSecret = "fixed-fixture-signing-key-for-focused-integration";
  const focusedCoordinator = new FocusedScanCoordinator({
    referenceUniverse: marketUniverse,
    apiKeyAvailable: () => true,
    signingSecret: () => fixtureSigningSecret,
    createService: () => focusedFixtureService,
  });
  const protectedStreamingFixture = [{
    connectionState: "streaming",
    marketFeedState: "streaming",
    liveIngestion: { conditions: { subscriptionVerified: true } },
    lastUpdatedAt: integrationNow,
    startedAt: integrationNow,
  }];
  const admittedFocused = focusedCoordinator.routeVerifiedMarketLeader(
    createSignedMarketLeaderEnvelope({
      symbol: "AMAT",
      observedAt: integrationNow,
      source: "databento_live",
      schema: "mbp-1",
      subscriptionVerified: true,
      completeMarketFields: true,
      fresh: true,
      minimumLiquiditySatisfied: true,
      independentEvidenceCount: 2,
    }, {
      secret: fixtureSigningSecret,
      issuedAt: integrationNow,
      nonce: "focused-integration-fixture-nonce",
    }),
    protectedStreamingFixture,
    integrationNow,
  );
  assert.equal(admittedFocused.state, "admitted", "the complete verified fixture must enter the focused pool");
  universe.focusedScans = focusedCoordinator;
  const refreshedUniverseStatus = universe.buildSnapshot();
  assert.ok(
    refreshedUniverseStatus.statusRevision > universeStatus.statusRevision,
    "a rebuilt global status snapshot must advance its revision independently of market-event time",
  );
  assert.deepEqual(
    refreshedUniverseStatus.sectorPriority.coverage.eligibleLivePopulation,
    ["AMAT"],
    "an admitted focused symbol may broaden only the verified sector-priority coverage population",
  );
  assert.equal(
    refreshedUniverseStatus.symbolRadars.some((status) => status.symbol === "AMAT"),
    false,
    "the focused symbol must never enter the protected symbol radar population",
  );
  assert.equal(
    refreshedUniverseStatus.alphaRanking.entries.some((entry) => entry.symbol === "AMAT"),
    false,
    "the focused symbol must never enter protected Alpha ranking",
  );
  assert.deepEqual(
    protectedDecisionSnapshot(refreshedUniverseStatus),
    protectedBeforeFocusedCoverage,
    "focused sector coverage must not change protected symbol radars or Alpha ranking decisions",
  );
  assert.deepEqual(
    alertDecisionSnapshot(refreshedUniverseStatus),
    alertObservationsBeforeFocusedCoverage,
    "AlertMonitor must observe exactly the unchanged protected symbol population",
  );
  assert.equal(
    alertDecisionSnapshot(refreshedUniverseStatus).some((observation) => observation.symbol === "AMAT"),
    false,
    "AlertMonitor must never observe a focused-only sector symbol",
  );
  assert.deepEqual(
    poolSidecar.lastCandidates,
    [{
      symbol: "AMAT",
      marketFeedState: "streaming",
      preBreakoutState: "confirmed",
      confirmationStatus: "confirmed",
    }],
    "a non-protected taxonomy member with focused-scan live confirmation must reach the isolated pool sidecar",
  );
  const completeFocusedStatus = focusedStatus;
  for (const [label, mutate] of [
    ["stale", (status) => {
      status.marketFeedState = "stale";
      status.scanHealth.marketDataState = "stale";
      status.scanHealth.marketDataGateReady = false;
      status.alphaRadar.preBreakout.dataFresh = false;
    }],
    ["unscheduled", (status) => {
      status.scanHealth.schedulerState = "stopped";
    }],
    ["incomplete", (status) => {
      status.liveIngestion.conditions.realMarketEventReceived = false;
      status.liveIngestion.conditions.enteredScoringWindow = false;
      status.liveIngestion.conditions.scoringEligible = false;
    }],
  ]) {
    focusedStatus = structuredClone(completeFocusedStatus);
    mutate(focusedStatus);
    const excludedStatus = universe.buildSnapshot();
    assert.equal(
      excludedStatus.sectorPriority.coverage.eligibleLivePopulation.includes("AMAT"),
      false,
      `${label} focused live evidence must be excluded even with a trusted reference classification`,
    );
    assert.deepEqual(
      protectedDecisionSnapshot(excludedStatus),
      protectedBeforeFocusedCoverage,
      `${label} focused evidence must not change protected radar or ranking decisions`,
    );
    assert.equal(
      alertDecisionSnapshot(excludedStatus).some((observation) => observation.symbol === "AMAT"),
      false,
      `${label} focused evidence must never reach AlertMonitor`,
    );
  }
  focusedStatus = completeFocusedStatus;
  const restartedUniverse = new DatabentoUniverseService();
  const restartedUniverseStatus = restartedUniverse.getStatus();
  assert.notEqual(
    restartedUniverseStatus.statusEpoch,
    refreshedUniverseStatus.statusEpoch,
    "a recreated universe must establish a new server epoch instead of reusing the old process revision",
  );
  assert.equal(
    restartedUniverseStatus.statusRevision,
    1,
    "a new epoch may restart its local revision sequence",
  );
  const probeService = new (require("node:events").EventEmitter)();
  probeService.getStatus = () => completeFocusedStatus;
  probeService.start = () => completeFocusedStatus;
  probeService.stop = () => completeFocusedStatus;
  const runtimeUniverse = new DatabentoUniverseService();
  const runtimeProbe = new AiIndustryLeaderProbeCoordinator({
    symbols: ["NVDA", "AMAT"],
    createService: () => probeService,
    apiKeyAvailable: () => true,
    signingSecret: () => "fixed-test-key-for-market-leader-intake-only",
    symbolSupported: (symbol) => symbol === "AMAT",
  });
  runtimeUniverse.aiIndustryLeaderProbe = runtimeProbe;
  const admittedLeaders = [];
  runtimeUniverse.focusedScans.routeVerifiedMarketLeader = (envelope, protectedStatuses) => {
    admittedLeaders.push({
      leader: envelope.payload,
      protectedSymbols: protectedStatuses.map((status) => status.symbol),
    });
    return {
      symbol: envelope.payload.symbol,
      state: "admitted",
      reason: "test",
      observedAt: new Date(envelope.payload.observedAt),
      independentEvidenceCount: 2,
      updatedAt: new Date(),
    };
  };
  runtimeProbe.start();
  runtimeUniverse.getStatus();
  assert.deepEqual(
    admittedLeaders.map(({ leader }) => leader.symbol),
    ["AMAT"],
    "the production universe must route a confirmed non-protected leader probe into Focused Scan admission",
  );
  assert.deepEqual(
    admittedLeaders[0].protectedSymbols,
    [...MONITORED_SYMBOLS],
    "leader admission may inspect protected authorization only; protected symbols never become probe candidates",
  );
  runtimeProbe.stop();
  const missingSigningSecretProbe = new AiIndustryLeaderProbeCoordinator({
    symbols: ["AMAT"],
    createService: () => probeService,
    apiKeyAvailable: () => true,
    signingSecret: () => undefined,
    symbolSupported: (symbol) => symbol === "AMAT",
  });
  let unsignedFallbackRoutes = 0;
  missingSigningSecretProbe.start();
  missingSigningSecretProbe.observe([], () => {
    unsignedFallbackRoutes += 1;
    return {
      symbol: "AMAT",
      state: "admitted",
      reason: "test",
      observedAt: new Date(),
      independentEvidenceCount: 2,
      updatedAt: new Date(),
    };
  });
  assert.equal(
    unsignedFallbackRoutes,
    0,
    "a producer without the signing secret must fail closed and never route an unsigned fallback",
  );
  missingSigningSecretProbe.stop();
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
  assert.deepEqual(
    universeStatus.symbolRadars.map((radar) => radar.scanHealth.marketDataState),
    ["offline", "offline", "offline", "offline", "offline"],
    "every protected symbol must explicitly report offline market data while Databento is stopped",
  );
  assert.ok(
    universeStatus.symbolRadars.every(
      (radar) =>
        radar.scanHealth.schedulerState === "inactive"
        && radar.scanHealth.lastScanAt === null
        && radar.scanHealth.marketDataGateReady === false
        && radar.scanHealth.degradation === "offline",
    ),
    "offline protected scanners must expose no fabricated completed scan or verified market-data gate",
  );
  const originalGetStatus = new Map();
  universe.services.forEach((service) => {
    originalGetStatus.set(service, service.getStatus);
    service.getStatus = () => {
      throw new Error("Engineering scheduler projection must not call service.getStatus()");
    };
  });
  assert.deepEqual(
    universe.getEngineeringScannerHealth(referenceAt),
    MONITORED_SYMBOLS.map((symbol) => ({ symbol, schedulerState: "inactive" })),
    "engineering scheduler visibility must read dedicated scheduler state without calculating scores or mutating ranking state",
  );
  assert.deepEqual(
    universe.getLifelineHealth(referenceAt).map((health) => ({
      symbol: health.symbol,
      schedulerState: health.schedulerState,
      recoveryPhase: health.recoveryPhase,
      marketEventFresh: health.marketEventFresh,
    })),
    MONITORED_SYMBOLS.map((symbol) => ({
      symbol,
      schedulerState: "inactive",
      recoveryPhase: "stopped",
      marketEventFresh: false,
    })),
    "lifeline visibility must use the same side-effect-free service projection and never turn an offline scanner into fresh evidence",
  );
  originalGetStatus.forEach((getStatus, service) => {
    service.getStatus = getStatus;
  });
  const startupUniverse = new DatabentoUniverseService();
  const startupCalls = [];
  startupUniverse.services.forEach((service) => {
    service.start = () => {
      startupCalls.push(service.getStatus().symbol);
      return service.getStatus();
    };
  });
  startupUniverse.start();
  assert.deepEqual(
    startupCalls,
    [...MONITORED_SYMBOLS],
    "universe startup must arm every protected live bridge without waiting for a manual dashboard action",
  );
  startupUniverse.aiIndustryLeaderProbe.stop();
  const exhaustionRecoveryService = new DatabentoLiveService("NVDA");
  exhaustionRecoveryService.status = {
    ...exhaustionRecoveryService.getStatus(),
    configured: true,
    connectionState: "error",
    reconnectAttempt: 5,
  };
  exhaustionRecoveryService.scheduleReconnect();
  const exhaustedRecovery = exhaustionRecoveryService.getStatus();
  assert.equal(
    exhaustedRecovery.reconnectState,
    "exhausted",
    "a failed reconnect burst must remain explicitly bounded",
  );
  assert.ok(
    exhaustedRecovery.nextReconnectAt instanceof Date,
    "retry exhaustion must expose the scheduled cooldown recovery rather than leaving the service permanently stopped",
  );
  assert.ok(
    exhaustionRecoveryService.exhaustionRearmTimer,
    "retry exhaustion must arm a fresh bounded recovery cycle for a long-running process",
  );
  exhaustionRecoveryService.stop();
  assert.equal(
    exhaustionRecoveryService.exhaustionRearmTimer,
    null,
    "an explicit stop must cancel an exhausted-cycle recovery timer",
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
  assert.equal(
    incomplete.scanHealth.marketDataGateReady,
    false,
    "a direct fixture without an armed scheduler must never satisfy the market-data gate",
  );

  const insufficientHealthService = new DatabentoLiveService("NVDA");
  insufficientHealthService.applyEvent({ type: "ready" });
  insufficientHealthService.applyEvent(marketEvent(new Date(), 100, "B"));
  const insufficientHealth = insufficientHealthService.getStatus().scanHealth;
  assert.equal(
    insufficientHealth.marketDataState,
    "insufficient",
    "one verified market event without a complete scoring window must report insufficient scan health",
  );
  assert.equal(
    insufficientHealth.marketDataGateReady,
    false,
    "an insufficient protected scanner must never satisfy the market-data gate",
  );

  const awaitingLiveEventService = new DatabentoLiveService("MU");
  awaitingLiveEventService.applyEvent({ type: "ready" });
  awaitingLiveEventService.scanSchedulerActive = true;
  awaitingLiveEventService.nextScheduledScanAt = new Date(Date.now() + 5_000);
  const awaitingLiveEventHealth = awaitingLiveEventService.getStatus().scanHealth;
  assert.equal(
    awaitingLiveEventHealth.marketDataState,
    "insufficient",
    "a ready subscription without any real market event must remain insufficient rather than stale",
  );
  assert.equal(
    awaitingLiveEventHealth.degradation,
    "awaiting_live_event",
    "a ready subscription must disclose that it is awaiting its first verified market event",
  );
  assert.equal(
    awaitingLiveEventHealth.marketDataGateReady,
    false,
    "a connected subscription without a verified market event must never satisfy the market-data gate",
  );

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
  assert.equal(
    freshAlphaStatus.scanHealth.marketDataState,
    "fresh",
    "a verified complete event window must be represented as fresh even before a scheduler is armed",
  );
  assert.equal(
    freshAlphaStatus.scanHealth.marketDataGateReady,
    false,
    "a fresh direct fixture without an armed scheduler must remain alert-ineligible",
  );
  assert.equal(
    freshAlphaStatus.scanHealth.degradation,
    "scheduler_inactive",
    "scheduler state must remain visible independently from fresh market data",
  );

  const staleHealthService = new DatabentoLiveService("NVDA");
  staleHealthService.applyEvent({ type: "ready" });
  staleHealthService.applyEvent(marketEvent(new Date(Date.now() - 20_000), 100, "B"));
  const staleHealth = staleHealthService.getStatus().scanHealth;
  assert.equal(
    staleHealth.marketDataState,
    "stale",
    "a last real market event outside the existing freshness window must be stale",
  );
  assert.equal(
    staleHealth.degradation,
    "stale_market_data",
    "stale verified market data must be distinguishable from a scheduler state",
  );
  assert.equal(
    staleHealth.marketDataGateReady,
    false,
    "stale market data must never satisfy the production scan-health gate",
  );

  const watchdogService = new DatabentoLiveService("NVDA");
  watchdogService.status = {
    ...watchdogService.status,
    connectionState: "streaming",
    lastUpdatedAt: new Date(),
  };
  watchdogService.scanSchedulerActive = true;
  watchdogService.nextScheduledScanAt = new Date(Date.now() - 10_000);
  const delayedHealth = watchdogService.getStatus().scanHealth;
  assert.equal(
    delayedHealth.schedulerState,
    "delayed",
    "an overdue timer must be observable as delayed rather than silently appearing scheduled",
  );
  assert.equal(
    delayedHealth.degradation,
    "scheduler_delayed",
    "a delayed scanner must publish an explicit degradation reason",
  );
  assert.equal(
    delayedHealth.marketDataGateReady,
    false,
    "scheduler watchdog delay must fail closed before the production alert handoff",
  );

  const timerIsolationService = new DatabentoLiveService("NVDA");
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledCallbacks = [];
  let timerRuns = 0;
  globalThis.setTimeout = (callback) => {
    scheduledCallbacks.push(callback);
    return { unref() {} };
  };
  globalThis.clearTimeout = () => {};
  try {
    timerIsolationService.runAlphaScan = () => {
      timerRuns += 1;
    };
    timerIsolationService.scanSchedulerActive = true;
    timerIsolationService.scheduleNextScan(1);
    const staleTimerCallback = scheduledCallbacks.at(-1);
    timerIsolationService.stopScanScheduler();
    staleTimerCallback();
    assert.equal(
      timerRuns,
      0,
      "a callback captured before stop must not scan after its scheduler generation is invalidated",
    );

    timerIsolationService.scanSchedulerActive = true;
    timerIsolationService.scheduleNextScan(1);
    scheduledCallbacks.at(-1)();
    assert.equal(
      timerRuns,
      1,
      "only the currently armed scheduler generation may execute a scheduled scan",
    );

    const bridgeErrorRecovery = new DatabentoLiveService("NVDA");
    const reconnectTimersBeforeError = scheduledCallbacks.length;
    bridgeErrorRecovery.applyEvent({ type: "error", message: "deterministic bridge protocol error" });
    assert.equal(
      bridgeErrorRecovery.getStatus().reconnectState,
      "scheduled",
      "a bridge-originated protocol error must enter bounded reconnect rather than remain terminal",
    );
    assert.equal(
      scheduledCallbacks.length,
      reconnectTimersBeforeError + 1,
      "a bridge-originated protocol error must arm exactly one reconnect timer",
    );
    bridgeErrorRecovery.stop();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  const preStreamingScanService = new DatabentoLiveService("NVDA");
  preStreamingScanService.runAlphaScan("scheduled_scan", false);
  assert.equal(
    preStreamingScanService.lastAlphaScanAt,
    null,
    "a scan while connecting must not be recorded as a completed market scan",
  );
  preStreamingScanService.applyEvent({ type: "ready" });
  preStreamingScanService.runAlphaScan("scheduled_scan", false);
  assert.equal(
    preStreamingScanService.lastAlphaScanAt,
    null,
    "a scan while connected but before the first live event must not be recorded as completed",
  );
  preStreamingScanService.applyEvent(marketEvent(new Date(), 100, "B"));
  assert.ok(
    preStreamingScanService.lastAlphaScanAt instanceof Date,
    "the first completed scan must follow a real market event and streaming state",
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
      toState: strengthening ? "latent" : "watch",
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
          state: marketFeedState === "streaming" ? "latent" : "unavailable",
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

  // Delivery-path health is independent from market evidence and must fail
  // closed for duplicate, reordered, delayed, and backpressured bridge data.
  const networkNow = new Date();
  const duplicateNetworkService = new DatabentoLiveService("NVDA");
  duplicateNetworkService.applyEvent({ type: "ready" });
  duplicateNetworkService.applyEvent({
    type: "heartbeat",
    source: "databento_live",
    emittedAt: networkNow.toISOString(),
  });
  assert.equal(
    duplicateNetworkService.getStatus().liveIngestion.verifiedMarketEventCount,
    0,
    "a bridge heartbeat must not count as a market event or establish a market window",
  );
  const delayedHeartbeatService = new DatabentoLiveService("NVDA");
  delayedHeartbeatService.applyEvent({ type: "ready" });
  delayedHeartbeatService.applyEvent({
    type: "heartbeat",
    source: "databento_live",
    emittedAt: new Date(Date.now() - 16_000).toISOString(),
  });
  const delayedHeartbeat = delayedHeartbeatService.getStatus().network;
  assert.equal(delayedHeartbeat.heartbeatFresh, false, "a buffered old heartbeat must not be refreshed at processing time");
  assert.equal(delayedHeartbeat.alertReady, false, "a buffered old heartbeat must fail closed for alert readiness");
  const firstNetworkEvent = marketEvent(networkNow, 100, "B");
  duplicateNetworkService.applyEvent(firstNetworkEvent);
  const initialNetwork = duplicateNetworkService.getStatus().network;
  assert.equal(initialNetwork.transportState, "streaming", "a verified market record must advance transport state");
  assert.equal(initialNetwork.latencyState, "healthy", "a low-latency bridge record must expose healthy delivery latency");
  assert.equal(initialNetwork.integrity.state, "healthy", "the first ordered event starts a verified integrity window");
  assert.equal(initialNetwork.queue.state, "normal", "normal-load ingestion must expose a normal bounded queue");
  assert.equal(
    duplicateNetworkService.getStatus().liveIngestion.verifiedMarketEventCount,
    1,
    "a verified first market event must be counted exactly once",
  );
  duplicateNetworkService.applyEvent(firstNetworkEvent);
  const duplicateNetwork = duplicateNetworkService.getStatus();
  assert.equal(duplicateNetwork.liveIngestion.verifiedMarketEventCount, 1, "a duplicate bridge record must not count twice");
  assert.equal(duplicateNetwork.network.integrity.duplicateEvents, 1, "duplicate delivery must be observable");
  assert.equal(duplicateNetwork.network.integrity.state, "blocked", "duplicate delivery must fail closed");
  assert.equal(duplicateNetwork.marketFeedState, "stale", "duplicate integrity loss must withhold market freshness");
  const generationBeforeRecovery = duplicateNetwork.network.recovery.generation;
  duplicateNetworkService.applyEvent(marketEvent(new Date(), 100.2, "B"));
  const duplicateRecovered = duplicateNetworkService.getStatus();
  assert.ok(
    duplicateRecovered.network.recovery.generation > generationBeforeRecovery,
    "post-integrity recovery must create a new bounded network generation",
  );
  assert.equal(duplicateRecovered.network.integrity.state, "healthy", "a new ordered event may establish a recovery window");
  assert.equal(duplicateRecovered.alphaRadar.score, null, "recovery must not reuse a pre-integrity-loss Alpha score");

  const outOfOrderNetworkService = new DatabentoLiveService("NVDA");
  const outOfOrderNow = new Date();
  outOfOrderNetworkService.applyEvent({ type: "ready" });
  outOfOrderNetworkService.applyEvent(marketEvent(new Date(outOfOrderNow.getTime() - 6_000), 100, "B"));
  outOfOrderNetworkService.applyEvent(marketEvent(new Date(outOfOrderNow.getTime() - 2_000), 100.2, "B"));
  outOfOrderNetworkService.applyEvent(marketEvent(new Date(outOfOrderNow.getTime() - 3_000), 100.1, "B"));
  const outOfOrderNetwork = outOfOrderNetworkService.getStatus().network;
  assert.equal(outOfOrderNetwork.integrity.outOfOrderEvents, 1, "reordered bridge delivery must be observable");
  assert.equal(outOfOrderNetwork.integrity.state, "blocked", "reordered bridge delivery must fail closed");
  assert.equal(outOfOrderNetwork.alertReady, false, "integrity loss must never claim alert readiness");

  const delayedNetworkService = new DatabentoLiveService("NVDA");
  delayedNetworkService.applyEvent({ type: "ready" });
  delayedNetworkService.applyEvent(marketEvent(new Date(Date.now() - 11_000), 100, "B"));
  const delayedNetwork = delayedNetworkService.getStatus();
  assert.equal(delayedNetwork.network.latencyState, "blocked", "severe event delay must breach the network threshold");
  assert.equal(delayedNetwork.network.alertReady, false, "severe delivery delay must block alert readiness");
  assert.equal(delayedNetwork.marketFeedState, "stale", "severe delivery delay must not remain a streaming feed");

  const retiredGenerationService = new DatabentoLiveService("NVDA");
  const retiredGeneration = retiredGenerationService.activeBridgeGeneration;
  retiredGenerationService.fail("deterministic bridge retirement", false);
  retiredGenerationService.enqueueBridgeEvents(
    [marketEvent(new Date(), 100, "B")],
    retiredGeneration,
  );
  assert.equal(
    retiredGenerationService.getStatus().liveIngestion.verifiedMarketEventCount,
    0,
    "a retired bridge generation must never refill a failed market window",
  );
  assert.equal(
    retiredGenerationService.getStatus().network.alertReady,
    false,
    "retired bridge callbacks must remain ineligible for alert recovery",
  );

  const overflowNetworkService = new DatabentoLiveService("NVDA");
  overflowNetworkService.enqueueBridgeEvents(Array.from({ length: 257 }, () => ({ type: "ready" })));
  const overflowNetwork = overflowNetworkService.getStatus().network;
  assert.equal(overflowNetwork.queue.state, "blocked", "queue overflow must be explicit rather than silently dropped");
  assert.equal(overflowNetwork.queue.rejected, 257, "queue overflow must record every rejected event");
  assert.equal(overflowNetwork.alertReady, false, "bounded queue overflow must fail closed for alerts");
  overflowNetworkService.stop();

  console.log("Databento live service tests passed: recovery windows, bounded reconnect, latency/jitter, queue backpressure, duplicate/reordered events, and alert-safe network health.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}