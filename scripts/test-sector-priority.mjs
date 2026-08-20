import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "sector-priority-test-"));
const outputPath = join(outputDirectory, "sectorPriority.cjs");
const now = new Date("2026-08-20T14:31:00.000Z");

function reference(symbol, sector, industryGroup = "Semiconductors") {
  return {
    symbol,
    eligibility: "eligible",
    sector,
    industryGroup,
    industry: "Semiconductor Devices",
    classificationSource: "Databento security master",
  };
}

function symbolStatus(symbol, overrides = {}) {
  return {
    symbol,
    connectionState: "streaming",
    marketFeedState: "streaming",
    scanHealth: {
      schedulerState: "scheduled",
      marketDataState: "fresh",
      marketDataGateReady: true,
    },
    liveIngestion: {
      conditions: {
        subscriptionVerified: true,
        realMarketEventReceived: true,
        enteredScoringWindow: true,
        scoringEligible: true,
      },
    },
    alphaRadar: {
      score: 82,
      scoreState: "available",
      dataQuality: "good",
      preBreakout: {
        dataFresh: true,
        state: "latent",
        latentScore: 100,
        breakoutCriticalScore: 80,
        confirmation: { status: "pending" },
      },
      momentum: { score: 86 },
      volumeIntensity: { score: 84 },
      orderFlowPressure: { score: 81, scoreEligible: true, freshness: "fresh" },
    },
    ...overrides,
  };
}

function ranking(symbol, rankingScore) {
  return {
    symbol,
    eligibility: "ranked",
    rankingScore,
    reason: "Fresh individual Alpha evidence is available.",
  };
}

function catalystRadar() {
  return {
    eventState: "unavailable",
    events: [],
    sourceStatuses: [],
  };
}

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/sectorPriority.ts"), "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(outputPath, output);

  const require = createRequire(import.meta.url);
  const { buildSectorPriority } = require(outputPath);

  const symbols = [
    symbolStatus("NVDA"),
    symbolStatus("MU"),
    symbolStatus("AMD"),
    symbolStatus("VRT"),
  ];
  const snapshot = buildSectorPriority({
    symbols,
    alphaRanking: {
      entries: [
        ranking("NVDA", 90),
        ranking("MU", 81),
        ranking("AMD", 78),
        ranking("VRT", 95),
      ],
    },
    references: [
      { symbol: "NVDA", reference: reference("NVDA", "Information Technology") },
      { symbol: "MU", reference: reference("MU", "Information Technology") },
      { symbol: "AMD", reference: reference("AMD", "Information Technology") },
      { symbol: "VRT", reference: reference("VRT", "Industrials", "Electrical Equipment") },
    ],
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });

  const technology = snapshot.sectors.find((sector) => sector.sector === "Information Technology");
  const industrials = snapshot.sectors.find((sector) => sector.sector === "Industrials");
  assert.equal(snapshot.state, "ranked");
  assert.deepEqual(
    snapshot.coverage.eligibleLivePopulation,
    ["AMD", "MU", "NVDA", "VRT"],
    "coverage must name the exact current verified live population",
  );
  assert.equal(technology?.eligibility, "ranked");
  assert.equal(technology?.constituentCount, 3);
  assert.equal(
    technology?.members[0]?.confirmationStatus,
    "pending",
    "sector members must preserve the live Alpha confirmation state without inventing confirmation",
  );
  assert.equal(industrials?.eligibility, "insufficient");
  assert.equal(snapshot.finalCandidates.length, 0, "missing independent inputs must fail closed before final-candidate promotion");
  assert.equal(snapshot.withheldCandidates.length, 3, "strong sector members must preserve their evidence and withheld reason");
  assert.equal(snapshot.withheldCandidates[0].symbol, "NVDA");
  assert.ok(
    snapshot.withheldCandidates[0].finalScore > snapshot.withheldCandidates[0].baseRankingScore,
    "a strong ranked sector must materially multiply the individual Alpha ranking",
  );
  assert.equal(
    snapshot.withheldCandidates[0].stage,
    "withheld",
    "options, fundamentals, valuation, and risk/reward must never be inferred for pre-breakout status",
  );
  assert.ok(
    snapshot.withheldCandidates[0].missing.includes("Authorized options-activity evidence"),
    "unavailable options activity must be explicit",
  );
  assert.ok(
    snapshot.latentCandidates.length <= 5,
    "the latent list must always be an upper bound rather than a minimum-size requirement",
  );

  const sixLatentSymbols = Array.from({ length: 6 }, (_, index) => symbolStatus(`LATENT${index + 1}`));
  const fivePerSector = buildSectorPriority({
    symbols: sixLatentSymbols,
    alphaRanking: {
      entries: sixLatentSymbols.map((status) => ranking(status.symbol, 90)),
    },
    references: sixLatentSymbols.map((status) => ({
      symbol: status.symbol,
      reference: reference(status.symbol, "Information Technology"),
    })),
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });
  assert.equal(
    fivePerSector.latentCandidates.length,
    5,
    "six equally qualified latent members in one ranked sector must retain only the top five",
  );
  assert.deepEqual(
    fivePerSector.latentCandidates.map((candidate) => candidate.finalRank),
    [1, 2, 3, 4, 5],
    "latent candidates must expose stable rank-within-sector ordering",
  );
  assert.deepEqual(
    fivePerSector.latentCandidates.map((candidate) => candidate.symbol),
    ["LATENT1", "LATENT2", "LATENT3", "LATENT4", "LATENT5"],
    "ties must resolve deterministically before the five-candidate cap is applied",
  );
  const lowScoreLatent = symbolStatus("LOWSCORE", {
    alphaRadar: {
      ...symbolStatus("LOWSCORE").alphaRadar,
      preBreakout: {
        ...symbolStatus("LOWSCORE").alphaRadar.preBreakout,
        latentScore: 60,
      },
    },
  });
  const latentScoreGate = buildSectorPriority({
    symbols: [symbolStatus("HIGHSCORE"), lowScoreLatent],
    alphaRanking: { entries: [ranking("HIGHSCORE", 90), ranking("LOWSCORE", 90)] },
    references: [
      { symbol: "HIGHSCORE", reference: reference("HIGHSCORE", "Information Technology") },
      { symbol: "LOWSCORE", reference: reference("LOWSCORE", "Information Technology") },
    ],
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });
  assert.deepEqual(
    latentScoreGate.latentCandidates.map((candidate) => candidate.symbol),
    ["HIGHSCORE"],
    "a low observed latent score must not enter the exported sector candidate list",
  );

  const noPeer = buildSectorPriority({
    symbols: [symbolStatus("VRT")],
    alphaRanking: { entries: [ranking("VRT", 95)] },
    references: [{ symbol: "VRT", reference: reference("VRT", "Industrials", "Electrical Equipment") }],
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });
  assert.equal(noPeer.state, "insufficient");
  assert.equal(noPeer.sectors[0].strength, null);
  assert.equal(noPeer.finalCandidates.length, 0, "one live stock can never fabricate a sector strength");
  assert.equal(noPeer.withheldCandidates.length, 0);

  const noLiveEvidence = buildSectorPriority({
    symbols: [symbolStatus("NVDA", {
      connectionState: "connected",
      marketFeedState: "stale",
      scanHealth: {
        schedulerState: "scheduled",
        marketDataState: "insufficient",
        marketDataGateReady: false,
      },
      alphaRadar: {
        score: null,
        scoreState: "insufficient",
        dataQuality: "missing",
        preBreakout: { dataFresh: false, state: "unavailable", confirmation: { status: "unavailable" } },
        momentum: { score: null },
        volumeIntensity: { score: null },
        orderFlowPressure: { score: null, scoreEligible: false, freshness: "missing" },
      },
    })],
    alphaRanking: { entries: [{ ...ranking("NVDA", 90), eligibility: "ineligible" }] },
    references: [{ symbol: "NVDA", reference: reference("NVDA", "Information Technology") }],
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });
  assert.equal(noLiveEvidence.state, "unavailable");
  assert.equal(noLiveEvidence.coverage.eligibleLiveSymbols, 0);
  assert.deepEqual(noLiveEvidence.coverage.eligibleLivePopulation, []);
  assert.equal(noLiveEvidence.finalCandidates.length, 0);
  assert.equal(noLiveEvidence.withheldCandidates.length, 0);
  assert.equal(noLiveEvidence.sectors[0].strength, null);

  const staleReference = buildSectorPriority({
    symbols: [symbolStatus("NVDA"), symbolStatus("MU")],
    alphaRanking: { entries: [ranking("NVDA", 90), ranking("MU", 81)] },
    references: [
      { symbol: "NVDA", reference: reference("NVDA", "Information Technology") },
      { symbol: "MU", reference: reference("MU", "Information Technology") },
    ],
    catalystRadar: catalystRadar(),
    referenceFresh: false,
    now,
  });
  assert.equal(staleReference.state, "insufficient");
  assert.equal(staleReference.coverage.rankedSectorCount, 0);
  assert.equal(staleReference.finalCandidates.length, 0);
  assert.equal(staleReference.withheldCandidates.length, 0);

  const broaderLiveCoverage = buildSectorPriority({
    symbols: [symbolStatus("NVDA")],
    additionalLiveSymbols: [symbolStatus("AVGO")],
    alphaRanking: {
      entries: [ranking("NVDA", 90), ranking("AVGO", 86)],
    },
    references: [
      { symbol: "NVDA", reference: reference("NVDA", "Information Technology") },
      { symbol: "AVGO", reference: reference("AVGO", "Information Technology") },
    ],
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });
  assert.equal(
    broaderLiveCoverage.sectors.find((sector) => sector.sector === "Information Technology")?.eligibility,
    "ranked",
    "an independently verified additional live service may broaden sector coverage",
  );
  assert.deepEqual(broaderLiveCoverage.coverage.eligibleLivePopulation, ["AVGO", "NVDA"]);

  const missingLiveEvent = buildSectorPriority({
    symbols: [symbolStatus("NVDA"), symbolStatus("AVGO", {
      liveIngestion: {
        conditions: {
          subscriptionVerified: true,
          realMarketEventReceived: false,
          enteredScoringWindow: false,
          scoringEligible: false,
        },
      },
    })],
    alphaRanking: { entries: [ranking("NVDA", 90), ranking("AVGO", 86)] },
    references: [
      { symbol: "NVDA", reference: reference("NVDA", "Information Technology") },
      { symbol: "AVGO", reference: reference("AVGO", "Information Technology") },
    ],
    catalystRadar: catalystRadar(),
    referenceFresh: true,
    now,
  });
  assert.equal(
    missingLiveEvent.sectors.find((sector) => sector.sector === "Information Technology")?.eligibility,
    "insufficient",
    "a reference classification cannot compensate for a missing independent live market event",
  );

  console.log("sector-first priority tests passed");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}