import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "opening-readiness-test-"));

function transpile(sourcePath, outputName) {
  const source = readFileSync(resolve(sourcePath), "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(join(outputDirectory, outputName), output);
}

function symbol({
  name = "NVDA",
  connectionState = "connected",
  phase = "pre_market",
  scanMode = "pre_open",
  realMarketEventReceived = false,
  marketDataGateReady = false,
  nextScanAt = new Date("2026-08-20T13:29:03.000Z"),
} = {}) {
  return {
    symbol: name,
    connectionState,
    liveIngestion: {
      marketSession: { phase, timezone: "America/New_York" },
      conditions: { subscriptionVerified: true, realMarketEventReceived },
    },
    scanHealth: { scanMode, marketDataGateReady, nextScanAt },
  };
}

function reference({
  freshness = "fresh",
  dataQuality = "good",
  classificationCoverageCount = 5,
  reason = "Trusted fixture classification is fresh.",
} = {}) {
  return { freshness, dataQuality, classificationCoverageCount, reason };
}

function sector({
  state = "unavailable",
  classifiedLiveSymbols = 0,
  rankedSectorCount = 0,
  finalCandidates = [],
  reason = "Sector ranking remains withheld.",
} = {}) {
  return {
    state,
    coverage: {
      classifiedLiveSymbols,
      rankedSectorCount,
      requiredConstituentsPerSector: 2,
    },
    finalCandidates,
    reason,
  };
}

try {
  transpile("artifacts/api-server/src/lib/openingReadiness.ts", "openingReadiness.js");
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url);
  const { buildOpeningReadiness } = require(join(outputDirectory, "openingReadiness.js"));

  const quietPremarket = buildOpeningReadiness({
    symbols: [symbol()],
    marketUniverse: reference(),
    sectorPriority: sector(),
    now: new Date("2026-08-20T13:27:00.000Z"),
  });
  assert.equal(
    quietPremarket.session.mode,
    "pre_market_monitoring",
    "quiet pre-market must be identified as active pre-market monitoring",
  );
  assert.equal(
    quietPremarket.stages.find((item) => item.id === "live_evidence")?.state,
    "monitoring",
    "a connected quiet pre-market subscription must await real evidence rather than report a feed failure",
  );
  assert.equal(
    quietPremarket.stages.find((item) => item.id === "live_evidence")?.detail.includes("Pre-market remains under active observation"),
    true,
    "quiet pre-market status must explain why no real record is not a bridge failure",
  );
  assert.equal(
    quietPremarket.stages.find((item) => item.id === "candidate_promotion")?.state,
    "blocked",
    "a quiet pre-market transport must never imply candidate promotion",
  );

  const connectingTransport = buildOpeningReadiness({
    symbols: [symbol({ connectionState: "connecting" })],
    marketUniverse: reference(),
    sectorPriority: sector(),
  });
  const connectingTransportStage = connectingTransport.stages.find((item) => item.id === "transport");
  assert.equal(
    connectingTransportStage?.state,
    "monitoring",
    "a configured bridge that is only connecting must not be treated as confirmed transport",
  );
  assert.equal(
    connectingTransportStage?.detail.includes("confirmed subscription transport"),
    false,
    "a connecting bridge must not claim that its subscription transport is connected",
  );
  assert.equal(
    connectingTransport.stages.find((item) => item.id === "live_evidence")?.detail.includes("configured subscription"),
    true,
    "configured subscription fields must be explicitly separated from verified live evidence",
  );

  const openingReassessment = buildOpeningReadiness({
    symbols: [
      symbol({
        name: "NVDA",
        connectionState: "streaming",
        phase: "regular",
        scanMode: "opening",
        realMarketEventReceived: true,
        nextScanAt: new Date("2026-08-20T13:30:01.000Z"),
      }),
      symbol({
        name: "AMD",
        connectionState: "streaming",
        phase: "regular",
        scanMode: "opening",
        realMarketEventReceived: true,
        nextScanAt: new Date("2026-08-20T13:30:02.000Z"),
      }),
    ],
    marketUniverse: reference(),
    sectorPriority: sector({ state: "insufficient", classifiedLiveSymbols: 1 }),
    now: new Date("2026-08-20T13:30:00.000Z"),
  });
  assert.equal(
    openingReassessment.session.mode,
    "opening_reassessment",
    "the opening scan profile must switch the read-only status into opening re-evaluation",
  );
  assert.equal(
    openingReassessment.nextEvaluationAt?.toISOString(),
    "2026-08-20T13:30:01.000Z",
    "the snapshot must expose the earliest actual scheduled reevaluation without treating it as market evidence",
  );
  assert.equal(
    openingReassessment.stages.find((item) => item.id === "sector_constituents")?.state,
    "withheld",
    "one fresh classified constituent must not satisfy the two-member sector gate",
  );
  assert.equal(
    openingReassessment.stages.find((item) => item.id === "sector_ranking")?.state,
    "withheld",
    "insufficient sector coverage must not fabricate a sector ranking",
  );

  const unauthorizedClassification = buildOpeningReadiness({
    symbols: [symbol({ connectionState: "streaming", realMarketEventReceived: true, marketDataGateReady: true })],
    marketUniverse: reference({
      dataQuality: "degraded",
      classificationCoverageCount: 0,
      reason: "Security Master authorization is unavailable; definitions are discovery-only.",
    }),
    sectorPriority: sector(),
  });
  assert.equal(
    unauthorizedClassification.stages.find((item) => item.id === "trusted_classification")?.state,
    "blocked",
    "definition-only reference data must remain blocked from trusted classification",
  );
  assert.equal(
    unauthorizedClassification.stages.find((item) => item.id === "sector_ranking")?.state,
    "blocked",
    "sector ranking must remain blocked without trusted classification even when an individual live gate is ready",
  );

  const rankedButUnpromoted = buildOpeningReadiness({
    symbols: [
      symbol({ name: "NVDA", connectionState: "streaming", realMarketEventReceived: true, marketDataGateReady: true }),
      symbol({ name: "AMD", connectionState: "streaming", realMarketEventReceived: true, marketDataGateReady: true }),
    ],
    marketUniverse: reference(),
    sectorPriority: sector({
      state: "ranked",
      classifiedLiveSymbols: 2,
      rankedSectorCount: 1,
      reason: "Sector ranking is based on verified fixtures.",
    }),
  });
  assert.equal(
    rankedButUnpromoted.stages.find((item) => item.id === "sector_ranking")?.state,
    "ready",
    "a server-owned ranked sector may be shown as ready",
  );
  assert.equal(
    rankedButUnpromoted.stages.find((item) => item.id === "candidate_promotion")?.state,
    "withheld",
    "sector readiness alone must never fabricate a final or pre-breakout candidate",
  );

  console.log("opening readiness tests passed");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}