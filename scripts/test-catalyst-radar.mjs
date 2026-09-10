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
    volumeIntensity: {
      value: 1.25,
      available: true,
      freshness: "fresh",
    },
    orderFlowPressure: {
      value: 18,
      available: true,
      freshness: "fresh",
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
  for (const [input, outputName] of [
    ["artifacts/api-server/src/lib/signalValidationCore.ts", "signalValidationCore.js"],
    ["artifacts/api-server/src/lib/sec8kTimeliness.ts", "sec8kTimeliness.js"],
  ]) {
    writeFileSync(join(outputDirectory, outputName), typescript.transpileModule(
      readFileSync(resolve(input), "utf8"),
      {
        compilerOptions: {
          module: typescript.ModuleKind.CommonJS,
          target: typescript.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText);
  }
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
  const {
    isTimelySec8K,
    SEC_8K_TIMELINESS_RULE_VERSION,
  } = require(join(outputDirectory, "sec8kTimeliness.js"));
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
      acceptanceDateTime: ["20260820132500Z", "20260820100000Z"],
      form: ["8-K", "10-Q"],
      primaryDocument: ["nvda-8k.htm", "nvda-10q.htm"],
    } },
  }, now);
  assert.equal(parsed8K[0].formType, "8-K");
  assert.equal(parsed8K[0].freshness, "fresh");
  assert.equal(parsed8K[0].source, "SEC EDGAR");
  assert.equal(parsed8K[0].filedAt.toISOString(), "2026-08-20T13:25:00.000Z");
  assert.equal(parsed8K[0].receivedAt.toISOString(), now.toISOString());
  assert.equal(parsed8K[0].lagged, true);
  assert.equal(
    parsed8K[0].filingUrl,
    "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/nvda-8k.htm",
  );
  assert.equal(parsed8K[1].formType, "10-Q");
  assert.equal(parsed8K[1].freshness, "insufficient", "10-Q metadata is a filing record, not a catalyst trade signal");
  assert.equal(SEC_8K_TIMELINESS_RULE_VERSION, "sec-8k-rth-v1");
  assert.equal(
    isTimelySec8K(
      new Date("2026-09-03T12:03:56.000Z"),
      new Date("2026-09-09T23:30:00.000Z"),
    ),
    false,
    "the September 3 NVDA 8-K must not be timely on September 9, including after RTH close",
  );
  assert.equal(
    isTimelySec8K(
      new Date("2026-09-04T21:00:00.000Z"),
      new Date("2026-09-07T14:00:00.000Z"),
    ),
    false,
    "a filing must not become timely on a market holiday with no current RTH",
  );
  assert.equal(
    isTimelySec8K(
      new Date("2026-09-04T21:00:00.000Z"),
      new Date("2026-09-08T14:00:00.000Z"),
    ),
    true,
    "the first full RTH after a Friday post-close filing must be timely after a Monday holiday",
  );

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
  const failedCatalystEvidence = marketOnly.opportunityCenter.opportunities[0].evidenceChain.find(
    (item) => item.key === "authorized_catalyst",
  );
  assert.equal(failedCatalystEvidence.satisfied, false);
  assert.equal(failedCatalystEvidence.source, "SEC EDGAR");
  assert.equal(
    failedCatalystEvidence.detail,
    "SEC EDGAR is connected, but no timely 8-K is available for this symbol.",
  );
  assert.equal(marketOnly.opportunityCenter.opportunities[0].alertReady, false);
  assert.equal(marketOnly.opportunityCenter.opportunities[0].volume_vs_avg, 1.25);
  assert.equal(marketOnly.opportunityCenter.opportunities[0].tape_bias, "主动偏买");

  const protectedSymbols = ["NVDA", "MU", "VRT", "CRDO", "AMD"];
  const splitCycleInputs = protectedSymbols.map((symbol) => freshInput(symbol));
  splitCycleInputs[2] = {
    ...splitCycleInputs[2],
    alphaRadar: {
      ...splitCycleInputs[2].alphaRadar,
      score: null,
      scoreState: "insufficient",
      dataQuality: "insufficient",
      momentum: {
        ...splitCycleInputs[2].alphaRadar.momentum,
        value: null,
      },
      preBreakout: {
        ...splitCycleInputs[2].alphaRadar.preBreakout,
        dataFresh: false,
        confirmation: {
          ...splitCycleInputs[2].alphaRadar.preBreakout.confirmation,
          status: "pending",
          reason: "Alpha direction is unavailable.",
        },
      },
    },
  };
  const coherentCycle = buildOpportunityCenter(
    splitCycleInputs,
    protectedSymbols.map((symbol) => ({ symbol, reference: null })),
    now,
  );
  assert.equal(coherentCycle.opportunityCenter.scanId, splitCycleInputs[0].scanId);
  assert.ok(
    coherentCycle.opportunityCenter.opportunities.every(
      (opportunity) => opportunity.scanId === splitCycleInputs[0].scanId,
    ),
    "all five protected opportunities must retain one shared scanId",
  );
  const vrtOpportunity = coherentCycle.opportunityCenter.opportunities.find(
    (opportunity) => opportunity.symbol === "VRT",
  );
  assert.equal(
    vrtOpportunity?.freshness,
    "fresh",
    "a complete VRT market settlement cannot become insufficient because Alpha direction is unavailable",
  );
  assert.equal(vrtOpportunity?.marketState, "fresh");
  assert.equal(vrtOpportunity?.direction, "unavailable");
  assert.equal(vrtOpportunity?.alertReady, false);
  assert.ok(
    coherentCycle.opportunityCenter.opportunities.every((opportunity) => {
      const settlement = splitCycleInputs.find((input) => input.symbol === opportunity.symbol)
        ?.marketWindowSettlement;
      return opportunity.marketState === "fresh"
        || (settlement?.missingSegments.length ?? 0) > 0;
    }),
    "an insufficient market window must identify at least one missing protected segment",
  );
  assert.ok(
    coherentCycle.opportunityCenter.opportunities.every((opportunity) => {
      const settlement = splitCycleInputs.find((input) => input.symbol === opportunity.symbol)
        ?.marketWindowSettlement;
      return opportunity.marketState !== "fresh"
        || (
          settlement?.complete === true
          && settlement.missingSegments.length === 0
          && settlement.volume === true
        );
    }),
    "fresh market-window presentation must fail when volume or any other segment is missing",
  );
  const insufficientTFlow = fuseOpportunity(
    {
      ...freshInput(),
      marketFeedState: "stale",
      scanHealth: {
        schedulerState: "scheduled",
        marketDataState: "stale",
        marketDataGateReady: false,
      },
    },
    noEvent,
    calculateSectorConfirmation(freshInput(), [{ symbol: "NVDA", reference: null }], now),
    now,
  );
  assert.equal(insufficientTFlow.volume_vs_avg, null);
  assert.equal(insufficientTFlow.tape_bias, "不明");
  assert.equal(insufficientTFlow.alertReady, false);
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