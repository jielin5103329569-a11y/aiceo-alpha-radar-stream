import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "focused-scan-routing-test-"));

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

function focusedServiceStatus(feedState = "streaming") {
  return {
    connectionState: feedState === "streaming" ? "streaming" : "stopped",
    marketFeedState: feedState,
    alphaRadar: { preBreakout: { dataFresh: feedState === "streaming" } },
  };
}

class FakeFocusedService {
  constructor(symbol) {
    this.symbol = symbol;
    this.feedState = "streaming";
    this.started = 0;
    this.stopped = 0;
    this.listener = null;
  }

  getStatus() {
    return focusedServiceStatus(this.feedState);
  }

  start() {
    this.started += 1;
    return this.getStatus();
  }

  stop() {
    this.stopped += 1;
    this.feedState = "offline";
    this.listener?.();
    return this.getStatus();
  }

  on(event, listener) {
    if (event === "status") this.listener = listener;
    return this;
  }
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
  transpile("artifacts/api-server/src/lib/catalystRadar.ts", "catalystRadar.js");
  transpile("artifacts/api-server/src/lib/sectorPriority.ts", "sectorPriority.js");
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
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.aiIndustryStockPool = { considerPrequalifiedLiveCandidates() {} };',
  );
  writeFileSync(
    join(outputDirectory, "aiIndustryTaxonomy.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.AI_INDUSTRY_TAXONOMY = [{ symbol: "AMAT", categories: ["semiconductor_equipment"] }];',
  );
  writeFileSync(
    join(outputDirectory, "openingReadiness.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.buildOpeningReadiness = () => ({});',
  );
  writeFileSync(
    join(outputDirectory, "dataGovernance.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.buildDataGovernanceSnapshot = () => ({});',
  );
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  const require = createRequire(import.meta.url);
  const {
    FocusedScanCoordinator,
    createSignedMarketLeaderEnvelope,
  } = require(join(outputDirectory, "databentoLive.js"));
  const now = new Date("2026-08-19T14:30:00.000Z");
  const signingSecret = "fixed-test-key-for-market-leader-intake-only";
  const eligibleSymbols = new Set(["ACME", "BETA", "GAMMA", "DELTA"]);
  const referenceSummary = {
    refreshState: "ready",
    freshness: "fresh",
    dataQuality: "good",
    eligibleCount: eligibleSymbols.size,
    reason: "Fresh verified reference fixture.",
  };
  const referenceUniverse = {
    query({ search }) {
      const symbol = String(search ?? "").toUpperCase();
      return {
        summary: referenceSummary,
        items: eligibleSymbols.has(symbol)
          ? [{ symbol, eligibility: "eligible", lifecycleStatus: "active" }]
          : [],
      };
    },
  };
  const protectedStreaming = [{
    connectionState: "streaming",
    marketFeedState: "streaming",
    liveIngestion: { conditions: { subscriptionVerified: true } },
    lastUpdatedAt: now,
    startedAt: now,
  }];
  const protectedBefore = JSON.stringify(protectedStreaming);
  const leader = (symbol, observedAt = now, overrides = {}) => ({
    symbol,
    observedAt,
    source: "databento_live",
    schema: "mbp-1",
    subscriptionVerified: true,
    completeMarketFields: true,
    fresh: true,
    minimumLiquiditySatisfied: true,
    independentEvidenceCount: 2,
    ...overrides,
  });
  let nonceOrdinal = 0;
  const signedLeader = (symbol, observedAt = now, overrides = {}, envelopeOverrides = {}) => {
    nonceOrdinal += 1;
    return {
      ...createSignedMarketLeaderEnvelope(leader(symbol, observedAt, overrides), {
        secret: signingSecret,
        issuedAt: now,
        nonce: `test-nonce-${String(nonceOrdinal).padStart(8, "0")}`,
      }),
      ...envelopeOverrides,
    };
  };

  const noCredentialCoordinator = new FocusedScanCoordinator({
    referenceUniverse,
    apiKeyAvailable: () => false,
    signingSecret: () => signingSecret,
  });
  assert.equal(
    noCredentialCoordinator.getStatus(protectedStreaming, now).state,
    "blocked",
    "missing authorization must block focused scans without admitting reference records",
  );
  assert.equal(
    noCredentialCoordinator.getStatus(protectedStreaming, now).authorization.state,
    "unavailable",
  );

  const erroredProtected = [{
    ...protectedStreaming[0],
    connectionState: "error",
    marketFeedState: "offline",
  }];
  const blockedCoordinator = new FocusedScanCoordinator({
    referenceUniverse,
    apiKeyAvailable: () => true,
    signingSecret: () => signingSecret,
  });
  assert.equal(
    blockedCoordinator.getStatus(erroredProtected, now).authorization.state,
    "blocked",
    "failed protected bridges must leave provider capability explicitly blocked",
  );

  const createdServices = [];
  const coordinator = new FocusedScanCoordinator({
    referenceUniverse,
    apiKeyAvailable: () => true,
    signingSecret: () => signingSecret,
    maximumScans: 2,
    createService: (symbol) => {
      const service = new FakeFocusedService(symbol);
      createdServices.push(service);
      return service;
    },
  });
  assert.equal(
    coordinator.getStatus([{ ...protectedStreaming[0], connectionState: "stopped", marketFeedState: "offline" }], now).state,
    "unavailable",
    "a configured key alone must not be treated as verified live Databento capability",
  );
  assert.equal(
    coordinator.getStatus(protectedStreaming, now).state,
    "unavailable",
    "without a real market-leader source, focused routing must remain explicitly unavailable rather than claim readiness",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(signedLeader("NVDA"), protectedStreaming, now).state,
    "rejected",
    "protected symbols must never enter the focused routing pool",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(
      signedLeader("ACME", now, { independentEvidenceCount: 1 }),
      protectedStreaming,
      now,
    ).state,
    "rejected",
    "one composite or incomplete evidence source must not admit a scan",
  );
  for (const [label, overrides] of [
    ["non-Databento source", { source: "other_provider" }],
    ["unrecognized schema", { schema: "trades-1" }],
    ["unverified subscription", { subscriptionVerified: false }],
    ["incomplete market fields", { completeMarketFields: false }],
    ["stale market record", { fresh: false }],
    ["missing minimum liquidity", { minimumLiquiditySatisfied: false }],
    ["expired leader observation", { observedAt: new Date(now.getTime() - 15_001) }],
    ["future leader observation", { observedAt: new Date(now.getTime() + 1) }],
  ]) {
    assert.equal(
      coordinator.routeVerifiedMarketLeader(signedLeader("ACME", now, overrides), protectedStreaming, now).state,
      "rejected",
      `${label} must fail closed before creating a focused scan`,
    );
  }

  assert.equal(
    coordinator.routeVerifiedMarketLeader(signedLeader("ACME"), protectedStreaming, now).state,
    "admitted",
    "a fully gated verified leader may enter the bounded focused pool",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(signedLeader("BETA"), protectedStreaming, now).state,
    "admitted",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(signedLeader("GAMMA"), protectedStreaming, now).state,
    "rejected",
    "fresh active focused scans must not be evicted merely to make room",
  );
  assert.equal(coordinator.getStatus(protectedStreaming, now).activeScans.length, 2);
  assert.equal(createdServices.length, 2);
  assert.equal(JSON.stringify(protectedStreaming), protectedBefore, "focused routing must not mutate protected scan state");

  createdServices[0].feedState = "offline";
  const afterCooldown = new Date(now.getTime() + 5 * 60_000 + 1);
  assert.equal(
    coordinator.routeVerifiedMarketLeader(
      createSignedMarketLeaderEnvelope(leader("DELTA", afterCooldown), {
        secret: signingSecret,
        issuedAt: afterCooldown,
        nonce: "test-nonce-after-cooldown",
      }),
      protectedStreaming,
      afterCooldown,
    ).state,
    "admitted",
    "only an inactive focused scan after its minimum tenure may be safely evicted",
  );
  assert.equal(createdServices[0].stopped, 1, "eviction must stop the isolated bridge");
  assert.equal(
    coordinator.routeVerifiedMarketLeader(
      createSignedMarketLeaderEnvelope(leader("ACME", new Date(afterCooldown.getTime() + 1)), {
        secret: signingSecret,
        issuedAt: new Date(afterCooldown.getTime() + 1),
        nonce: "test-nonce-after-eviction",
      }),
      protectedStreaming,
      new Date(afterCooldown.getTime() + 1),
    ).state,
    "cooling_down",
    "evicted symbols must observe a cooldown before re-admission",
  );

  const hardCapServices = [];
  const hardCapCoordinator = new FocusedScanCoordinator({
    referenceUniverse,
    apiKeyAvailable: () => true,
    signingSecret: () => signingSecret,
    maximumScans: 9,
    createService: (symbol) => {
      const service = new FakeFocusedService(symbol);
      hardCapServices.push(service);
      return service;
    },
  });
  assert.equal(
    hardCapCoordinator.getStatus(protectedStreaming, now).capacity.maximum,
    3,
    "the focused bridge budget is hard-capped at three even when a caller requests more",
  );
  assert.equal(hardCapCoordinator.routeVerifiedMarketLeader(signedLeader("ACME"), protectedStreaming, now).state, "admitted");
  assert.equal(hardCapCoordinator.routeVerifiedMarketLeader(signedLeader("BETA"), protectedStreaming, now).state, "admitted");
  assert.equal(hardCapCoordinator.routeVerifiedMarketLeader(signedLeader("GAMMA"), protectedStreaming, now).state, "admitted");
  assert.equal(
    hardCapCoordinator.routeVerifiedMarketLeader(signedLeader("DELTA"), protectedStreaming, now).state,
    "rejected",
    "a fourth fresh candidate must be rejected rather than exceed the three-bridge production budget",
  );
  assert.equal(hardCapServices.length, 3);

  const missingSecretCoordinator = new FocusedScanCoordinator({
    referenceUniverse,
    apiKeyAvailable: () => true,
    signingSecret: () => undefined,
  });
  assert.equal(
    missingSecretCoordinator.routeVerifiedMarketLeader(signedLeader("ACME"), protectedStreaming, now).state,
    "rejected",
    "a missing signing secret must fail closed without unsigned fallback",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(leader("ACME"), protectedStreaming, now).state,
    "rejected",
    "an unsigned leader payload must be rejected",
  );
  const validForTampering = signedLeader("DELTA");
  assert.equal(
    coordinator.routeVerifiedMarketLeader({
      ...validForTampering,
      payload: { ...validForTampering.payload, symbol: "ACME" },
    }, protectedStreaming, now).state,
    "rejected",
    "a payload modified after signing must be rejected",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(
      createSignedMarketLeaderEnvelope(leader("DELTA"), {
        secret: "different-fixed-test-key-for-intake-only",
        issuedAt: now,
        nonce: "test-nonce-wrong-secret",
      }),
      protectedStreaming,
      now,
    ).state,
    "rejected",
    "a signature produced with a different secret must be rejected",
  );
  const replayed = signedLeader("DELTA");
  assert.equal(
    coordinator.routeVerifiedMarketLeader(replayed, protectedStreaming, now).state,
    "admitted",
    "a valid signed envelope must be accepted on its first use",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(replayed, protectedStreaming, now).state,
    "rejected",
    "an already processed signed envelope must be rejected as a replay",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(
      createSignedMarketLeaderEnvelope(leader("DELTA", new Date(now.getTime() - 15_001)), {
        secret: signingSecret,
        issuedAt: new Date(now.getTime() - 15_001),
        nonce: "test-nonce-expired-envelope",
      }),
      protectedStreaming,
      now,
    ).state,
    "rejected",
    "an expired signed envelope must be rejected",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader(
      createSignedMarketLeaderEnvelope(leader("DELTA", new Date(now.getTime() + 1)), {
        secret: signingSecret,
        issuedAt: new Date(now.getTime() + 1),
        nonce: "test-nonce-future-envelope",
      }),
      protectedStreaming,
      now,
    ).state,
    "rejected",
    "a future signed envelope must be rejected",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader({
      ...signedLeader("DELTA"),
      signature: "malformed",
    }, protectedStreaming, now).state,
    "rejected",
    "a malformed signature must be rejected",
  );
  const missingSignature = signedLeader("DELTA");
  delete missingSignature.signature;
  assert.equal(
    coordinator.routeVerifiedMarketLeader(missingSignature, protectedStreaming, now).state,
    "rejected",
    "a missing signature must be rejected",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader({
      ...signedLeader("DELTA"),
      producerId: "unauthorized-producer",
    }, protectedStreaming, now).state,
    "rejected",
    "an unauthorized producer identity must be rejected",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader({
      ...signedLeader("DELTA"),
      version: "market-leader-intake.v2",
    }, protectedStreaming, now).state,
    "rejected",
    "an unknown signed-envelope version must be rejected",
  );
  assert.equal(
    coordinator.routeVerifiedMarketLeader({
      ...signedLeader("DELTA"),
      nonce: "",
    }, protectedStreaming, now).state,
    "rejected",
    "a missing nonce must be rejected",
  );

  console.log("Focused scan signing, rejection, capacity, cooldown, and protected-pool isolation checks passed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}