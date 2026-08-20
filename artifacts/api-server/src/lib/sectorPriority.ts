import type {
  AlphaRadarRankingEntry,
  AlphaRadarRankingSnapshot,
  RadarSymbolStatus,
} from "./databentoLive";
import type { CatalystRadarSnapshot } from "./catalystRadar";
import type { SecurityReference } from "./marketUniverse";

export type SectorPriorityState = "ranked" | "insufficient" | "unavailable";
export type SectorPriorityEligibility = "ranked" | "insufficient" | "unavailable";
export type SectorPriorityCandidateStage = "candidate" | "pre_breakout" | "withheld";

export type SectorPriorityMember = {
  symbol: string;
  rankWithinSector: number | null;
  individualAlphaScore: number | null;
  baseRankingScore: number | null;
  sectorWeightedScore: number | null;
  sectorMultiplier: number | null;
  eligibility: AlphaRadarRankingEntry["eligibility"];
  marketDataState: RadarSymbolStatus["scanHealth"]["marketDataState"];
  preBreakoutState: RadarSymbolStatus["alphaRadar"]["preBreakout"]["state"];
  reason: string;
};

export type SectorPrioritySector = {
  sector: string | null;
  industryGroup: string | null;
  rank: number | null;
  eligibility: SectorPriorityEligibility;
  strength: number | null;
  constituentCount: number;
  requiredConstituentCount: number;
  dataFresh: boolean;
  evidence: {
    momentum: number | null;
    volumeIntensity: number | null;
    orderFlowPressure: number | null;
    relativeStrength: number | null;
    catalyst: { available: boolean; reason: string };
    optionsActivity: { available: boolean; reason: string };
  };
  members: SectorPriorityMember[];
  reason: string;
};

export type SectorPriorityCandidate = {
  symbol: string;
  finalRank: number | null;
  sector: string | null;
  industryGroup: string | null;
  finalScore: number | null;
  sectorStrength: number | null;
  sectorMultiplier: number | null;
  baseRankingScore: number | null;
  stage: SectorPriorityCandidateStage;
  evidence: {
    marketFresh: boolean;
    sectorStrength: boolean;
    unfinishedExpansion: boolean;
    catalyst: boolean;
    moneyFlow: boolean;
    optionsActivity: boolean;
    fundamentals: boolean;
    valuationExpectation: boolean;
    riskReward: boolean;
  };
  missing: string[];
  reason: string;
};

export type SectorPrioritySnapshot = {
  generatedAt: Date;
  state: SectorPriorityState;
  coverage: {
    eligibleLiveSymbols: number;
    classifiedLiveSymbols: number;
    rankedSectorCount: number;
    requiredConstituentsPerSector: number;
    source: string;
    reason: string;
  };
  sectors: SectorPrioritySector[];
  finalCandidates: SectorPriorityCandidate[];
  preBreakoutCandidates: SectorPriorityCandidate[];
  withheldCandidates: SectorPriorityCandidate[];
  reason: string;
};

export type SectorPriorityInput = {
  symbols: RadarSymbolStatus[];
  alphaRanking: AlphaRadarRankingSnapshot;
  references: Array<{ symbol: string; reference: SecurityReference | null }>;
  catalystRadar: CatalystRadarSnapshot;
  referenceFresh: boolean;
  now?: Date;
};

const REQUIRED_CONSTITUENTS = 2;

type CandidateContext = {
  status: RadarSymbolStatus;
  ranking: AlphaRadarRankingEntry | null;
  reference: SecurityReference | null;
  trustedClassification: boolean;
  rankingEligible: boolean;
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (numeric.length === 0) return null;
  return round(numeric.reduce((total, value) => total + value, 0) / numeric.length);
}

function hasTrustedClassification(
  reference: SecurityReference | null,
  referenceFresh: boolean,
): reference is SecurityReference {
  return Boolean(
    referenceFresh
      && reference
      && reference.eligibility === "eligible"
      && reference.sector
      && reference.industryGroup
      && reference.industry
      && reference.classificationSource,
  );
}

function hasFreshRank(
  status: RadarSymbolStatus,
  ranking: AlphaRadarRankingEntry | null,
): boolean {
  return Boolean(
    ranking
      && ranking.eligibility === "ranked"
      && ranking.rankingScore !== null
      && status.connectionState === "streaming"
      && status.marketFeedState === "streaming"
      && status.scanHealth.schedulerState === "scheduled"
      && status.scanHealth.marketDataState === "fresh"
      && status.scanHealth.marketDataGateReady
      && status.alphaRadar.scoreState === "available"
      && status.alphaRadar.dataQuality === "good"
      && status.alphaRadar.preBreakout.dataFresh,
  );
}

function catalystAvailable(
  catalystRadar: CatalystRadarSnapshot,
  symbol: string,
  now: Date,
): boolean {
  if (catalystRadar.eventState !== "observed") return false;
  const event = catalystRadar.events.find((candidate) => candidate.symbol === symbol);
  if (!event || event.freshness !== "fresh" || event.dataQuality !== "good") return false;
  const source = catalystRadar.sourceStatuses.find((item) => item.category === event.category);
  if (
    !source
    || !source.authorized
    || source.availability !== "available"
    || source.freshness !== "fresh"
    || source.dataQuality !== "good"
    || source.source !== event.source
  ) {
    return false;
  }
  const eventAge = now.getTime() - event.observedAt.getTime();
  return eventAge >= 0 && eventAge <= 15 * 60 * 1_000;
}

function sectorCatalystStatus(
  members: CandidateContext[],
  catalystRadar: CatalystRadarSnapshot,
  now: Date,
): SectorPrioritySector["evidence"]["catalyst"] {
  const observed = members.some((member) => catalystAvailable(catalystRadar, member.status.symbol, now));
  return observed
    ? {
        available: true,
        reason: "At least one sector constituent has a fresh authorized catalyst event.",
      }
    : {
        available: false,
        reason: "No fresh authorized catalyst event is available for the live sector constituents.",
      };
}

function memberReason(context: CandidateContext): string {
  if (!context.trustedClassification) {
    return "Trusted fresh sector and industry classification is unavailable; this symbol cannot contribute to sector strength.";
  }
  if (!context.ranking) {
    return "No current individual Alpha Ranking entry is available.";
  }
  if (!context.rankingEligible) {
    return context.ranking.reason;
  }
  return "Fresh verified individual Alpha evidence is eligible for sector-first prioritization.";
}

function candidateMissingLabels(
  evidence: SectorPriorityCandidate["evidence"],
): string[] {
  const labels: Array<[keyof SectorPriorityCandidate["evidence"], string]> = [
    ["marketFresh", "Fresh complete protected market window"],
    ["sectorStrength", "Ranked sector strength"],
    ["unfinishedExpansion", "Unfinished expansion / pre-breakout state"],
    ["catalyst", "Fresh authorized catalyst event"],
    ["moneyFlow", "Fresh active order-flow evidence"],
    ["optionsActivity", "Authorized options-activity evidence"],
    ["fundamentals", "Authorized fundamentals / growth evidence"],
    ["valuationExpectation", "Authorized valuation / expectation evidence"],
    ["riskReward", "Authorized risk-reward evidence"],
  ];
  return labels.filter(([key]) => !evidence[key]).map(([, label]) => label);
}

function candidateReason(
  stage: SectorPriorityCandidateStage,
  missing: string[],
): string {
  if (stage === "pre_breakout") {
    return "Strong verified sector context, fresh individual market evidence, unfinished expansion, and all independent confirmation inputs are available.";
  }
  if (stage === "candidate") {
    return "This final candidate passed every independent confirmation input. Pre-breakout qualification remains separate until unfinished expansion is present.";
  }
  return `Final-candidate promotion is withheld: ${missing.join("; ")}.`;
}

function buildCandidate(
  context: CandidateContext,
  sector: SectorPrioritySector,
  member: SectorPriorityMember,
  catalystRadar: CatalystRadarSnapshot,
  now: Date,
): SectorPriorityCandidate {
  const alpha = context.status.alphaRadar;
  const marketFresh = context.rankingEligible;
  const sectorStrength = sector.eligibility === "ranked" && sector.strength !== null;
  const unfinishedExpansion = ["accelerating", "pre_breakout"].includes(alpha.preBreakout.state);
  const evidence = {
    marketFresh,
    sectorStrength,
    unfinishedExpansion,
    catalyst: catalystAvailable(catalystRadar, context.status.symbol, now),
    moneyFlow: alpha.orderFlowPressure.scoreEligible && alpha.orderFlowPressure.freshness === "fresh",
    optionsActivity: false,
    fundamentals: false,
    valuationExpectation: false,
    riskReward: false,
  };
  const missing = candidateMissingLabels(evidence);
  const finalCandidateComplete = (
    evidence.marketFresh
    && evidence.sectorStrength
    && evidence.catalyst
    && evidence.moneyFlow
    && evidence.optionsActivity
    && evidence.fundamentals
    && evidence.valuationExpectation
    && evidence.riskReward
  );
  const stage: SectorPriorityCandidateStage = finalCandidateComplete && evidence.unfinishedExpansion
    ? "pre_breakout"
    : finalCandidateComplete
      ? "candidate"
      : "withheld";

  return {
    symbol: context.status.symbol,
    finalRank: null,
    sector: sector.sector,
    industryGroup: sector.industryGroup,
    finalScore: member.sectorWeightedScore,
    sectorStrength: sector.strength,
    sectorMultiplier: member.sectorMultiplier,
    baseRankingScore: member.baseRankingScore,
    stage,
    evidence,
    missing,
    reason: candidateReason(stage, missing),
  };
}

/**
 * Produces a strictly server-owned hierarchy from current protected live
 * windows. Reference data can classify a symbol but can never supply market,
 * flow, catalyst, options, fundamentals, valuation, or risk/reward evidence.
 */
export function buildSectorPriority(input: SectorPriorityInput): SectorPrioritySnapshot {
  const now = input.now ?? new Date();
  const rankingBySymbol = new Map(input.alphaRanking.entries.map((entry) => [entry.symbol, entry]));
  const referenceBySymbol = new Map(input.references.map((item) => [item.symbol, item.reference]));
  const contexts = input.symbols.map((status): CandidateContext => {
    const ranking = rankingBySymbol.get(status.symbol) ?? null;
    const reference = referenceBySymbol.get(status.symbol) ?? null;
    return {
      status,
      ranking,
      reference,
      trustedClassification: hasTrustedClassification(reference, input.referenceFresh),
      rankingEligible: hasFreshRank(status, ranking),
    };
  });

  const groups = new Map<string, CandidateContext[]>();
  contexts.forEach((context) => {
    const group = context.trustedClassification && context.reference?.sector
      ? context.reference.sector
      : "__unclassified__";
    const existing = groups.get(group) ?? [];
    existing.push(context);
    groups.set(group, existing);
  });

  const sectors = [...groups.entries()].map(([group, members]): SectorPrioritySector => {
    const classified = group !== "__unclassified__";
    const eligibleMembers = members.filter((member) => member.rankingEligible);
    const sufficientMembers = classified && eligibleMembers.length >= REQUIRED_CONSTITUENTS;
    const momentum = sufficientMembers
      ? mean(eligibleMembers.map((member) => member.status.alphaRadar.momentum.score))
      : null;
    const volumeIntensity = sufficientMembers
      ? mean(eligibleMembers.map((member) => member.status.alphaRadar.volumeIntensity.score))
      : null;
    const orderFlowPressure = sufficientMembers
      ? mean(eligibleMembers.map((member) => member.status.alphaRadar.orderFlowPressure.score))
      : null;
    const relativeStrength = sufficientMembers
      ? mean(eligibleMembers.map((member) => member.ranking?.rankingScore ?? null))
      : null;
    const inputsComplete = [momentum, volumeIntensity, orderFlowPressure, relativeStrength]
      .every((value) => value !== null);
    const strength = sufficientMembers && inputsComplete
      ? round(
          (momentum ?? 0) * 0.25
          + (volumeIntensity ?? 0) * 0.25
          + (orderFlowPressure ?? 0) * 0.25
          + (relativeStrength ?? 0) * 0.25,
        )
      : null;
    const eligibility: SectorPriorityEligibility = strength !== null
      ? "ranked"
      : classified
        ? "insufficient"
        : "unavailable";
    const multiplier = strength === null ? null : round(0.75 + clamp(strength) / 100 * 0.5, 3);
    const membersSnapshot = members
      .map((context): SectorPriorityMember => {
        const baseRankingScore = context.ranking?.rankingScore ?? null;
        return {
        symbol: context.status.symbol,
        rankWithinSector: null,
        individualAlphaScore: context.status.alphaRadar.score,
        baseRankingScore,
        sectorWeightedScore:
          context.rankingEligible && multiplier !== null && baseRankingScore !== null
            ? round(baseRankingScore * multiplier)
            : null,
        sectorMultiplier:
          context.rankingEligible && multiplier !== null
            ? multiplier
            : null,
        eligibility: context.ranking?.eligibility ?? "ineligible",
        marketDataState: context.status.scanHealth.marketDataState,
        preBreakoutState: context.status.alphaRadar.preBreakout.state,
        reason: memberReason(context),
        };
      })
      .sort((left, right) => (
        (right.sectorWeightedScore ?? Number.NEGATIVE_INFINITY)
        - (left.sectorWeightedScore ?? Number.NEGATIVE_INFINITY)
      ) || left.symbol.localeCompare(right.symbol))
      .map((member, index) => ({
        ...member,
        rankWithinSector: member.sectorWeightedScore === null ? null : index + 1,
      }));
    const reference = members.find((member) => member.trustedClassification)?.reference ?? null;
    const reason = eligibility === "ranked"
      ? "Sector strength is calculated only from independent fresh constituent Alpha windows. Individual scores use this sector multiplier for final priority."
      : eligibility === "insufficient"
        ? `Sector has ${eligibleMembers.length}/${REQUIRED_CONSTITUENTS} required fresh eligible constituent windows; strength and final priorities are withheld.`
        : "Trusted fresh sector and industry classifications are unavailable; reference data cannot be treated as live sector evidence.";

    return {
      sector: reference?.sector ?? null,
      industryGroup: reference?.industryGroup ?? null,
      rank: null,
      eligibility,
      strength,
      constituentCount: members.length,
      requiredConstituentCount: REQUIRED_CONSTITUENTS,
      dataFresh: eligibleMembers.length > 0,
      evidence: {
        momentum,
        volumeIntensity,
        orderFlowPressure,
        relativeStrength,
        catalyst: sectorCatalystStatus(members, input.catalystRadar, now),
        optionsActivity: {
          available: false,
          reason: "No authorized options-activity source is configured; no options signal is inferred.",
        },
      },
      members: membersSnapshot,
      reason,
    };
  }).sort((left, right) => (
    (right.strength ?? Number.NEGATIVE_INFINITY) - (left.strength ?? Number.NEGATIVE_INFINITY)
  ) || (left.sector ?? "ZZZ").localeCompare(right.sector ?? "ZZZ"));

  let sectorRank = 0;
  const rankedSectors = sectors.map((sector) => ({
    ...sector,
    rank: sector.eligibility === "ranked" ? ++sectorRank : null,
  }));
  const sectorByName = new Map(
    rankedSectors
      .filter((sector): sector is SectorPrioritySector & { sector: string } => sector.sector !== null)
      .map((sector) => [sector.sector, sector]),
  );
  const evaluatedCandidates = contexts
    .flatMap((context) => {
      const reference = context.reference;
      if (!context.trustedClassification || !reference?.sector) return [];
      const sector = sectorByName.get(reference.sector);
      const member = sector?.members.find((item) => item.symbol === context.status.symbol);
      if (!sector || !member || sector.eligibility !== "ranked" || !context.rankingEligible) return [];
      return [buildCandidate(context, sector, member, input.catalystRadar, now)];
    })
    .sort((left, right) => (
      (right.finalScore ?? Number.NEGATIVE_INFINITY) - (left.finalScore ?? Number.NEGATIVE_INFINITY)
    ) || left.symbol.localeCompare(right.symbol));
  let finalRank = 0;
  const finalCandidates = evaluatedCandidates
    .filter((candidate) => candidate.stage !== "withheld")
    .map((candidate) => ({ ...candidate, finalRank: ++finalRank }));
  const preBreakoutCandidates = finalCandidates.filter((candidate) => candidate.stage === "pre_breakout");
  const withheldCandidates = evaluatedCandidates
    .filter((candidate) => candidate.stage === "withheld")
    .map((candidate) => ({ ...candidate, finalRank: null }));
  const rankedSectorCount = rankedSectors.filter((sector) => sector.eligibility === "ranked").length;
  const eligibleLiveSymbols = contexts.filter((context) => context.rankingEligible).length;
  const classifiedLiveSymbols = contexts.filter(
    (context) => context.rankingEligible && context.trustedClassification,
  ).length;
  const state: SectorPriorityState = rankedSectorCount > 0
    ? "ranked"
    : eligibleLiveSymbols > 0
      ? "insufficient"
      : "unavailable";
  const coverageReason = !input.referenceFresh
    ? "Fresh trusted reference classification is unavailable and cannot be used for sector grouping."
    : classifiedLiveSymbols === 0
      ? "No symbol has both a trusted classification and a fresh eligible live Alpha window."
      : rankedSectorCount === 0
        ? `Fresh classified coverage exists, but no sector meets the ${REQUIRED_CONSTITUENTS}-constituent minimum.`
        : "Sector strength uses only fresh verified protected live windows; unavailable data categories remain explicitly withheld.";
  const reason = state === "ranked"
    ? "Sector-first prioritization is active: final candidate order is based on individual Alpha strength multiplied by verified sector strength."
    : state === "insufficient"
      ? "Sector-first prioritization is withheld until enough independent fresh classified constituents are available."
      : "Sector-first prioritization is unavailable because no current fresh verified classified live windows are available.";

  return {
    generatedAt: now,
    state,
    coverage: {
      eligibleLiveSymbols,
      classifiedLiveSymbols,
      rankedSectorCount,
      requiredConstituentsPerSector: REQUIRED_CONSTITUENTS,
      source: "Databento EQUS.MINI live microstructure; Databento reference classification only",
      reason: coverageReason,
    },
    sectors: rankedSectors,
    finalCandidates,
    preBreakoutCandidates,
    withheldCandidates,
    reason,
  };
}