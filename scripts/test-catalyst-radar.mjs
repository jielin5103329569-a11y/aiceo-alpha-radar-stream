import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "catalyst-radar-test-"));
const outputPath = join(outputDirectory, "catalystRadar.cjs");

function freshAlphaRadar({ state = "pre_breakout", confirmation = "confirmed" } = {}) {
  const evidence = [
    { key: "price_momentum", label: "Fresh price momentum", satisfied: true, detail: "Positive." },
    { key: "volume_acceleration", label: "Volume acceleration", satisfied: true, detail: "Elevated." },
    { key: "order_flow_pressure", label: "Order-flow pressure", satisfied: true, detail: "Buy pressure." },
  ];
  return {
    score: 82,
    scoreState: "available",
    dataQuality: "good",
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
  return {
    symbol,
    alphaRadar: freshAlphaRadar(),
    marketFeedState: "streaming",
    scanHealth: {
      schedulerState: "scheduled",
      marketDataState: "fresh",
      marketDataGateReady: true,
    },
    reference: null,
  };
}

try {
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
  const now = new Date("2026-08-20T14:30:00.000Z");

  const unavailable = createCatalystRadar(now);
  assert.equal(unavailable.eventState, "unavailable");
  assert.equal(unavailable.events.length, 0, "unavailable sources must never synthesize events");
  assert.equal(unavailable.sourceStatuses.length, 5);
  for (const sourceStatus of unavailable.sourceStatuses) {
    assert.equal(sourceStatus.availability, "unavailable");
    assert.equal(sourceStatus.lastEventAt, null, "unavailable sources must not invent event timestamps");
    assert.equal(sourceStatus.authorized, false);
  }

  const marketOnly = buildOpportunityCenter([freshInput()], [{ symbol: "NVDA", reference: null }], now);
  assert.equal(marketOnly.opportunityCenter.opportunities[0].state, "PRE-BREAKOUT");
  assert.equal(marketOnly.opportunityCenter.opportunities[0].eventTime, null);
  assert.ok(
    marketOnly.opportunityCenter.opportunities[0].missingConfirmationItems.includes("Fresh authorized catalyst event"),
    "market-only setups must make the missing catalyst gate explicit",
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
  };
  const unavailableSector = calculateSectorConfirmation(null, []);
  assert.equal(
    fuseOpportunity(staleInput, catalystOnly, unavailableSector).state,
    "WATCH",
    "a catalyst alone must never produce a confirmed opportunity",
  );

  const staleCenter = buildOpportunityCenter([staleInput], [{ symbol: "NVDA", reference: null }], now);
  assert.equal(staleCenter.opportunityCenter.opportunities[0].freshness, "stale");
  assert.ok(
    staleCenter.opportunityCenter.opportunities[0].missingConfirmationItems.includes("Fresh complete protected market window"),
    "stale market data must invalidate the opportunity handoff",
  );

  const reference = {
    symbol: "NVDA",
    eligibility: "eligible",
    sector: "Technology",
    industryGroup: "Semiconductors",
    industry: "Semiconductors",
    classificationSource: "Trusted reference",
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