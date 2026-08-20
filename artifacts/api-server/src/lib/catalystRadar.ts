import type {
  AlphaRadarSnapshot,
  PreBreakoutConfirmationEvidence,
} from "./alphaRadar";
import type { MarketFeedState } from "./marketFeed";
import type { SecurityReference } from "./marketUniverse";

export type CatalystCategory =
  | "company_news"
  | "earnings_guidance"
  | "fda_clinical_regulatory"
  | "partnership_order_ma"
  | "sec_filing";

export type CatalystSourceAvailability =
  | "unavailable"
  | "available"
  | "stale"
  | "blocked";
export type CatalystFreshness = "fresh" | "delayed" | "stale" | "insufficient" | "missing";
export type CatalystDataQuality = "good" | "degraded" | "unavailable";
export type CatalystEventState = "unavailable" | "observed";
export type OpportunityState = "WATCH" | "PRE-BREAKOUT" | "CONFIRMED";
export type OpportunityFreshness = "fresh" | "stale" | "insufficient" | "missing";
export type SectorConfirmationStatus = "confirmed" | "insufficient" | "unavailable";
export type OpportunityDirection = "upside" | "downside" | "neutral" | "unavailable";

export type CatalystSourceStatus = {
  category: CatalystCategory;
  label: string;
  availability: CatalystSourceAvailability;
  authorized: boolean;
  source: string | null;
  freshness: CatalystFreshness;
  dataQuality: CatalystDataQuality;
  lastEventAt: Date | null;
  reason: string;
};

export type CatalystEvent = {
  id: string;
  symbol: string;
  category: CatalystCategory;
  observedAt: Date;
  freshness: CatalystFreshness;
  source: string;
  summary: string;
  dataQuality: CatalystDataQuality;
};

export type CatalystEvidence = {
  key: string;
  category: "catalyst" | "market_microstructure" | "confirmation";
  label: string;
  satisfied: boolean;
  independent: boolean;
  freshness: CatalystFreshness;
  source: string;
  detail: string;
};

export type SectorConfirmation = {
  status: SectorConfirmationStatus;
  sector: string | null;
  industry: string | null;
  trustedClassification: boolean;
  freshEligiblePeerCount: number;
  evidence: CatalystEvidence[];
  missing: string[];
  reason: string;
};

export type CatalystRadarSnapshot = {
  generatedAt: Date;
  eventState: CatalystEventState;
  sourceCount: number;
  availableSourceCount: number;
  sourceStatuses: CatalystSourceStatus[];
  events: CatalystEvent[];
  reason: string;
};

export type Opportunity = {
  symbol: string;
  eventTime: Date | null;
  triggerAt: Date | null;
  freshness: OpportunityFreshness;
  direction: OpportunityDirection;
  alphaVelocity30s: number | null;
  acceleration: number | null;
  catalystStatus: CatalystSourceAvailability;
  evidenceCount: number;
  evidenceChain: CatalystEvidence[];
  state: OpportunityState;
  marketState: "fresh" | "stale" | "insufficient" | "offline";
  sectorConfirmation: SectorConfirmation;
  missingConfirmationItems: string[];
  alertReady: boolean;
  alertReadyReason: string;
  reason: string;
};

export type OpportunityCenterSnapshot = {
  generatedAt: Date;
  opportunities: Opportunity[];
  reason: string;
};

export type CatalystRadarInput = {
  symbol: string;
  alphaRadar: AlphaRadarSnapshot;
  marketFeedState: MarketFeedState;
  scanHealth: {
    schedulerState: "inactive" | "scheduled" | "delayed";
    marketDataState: "fresh" | "stale" | "offline" | "insufficient";
    marketDataGateReady: boolean;
  };
  reference: SecurityReference | null;
};

const CATEGORY_DEFINITIONS: Array<Pick<CatalystSourceStatus, "category" | "label">> = [
  { category: "company_news", label: "Company news" },
  { category: "earnings_guidance", label: "Earnings / guidance" },
  { category: "fda_clinical_regulatory", label: "FDA / clinical / regulatory" },
  { category: "partnership_order_ma", label: "Partnership / order / M&A" },
  { category: "sec_filing", label: "SEC filing" },
];
const CATALYST_EVENT_MAX_AGE_MS = 15 * 60 * 1_000;

function hasTrustedClassification(reference: SecurityReference | null): reference is SecurityReference {
  return Boolean(
    reference
      && reference.eligibility === "eligible"
      && reference.sector
      && reference.industryGroup
      && reference.industry
      && reference.classificationSource,
  );
}

function unavailableSource(
  definition: Pick<CatalystSourceStatus, "category" | "label">,
): CatalystSourceStatus {
  return {
    ...definition,
    availability: "unavailable",
    authorized: false,
    source: null,
    freshness: "missing",
    dataQuality: "unavailable",
    lastEventAt: null,
    reason: "No authorized external source is configured; no catalyst event is being inferred.",
  };
}

function sourceStatuses(): CatalystSourceStatus[] {
  return CATEGORY_DEFINITIONS.map(unavailableSource);
}

function marketFresh(input: CatalystRadarInput): boolean {
  return input.marketFeedState === "streaming"
    && input.scanHealth.schedulerState === "scheduled"
    && input.scanHealth.marketDataState === "fresh"
    && input.scanHealth.marketDataGateReady
    && input.alphaRadar.scoreState === "available"
    && input.alphaRadar.dataQuality === "good"
    && input.alphaRadar.score !== null
    && input.alphaRadar.preBreakout.dataFresh;
}

function evidenceFreshness(input: CatalystRadarInput): CatalystFreshness {
  if (marketFresh(input)) return "fresh";
  if (input.marketFeedState === "offline") return "missing";
  if (input.scanHealth.marketDataState === "stale") return "stale";
  return "insufficient";
}

function opportunityFreshness(freshness: CatalystFreshness): OpportunityFreshness {
  if (freshness === "fresh") return "fresh";
  if (freshness === "stale") return "stale";
  if (freshness === "missing") return "missing";
  return "insufficient";
}

function opportunityDirection(input: CatalystRadarInput, liveMarket: boolean): OpportunityDirection {
  if (!liveMarket || input.alphaRadar.momentum.value === null) return "unavailable";
  if (input.alphaRadar.momentum.value > 0) return "upside";
  if (input.alphaRadar.momentum.value < 0) return "downside";
  return "neutral";
}

function averageAcceleration(input: CatalystRadarInput, liveMarket: boolean): number | null {
  if (!liveMarket) return null;
  const values = [
    input.alphaRadar.changeIndicators.momentumAcceleration,
    input.alphaRadar.changeIndicators.volumeAcceleration,
    input.alphaRadar.changeIndicators.orderFlowShift,
    input.alphaRadar.changeIndicators.spreadTightening,
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

function marketEvidence(
  input: CatalystRadarInput,
  freshness: CatalystFreshness,
): CatalystEvidence[] {
  const confirmation = input.alphaRadar.preBreakout.confirmation;
  const evidence = confirmation.evidence.length > 0
    ? confirmation.evidence
    : [];
  return evidence.map((item: PreBreakoutConfirmationEvidence) => ({
    key: item.key,
    category: "market_microstructure" as const,
    label: item.label,
    satisfied: item.satisfied && marketFresh(input),
    independent: true,
    freshness,
    source: "Databento live microstructure",
    detail: marketFresh(input)
      ? item.detail
      : "This market evidence is withheld because the protected live window is not fresh and complete.",
  }));
}

export function calculateSectorConfirmation(
  reference: SecurityReference | null,
  peers: Array<{
    symbol: string;
    reference: SecurityReference | null;
    marketFresh: boolean;
    independentEvidenceCount: number;
  }>,
): SectorConfirmation {
  const referenceSector = reference?.sector ?? null;
  const referenceIndustry = reference?.industry ?? null;
  const trustedClassification = hasTrustedClassification(reference);
  if (!trustedClassification || !reference) {
    return {
      status: "unavailable",
      sector: referenceSector,
      industry: referenceIndustry,
      trustedClassification: false,
      freshEligiblePeerCount: 0,
      evidence: [],
      missing: ["Trusted sector and industry classification"],
      reason: "Sector and industry confirmation is unavailable without a fresh trusted classification.",
    };
  }

  const matchingPeers = peers.filter((peer) => (
    peer.symbol !== reference.symbol
    && hasTrustedClassification(peer.reference)
    && peer.reference.sector === reference.sector
    && peer.reference.industry === reference.industry
    && peer.marketFresh
    && peer.independentEvidenceCount >= 2
  ));
  const evidence = matchingPeers.map((peer) => ({
    key: `peer_${peer.symbol}`,
    category: "confirmation" as const,
    label: `${peer.symbol} fresh eligible peer`,
    satisfied: true,
    independent: true,
    freshness: "fresh" as const,
    source: "Databento live microstructure",
    detail: `${peer.symbol} has fresh eligible ${reference.industry} evidence with ${peer.independentEvidenceCount} independent market factors.`,
  }));
  if (matchingPeers.length < 2) {
    return {
      status: "insufficient",
      sector: reference.sector,
      industry: reference.industry,
      trustedClassification: true,
      freshEligiblePeerCount: matchingPeers.length,
      evidence,
      missing: ["At least two fresh eligible same-industry peers"],
      reason: "Classification is trusted, but fresh eligible peer evidence is insufficient.",
    };
  }
  return {
    status: "confirmed",
    sector: reference.sector,
    industry: reference.industry,
    trustedClassification: true,
    freshEligiblePeerCount: matchingPeers.length,
    evidence,
    missing: [],
    reason: "Trusted classification and fresh eligible same-industry peer evidence are available.",
  };
}

function authorizedFreshCatalystEvent(
  catalyst: CatalystRadarSnapshot,
  symbol: string,
  now: Date,
): CatalystEvent | null {
  if (catalyst.eventState !== "observed") return null;
  const event = catalyst.events.find((candidate) => candidate.symbol === symbol);
  if (!event || event.freshness !== "fresh" || event.dataQuality !== "good") return null;
  const sourceStatus = catalyst.sourceStatuses.find((source) => source.category === event.category);
  if (
    !sourceStatus
    || !sourceStatus.authorized
    || sourceStatus.availability !== "available"
    || sourceStatus.freshness !== "fresh"
    || sourceStatus.dataQuality !== "good"
    || !sourceStatus.source
    || sourceStatus.source !== event.source
  ) {
    return null;
  }
  const observedAt = event.observedAt.getTime();
  const ageMs = now.getTime() - observedAt;
  return Number.isFinite(observedAt) && ageMs >= 0 && ageMs <= CATALYST_EVENT_MAX_AGE_MS
    ? event
    : null;
}

export function fuseOpportunity(
  input: CatalystRadarInput,
  catalyst: CatalystRadarSnapshot,
  sectorConfirmation: SectorConfirmation,
  now = new Date(),
): Opportunity {
  const freshness = evidenceFreshness(input);
  const liveMarket = marketFresh(input);
  const marketEvidenceItems = marketEvidence(input, freshness);
  const satisfiedMarketEvidence = marketEvidenceItems.filter((item) => item.satisfied);
  const preBreakout = input.alphaRadar.preBreakout;
  const hasMarketSetup = liveMarket
    && satisfiedMarketEvidence.length >= 2
    && ["accelerating", "pre_breakout", "confirmed"].includes(preBreakout.state);
  const catalystEvent = authorizedFreshCatalystEvent(catalyst, input.symbol, now);
  const catalystSatisfied = catalystEvent !== null;
  const confirmationSatisfied = preBreakout.confirmation.status === "confirmed";
  const independentlyConfirmed = catalystSatisfied
    && hasMarketSetup
    && confirmationSatisfied
    && sectorConfirmation.status === "confirmed";
  const state: OpportunityState = independentlyConfirmed
    ? "CONFIRMED"
    : hasMarketSetup
      ? "PRE-BREAKOUT"
      : "WATCH";
  const direction = opportunityDirection(input, liveMarket);
  const acceleration = averageAcceleration(input, liveMarket);
  const alertReady = independentlyConfirmed;
  const alertReadyReason = alertReady
    ? "Fresh independent catalyst, market, Alpha, and sector evidence are complete for in-app alert handoff."
    : "In-app alert handoff remains blocked until independent catalyst, market, Alpha, and sector confirmation all converge.";

  const evidenceChain: CatalystEvidence[] = [
    {
      key: "authorized_catalyst",
      category: "catalyst",
      label: "Fresh authorized catalyst",
      satisfied: Boolean(catalystSatisfied),
      independent: true,
      freshness: catalystEvent?.freshness ?? "missing",
      source: catalystEvent?.source ?? "No authorized catalyst source",
      detail: catalystEvent?.summary
        ?? "Company news, earnings, regulatory, partnership/order/M&A, and SEC filing sources are unavailable.",
    },
    ...marketEvidenceItems,
    {
      key: "alpha_confirmation",
      category: "confirmation",
      label: "Alpha confirmation gate",
      satisfied: confirmationSatisfied && liveMarket,
      independent: true,
      freshness,
      source: "Alpha Radar confirmation gate",
      detail: confirmationSatisfied
        ? "The existing multi-scan confirmation gate is satisfied."
        : preBreakout.confirmation.reason,
    },
    ...sectorConfirmation.evidence,
  ];
  const missingConfirmationItems = [
    ...(catalystSatisfied ? [] : ["Fresh authorized catalyst event"]),
    ...(!liveMarket ? ["Fresh complete protected market window"] : []),
    ...(!confirmationSatisfied ? preBreakout.confirmation.missingEvidence : []),
    ...sectorConfirmation.missing,
  ].filter((item, index, all) => all.indexOf(item) === index);

  return {
    symbol: input.symbol,
    eventTime: catalystEvent?.observedAt ?? null,
    triggerAt: input.alphaRadar.scan.lastScannedAt,
    freshness: opportunityFreshness(freshness),
    direction,
    alphaVelocity30s: liveMarket ? input.alphaRadar.alphaVelocity.rate30s : null,
    acceleration,
    catalystStatus: catalystEvent?.freshness === "fresh"
      ? "available"
      : "unavailable",
    evidenceCount: evidenceChain.filter((item) => item.satisfied && item.independent).length,
    evidenceChain,
    state,
    marketState: input.scanHealth.marketDataState,
    sectorConfirmation,
    missingConfirmationItems,
    alertReady,
    alertReadyReason,
    reason: independentlyConfirmed
      ? "Independent catalyst, fresh market microstructure, Alpha confirmation, and trusted peer confirmation converge."
      : hasMarketSetup
        ? "Fresh independent market evidence supports a pre-breakout setup; confirmation remains gated."
        : "Watching until fresh independent market evidence forms a valid setup.",
  };
}

export function createCatalystRadar(now = new Date()): CatalystRadarSnapshot {
  const statuses = sourceStatuses();
  return {
    generatedAt: now,
    eventState: "unavailable",
    sourceCount: statuses.length,
    availableSourceCount: 0,
    sourceStatuses: statuses,
    events: [],
    reason: "Catalyst Radar is source-availability aware. No external catalyst events are shown until a real authorized source is connected.",
  };
}

export function buildOpportunityCenter(
  inputs: CatalystRadarInput[],
  references: Array<{
    symbol: string;
    reference: SecurityReference | null;
  }>,
  now = new Date(),
): { catalystRadar: CatalystRadarSnapshot; opportunityCenter: OpportunityCenterSnapshot } {
  const catalystRadar = createCatalystRadar(now);
  const opportunities = inputs.map((input) => {
    const peers = inputs
      .filter((peer) => peer.symbol !== input.symbol)
      .map((peer) => ({
        symbol: peer.symbol,
        reference: references.find((entry) => entry.symbol === peer.symbol)?.reference ?? null,
        marketFresh: marketFresh(peer),
        independentEvidenceCount: peer.alphaRadar.preBreakout.confirmation.evidence
          .filter((evidence) => evidence.satisfied).length,
      }));
    const reference = references.find((entry) => entry.symbol === input.symbol)?.reference ?? null;
    return fuseOpportunity(input, catalystRadar, calculateSectorConfirmation(reference, peers), now);
  });
  return {
    catalystRadar,
    opportunityCenter: {
      generatedAt: now,
      opportunities,
      reason: "Opportunity state is fail-closed: catalyst events cannot create confirmation without fresh independent market and confirmation evidence.",
    },
  };
}

export function createUnavailableCatalystSources(): CatalystSourceStatus[] {
  return sourceStatuses();
}
