import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "catalyst-radar-test-"));
const outputPath = join(outputDirectory, "catalystRadar.cjs");

function freshAlphaRadar({ state = "breakout_critical", confirmation = "confirmed" } = {}) {
  const evidence = [
    { key: "price_momentum", label: "Fresh price momentum", satisfied: true, detail: "Positive." },
    { key: "volume_acceleration", label: "Volume acceleration", satisfied: true, detail: "Elevated." },
    { key: "order_flow_pressure", label: "Order-flow pressure", satisfied: true, detail: "Buy pressure." },
  ];
  return {
    score: 82,
    scoreState: "available",
    dataQuality: "good",
    scan: {
      lastScannedAt: new Date("2026-08-20T14:30:00.000Z"),
    },
    momentum: {
      value: 1.2,
    },
    alphaVelocity: {
      rate30s: 12,
    },
    changeIndicators: {
      momentumAcceleration: 9,
      volumeAcceleration: 8,
      orderFlowShift: 7,
      spreadTightening: 6,
    },
    preBreakout: {
      state,
      dataFresh: true,
      confirmation: {
        status: confirmation,
        evidence,
        missingEvidence: confirmation === "confirmed" ? [] : ["Persistent multi-scan trajectory"],
        reason: "Deterministic test confirmation.",
      },
    },
  };
}

function freshInput(symbol = "NVDA") {
  const scanId = "shared-scan-2026-08-20T14:30:00.000Z";
  return {
    scanId,
    symbol,
    alphaRadar: freshAlphaRadar(),
    marketFeedState: "streaming",
    scanHealth: {
      schedulerState: "scheduled",
      marketDataState: "fresh",
      marketDataGateReady: true,
    },
    marketWindowSettlement: {
      scanId,
      settledAt: new Date("2026-08-20T14:30:00.000Z"),
      quote: true,
      trade: true,
      volume: true,
      heartbeat: true,
      complete: true,
      missingSegments: [],
    },
    reference: null,
  };
}

try {
  writeFileSync(
    join(outputDirectory, "logger.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.logger = { warn() {} };',
  );
  const secSource = readFileSync(resolve("artifacts/api-server/src/lib/secEdgarCatalyst.ts"), "utf8");
  writeFileSync(join(outputDirectory, "secEdgarCatalyst.js"), typescript.transpileModule(secSource, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const source = readFileSync(resolve("artifacts/api-server/src/lib/catalystRadar.ts"), "utf8");
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
    buildOpportunityCenter,
    calculateSectorConfirmation,
    createCatalystRadar,
    fuseOpportunity,
  } = require(outputPath);
  const {
    parseSecEdgarEvents,
    secEdgarCatalyst,
    SEC_EDGAR_COMPANIES,
  } = require(join(outputDirectory, "secEdgarCatalyst.js"));
  const now = new Date("2026-08-20T14:30:00.000Z");

  const unavailable = createCatalystRadar(now);
  assert.equal(unavailable.eventState, "unavailable");
  assert.equal(unavailable.events.length, 0, "unavailable sources must never synthesize events");
  assert.equal(unavailable.sourceStatuses.length, 5);
  for (const sourceStatus of unavailable.sourceStatuses.filter((sourceStatus) => sourceStatus.category !== "sec_filing")) {
    assert.equal(sourceStatus.readiness, "unconfigured");
    assert.equal(sourceStatus.lastEventAt, null, "unavailable sources must not invent event timestamps");
    assert.equal(sourceStatus.authorized, false);
  }
  assert.equal(unavailable.sourceStatuses.find((sourceStatus) => sourceStatus.category === "sec_filing").authorized, true);
  assert.deepEqual(
    Object.fromEntries(SEC_EDGAR_COMPANIES.map((company) => [company.symbol, company.cik])),
    {
      NVDA: "0001045810",
      MU: "0000723125",
      VRT: "0001674101",
      CRDO: "0001807794",
      AMD: "0000002488",
    },
  );
  await secEdgarCatalyst.poll(async () => new Response(JSON.stringify({
    name: "No filing fixture",
    filings: { recent: { accessionNumber: [], filingDate: [], acceptanceDateTime: [], form: [], primaryDocument: [] } },
  }), { status: 200, headers: { "Content-Type": "application/json" } }), now);
  const noEvent = createCatalystRadar(now);
  assert.equal(noEvent.eventState, "unavailable", "configuration and a successful empty poll must not create an event");
  assert.equal(noEvent.events.length, 0);
  assert.equal(noEvent.sourceStatuses.find((sourceStatus) => sourceStatus.category === "sec_filing").readiness, "ready");

  const parsed8K = parseSecEdgarEvents(SEC_EDGAR_COMPANIES[0], {
    name: "NVIDIA CORP",
    filings: { recent: {
      accessionNumber: ["0001045810-26-000001", "0001045810-26-000002"],
      filingDate: ["2026-08-20", "2026-08-20"],
      acceptanceDateTime: ["20260820142500Z", "20260820100000Z"],
      form: ["8-K", "10-Q"],
      primaryDocument: ["nvda-8k.htm", "nvda-10q.htm"],
    } },
  }, now);
  assert.equal(parsed8K[0].formType, "8-K");
  assert.equal(parsed8K[0].freshness, "fresh");
  assert.equal(parsed8K[0].source, "SEC EDGAR");
  assert.equal(parsed8K[0].filedAt.toISOString(), "2026-08-20T14:25:00.000Z");
  assert.equal(parsed8K[0].receivedAt.toISOString(), now.toISOString());
  assert.equal(parsed8K[0].lagged, false);
  assert.equal(
    parsed8K[0].filingUrl,
    "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/nvda-8k.htm",
  );
  assert.equal(parsed8K[1].formType, "10-Q");
  assert.equal(parsed8K[1].freshness, "insufficient", "10-Q metadata is a filing record, not a catalyst trade signal");

  const marketOnly = buildOpportunityCenter([freshInput()], [{ symbol: "NVDA", reference: null }], now);
  assert.equal(marketOnly.opportunityCenter.opportunities[0].state, "PRE-BREAKOUT");
  assert.equal(marketOnly.opportunityCenter.opportunities[0].eventTime, null);
  assert.ok(
    marketOnly.opportunityCenter.opportunities[0].missingConfirmationItems.includes("Fresh authorized catalyst event"),
    "market-only setups must make the missing catalyst gate explicit",
  );
  assert.equal(
    marketOnly.opportunityCenter.opportunities[0].direction,
    "upside",
    "a fresh positive market window should expose an observational direction",
  );
  assert.equal(
    marketOnly.opportunityCenter.opportunities[0].alphaVelocity30s,
    12,
    "opportunity rows must retain fresh Alpha speed instead of deriving a new score",
  );
  assert.equal(
    marketOnly.opportunityCenter.opportunities[0].acceleration,
    7.5,
    "opportunity rows must expose transparent average component acceleration",
  );
  assert.equal(
    marketOnly.opportunityCenter.opportunities[0].triggerAt?.toISOString(),
    freshInput().marketWindowSettlement.settledAt.toISOString(),
    "market-only opportunities must retain the shared protected-universe settlement time",
  );
  assert.equal(
    marketOnly.opportunityCenter.opportunities[0].alertReady,
    false,
    "a market-only PRE-BREAKOUT remains in-app alert-gated without independent catalyst and sector confirmation",
  );

  const catalystOnly = {
    ...unavailable,
    eventState: "observed",
    availableSourceCount: 1,
    events: [{
      id: "real-event",
      symbol: "NVDA",
      category: "company_news",
      observedAt: now,
      freshness: "fresh",
      source: "Authorized test provider",
      summary: "Real authorized event fixture.",
      dataQuality: "good",
    }],
  };
  const authorizedCatalyst = {
    ...catalystOnly,
    sourceStatuses: catalystOnly.sourceStatuses.map((sourceStatus) => (
      sourceStatus.category === "company_news"
        ? {
            ...sourceStatus,
            availability: "available",
            authorized: true,
            source: "Authorized test provider",
            freshness: "fresh",
            dataQuality: "good",
            lastEventAt: now,
          }
        : sourceStatus
    )),
  };
  const staleInput = {
    ...freshInput(),
    marketFeedState: "stale",
    scanHealth: {
      schedulerState: "scheduled",
      marketDataState: "stale",
      marketDataGateReady: false,
    },
    marketWindowSettlement: {
      ...freshInput().marketWindowSettlement,
      quote: false,
      complete: false,
      missingSegments: ["quote"],
    },
  };
  const unavailableSector = calculateSectorConfirmation(null, []);
  assert.equal(
    fuseOpportunity(staleInput, catalystOnly, unavailableSector).state,
    "WATCH",
    "a catalyst alone must never produce a confirmed opportunity",
  );

  const staleCenter = buildOpportunityCenter([staleInput], [{ symbol: "NVDA", reference: null }], now);
  assert.equal(staleCenter.opportunityCenter.opportunities[0].freshness, "stale");
  assert.equal(
    staleCenter.opportunityCenter.opportunities[0].triggerAt?.toISOString(),
    staleInput.marketWindowSettlement.settledAt.toISOString(),
    "an incomplete opportunity must retain the shared cycle timestamp while remaining gated",
  );
  assert.ok(
    staleCenter.opportunityCenter.opportunities[0].missingConfirmationItems.includes("Fresh complete protected market window"),
    "stale market data must invalidate the opportunity handoff",
  );
  assert.ok(
    staleCenter.opportunityCenter.opportunities[0].missingConfirmationItems.includes("Fresh protected quote segment"),
    "the opportunity handoff must name the exact missing protected-market segment",
  );

  const reference = {
    symbol: "NVDA",
    eligibility: "eligible",
    sector: "Technology",
    industryGroup: "Semiconductors",
    industry: "Semiconductors",
    classificationSource: "Trusted reference",
    classificationAvailability: "available",
  };
  const sector = calculateSectorConfirmation(reference, [{
    symbol: "MU",
    reference: { ...reference, symbol: "MU" },
    marketFresh: true,
    independentEvidenceCount: 3,
  }]);
  assert.equal(sector.status, "insufficient");
  assert.ok(sector.missing[0].includes("two fresh eligible"));

  const confirmedSector = calculateSectorConfirmation(reference, [
    {
      symbol: "MU",
      reference: { ...reference, symbol: "MU" },
      marketFresh: true,
      independentEvidenceCount: 3,
    },
    {
      symbol: "AMD",
      reference: { ...reference, symbol: "AMD" },
      marketFresh: true,
      independentEvidenceCount: 3,
    },
  ]);
  assert.equal(confirmedSector.status, "confirmed");
  assert.equal(
    fuseOpportunity(freshInput(), authorizedCatalyst, confirmedSector, now).state,
    "CONFIRMED",
    "confirmation requires independent catalyst, market, Alpha, and sector evidence to converge",
  );
  assert.equal(
    fuseOpportunity(freshInput(), authorizedCatalyst, confirmedSector, now).alertReady,
    true,
    "only complete independent confirmation should reach the in-app alert-ready state",
  );
  assert.equal(
    fuseOpportunity(staleInput, catalystOnly, unavailableSector, now).direction,
    "unavailable",
    "stale or incomplete market windows must withhold direction rather than retain a directional label",
  );
  assert.equal(
    fuseOpportunity(
      freshInput(),
      {
        ...authorizedCatalyst,
        events: [{ ...authorizedCatalyst.events[0], observedAt: new Date(now.getTime() - 16 * 60_000) }],
      },
      confirmedSector,
      now,
    ).state,
    "PRE-BREAKOUT",
    "an old catalyst event cannot satisfy a confirmed opportunity gate",
  );
  assert.equal(
    calculateSectorConfirmation(reference, [
      {
        symbol: "MU",
        reference: { ...reference, symbol: "MU" },
        marketFresh: true,
        independentEvidenceCount: 3,
      },
      {
        symbol: "CRDO",
        reference: { ...reference, symbol: "CRDO", classificationSource: null },
        marketFresh: true,
        independentEvidenceCount: 3,
      },
    ]).freshEligiblePeerCount,
    1,
    "peers without trusted classification provenance must not count as confirmation",
  );

  console.log("Catalyst Radar regression tests passed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}