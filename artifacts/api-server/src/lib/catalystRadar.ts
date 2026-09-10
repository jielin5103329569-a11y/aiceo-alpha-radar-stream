import type {
  AlphaRadarSnapshot,
  PreBreakoutConfirmationEvidence,
} from "./alphaRadar";
import type { MarketFeedState } from "./marketFeed";
import type { SecurityReference } from "./marketUniverse";
import { secEdgarCatalyst } from "./secEdgarCatalyst";
import { isTimelySec8K } from "./sec8kTimeliness";

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
export type CatalystSourceReadiness =
  | "unconfigured"
  | "authorization_required"
  | "ready"
  | "stale"
  | "blocked";
export type CatalystFreshness = "fresh" | "delayed" | "stale" | "insufficient" | "missing";
export type CatalystDataQuality = "good" | "degraded" | "unavailable";
export type CatalystEventState = "unavailable" | "observed";
export type OpportunityState = "WATCH" | "PRE-BREAKOUT" | "CONFIRMED";
export type OpportunityFreshness = "fresh" | "stale" | "insufficient" | "missing";
export type SectorConfirmationStatus = "confirmed" | "insufficient" | "unavailable";
export type OpportunityDirection = "upside" | "downside" | "neutral" | "unavailable";
export type TapeBias = "主动偏买" | "偏卖" | "不明";

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
  readiness: CatalystSourceReadiness;
  nextAction: string;
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
  formType?: "8-K" | "10-Q" | "10-K";
  accession?: string;
  filingUrl?: string;
  company?: string;
  filedAt?: Date;
  receivedAt?: Date;
  lagged?: boolean;
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
  scanId: string | null;
  symbol: string;
  eventTime: Date | null;
  triggerAt: Date | null;
  freshness: OpportunityFreshness;
  direction: OpportunityDirection;
  alphaVelocity30s: number | null;
  acceleration: number | null;
  volume_vs_avg: number | null;
  tape_bias: TapeBias;
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
  scanId: string | null;
  generatedAt: Date;
  opportunities: Opportunity[];
  reason: string;
};

export type CatalystRadarInput = {
  scanId: string | null;
  symbol: string;
  alphaRadar: AlphaRadarSnapshot;
  marketFeedState: MarketFeedState;
  scanHealth: {
    schedulerState: "inactive" | "scheduled" | "delayed";
    marketDataState: "fresh" | "stale" | "offline" | "insufficient";
    marketDataGateReady: boolean;
  };
  marketWindowSettlement: {
    scanId: string | null;
    settledAt: Date | null;
    quote: boolean;
    trade: boolean;
    volume: boolean;
    heartbeat: boolean;
    complete: boolean;
    missingSegments: Array<"quote" | "trade" | "volume" | "heartbeat">;
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
      && reference.classificationSource
      && reference.classificationAvailability === "available",
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
    readiness: "unconfigured",
    nextAction: "Connect and authorize a source for this category. Configuration alone will not create or satisfy a catalyst event.",
  };
}

function sourceStatuses(): CatalystSourceStatus[] {
  return CATEGORY_DEFINITIONS.map(unavailableSource);
}

function marketFresh(input: CatalystRadarInput): boolean {
  return input.scanId !== null
    && input.marketWindowSettlement.scanId === input.scanId
    && input.marketWindowSettlement.complete
    && input.marketWindowSettlement.missingSegments.length === 0
    && input.marketWindowSettlement.settledAt !== null
    && input.marketFeedState === "streaming";
}

function alphaFresh(input: CatalystRadarInput): boolean {
  return input.alphaRadar.scoreState === "available"
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
  if (!liveMarket || !input.marketWindowSettlement.volume) return null;
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
  if (
    event.category === "sec_filing"
    && event.formType === "8-K"
    && event.filedAt
  ) {
    return isTimelySec8K(event.filedAt, now) ? event : null;
  }
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
    && alphaFresh(input)
    && satisfiedMarketEvidence.length >= 2
    && ["latent", "breakout_critical", "confirmed"].includes(preBreakout.state);
  const catalystEvent = authorizedFreshCatalystEvent(catalyst, input.symbol, now);
  const catalystSatisfied = catalystEvent !== null;
  const secSourceReady = catalyst.sourceStatuses.some((source) => (
    source.category === "sec_filing"
    && source.authorized
    && source.availability === "available"
    && source.readiness === "ready"
    && source.source === "SEC EDGAR"
  ));
  const failedCatalystDetail = secSourceReady
    ? "SEC EDGAR is connected, but no timely 8-K is available for this symbol."
    : "Company news, earnings, regulatory, partnership/order/M&A, and SEC filing sources are unavailable.";
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
  const volumeVsAvg = liveMarket
    && input.alphaRadar.volumeIntensity.available
    && input.alphaRadar.volumeIntensity.freshness === "fresh"
    && input.alphaRadar.volumeIntensity.value !== null
    && Number.isFinite(input.alphaRadar.volumeIntensity.value)
    ? input.alphaRadar.volumeIntensity.value
    : null;
  const tapePressure = liveMarket
    && input.alphaRadar.orderFlowPressure.available
    && input.alphaRadar.orderFlowPressure.freshness === "fresh"
    && input.alphaRadar.orderFlowPressure.value !== null
    && Number.isFinite(input.alphaRadar.orderFlowPressure.value)
    ? input.alphaRadar.orderFlowPressure.value
    : null;
  const tapeBias: TapeBias = tapePressure === null
    ? "不明"
    : tapePressure > 0
      ? "主动偏买"
      : tapePressure < 0
        ? "偏卖"
        : "不明";
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
      source: catalystEvent?.source ?? (secSourceReady ? "SEC EDGAR" : "No authorized catalyst source"),
      detail: catalystEvent?.summary
        ?? failedCatalystDetail,
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
    ...input.marketWindowSettlement.missingSegments.map((segment) => ({
      quote: "Fresh protected quote segment",
      trade: "Fresh protected trade segment",
      volume: "Fresh protected volume segment",
      heartbeat: "Fresh protected heartbeat segment",
    })[segment]),
    ...(!confirmationSatisfied ? preBreakout.confirmation.missingEvidence : []),
    ...sectorConfirmation.missing,
  ].filter((item, index, all) => all.indexOf(item) === index);

  return {
    scanId: input.scanId,
    symbol: input.symbol,
    eventTime: catalystEvent?.observedAt ?? null,
    triggerAt: input.marketWindowSettlement.settledAt,
    freshness: opportunityFreshness(freshness),
    direction,
    alphaVelocity30s: liveMarket ? input.alphaRadar.alphaVelocity.rate30s : null,
    acceleration,
    volume_vs_avg: volumeVsAvg,
    tape_bias: tapeBias,
    catalystStatus: catalystEvent?.freshness === "fresh"
      ? "available"
      : "unavailable",
    evidenceCount: evidenceChain.filter((item) => item.satisfied && item.independent).length,
    evidenceChain,
    state,
    marketState: liveMarket ? "fresh" : input.scanHealth.marketDataState,
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
  return secEdgarCatalyst.getSnapshot(now);
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
  const scanIds = [...new Set(inputs.map((input) => input.scanId).filter(
    (scanId): scanId is string => scanId !== null,
  ))];
  const sharedScanId = scanIds.length === 1 && inputs.every(
    (input) => input.scanId === scanIds[0] && input.marketWindowSettlement.scanId === scanIds[0],
  )
    ? scanIds[0]
    : null;
  const settledInputs = sharedScanId === null
    ? inputs.map((input) => ({
        ...input,
        scanId: null,
        marketWindowSettlement: {
          ...input.marketWindowSettlement,
          complete: false,
        },
      }))
    : inputs;
  const opportunities = settledInputs.map((input) => {
    const peers = settledInputs
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
      scanId: sharedScanId,
      generatedAt: now,
      opportunities,
      reason: "Opportunity state is fail-closed: catalyst events cannot create confirmation without fresh independent market and confirmation evidence.",
    },
  };
}

export function createUnavailableCatalystSources(): CatalystSourceStatus[] {
  return sourceStatuses();
}
