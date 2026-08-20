import type { MarketUniverseSummary } from "./marketUniverse";
import type { SectorPrioritySnapshot } from "./sectorPriority";
import type { RadarSymbolStatus } from "./databentoLive";

export type OpeningReadinessStageId =
  | "transport"
  | "live_evidence"
  | "trusted_classification"
  | "sector_constituents"
  | "sector_ranking"
  | "candidate_promotion";

export type OpeningReadinessStageState = "monitoring" | "ready" | "blocked" | "withheld";

export type OpeningReadinessStage = {
  id: OpeningReadinessStageId;
  label: string;
  state: OpeningReadinessStageState;
  detail: string;
};

export type OpeningReadinessSnapshot = {
  generatedAt: Date;
  session: {
    phase: "pre_market" | "regular" | "after_hours" | "closed";
    timezone: "America/New_York";
    mode:
      | "pre_market_monitoring"
      | "opening_reassessment"
      | "regular_monitoring"
      | "awaiting_next_session";
    detail: string;
  };
  nextEvaluationAt: Date | null;
  nextEvaluationReason: string;
  stages: OpeningReadinessStage[];
};

type OpeningReadinessInput = {
  symbols: RadarSymbolStatus[];
  marketUniverse: MarketUniverseSummary;
  sectorPriority: SectorPrioritySnapshot;
  now?: Date;
};

const ACTIVE_TRANSPORT_STATES = new Set(["connecting", "connected", "streaming"]);
const CONFIRMED_TRANSPORT_STATES = new Set(["connected", "streaming"]);

function sessionFor(
  primary: RadarSymbolStatus | undefined,
): OpeningReadinessSnapshot["session"] {
  const marketSession = primary?.liveIngestion.marketSession;
  const phase = marketSession?.phase ?? "closed";
  const openingScan = primary?.scanHealth.scanMode === "opening";
  const mode = phase === "pre_market"
    ? "pre_market_monitoring"
    : phase === "regular" && openingScan
      ? "opening_reassessment"
      : phase === "regular"
        ? "regular_monitoring"
        : "awaiting_next_session";
  const detail = mode === "pre_market_monitoring"
    ? "Pre-market transport is monitored continuously. Sparse or absent records remain awaiting real evidence, not a feed failure."
    : mode === "opening_reassessment"
      ? "Opening cadence is active. Existing live gates are being re-evaluated as real Databento records arrive."
      : mode === "regular_monitoring"
        ? "Regular-session readiness is continuously derived from current verified records and existing scan gates."
        : "Outside the regular opening flow. Readiness remains pending until the next session produces real Databento records.";

  return {
    phase,
    timezone: marketSession?.timezone ?? "America/New_York",
    mode,
    detail,
  };
}

function earliestNextEvaluation(symbols: RadarSymbolStatus[]): Date | null {
  const nextTimes = symbols
    .map((symbol) => symbol.scanHealth.nextScanAt)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  return nextTimes[0] ?? null;
}

function stage(
  id: OpeningReadinessStageId,
  label: string,
  state: OpeningReadinessStageState,
  detail: string,
): OpeningReadinessStage {
  return { id, label, state, detail };
}

/**
 * Produces a read-only explanation of the existing readiness gates. It never
 * upgrades transport, schedule, reference, or historical facts into market
 * evidence, and it does not feed alert, rank, or promotion behavior.
 */
export function buildOpeningReadiness(input: OpeningReadinessInput): OpeningReadinessSnapshot {
  const now = input.now ?? new Date();
  const primary = input.symbols.find((symbol) => symbol.symbol === "NVDA") ?? input.symbols[0];
  const session = sessionFor(primary);
  const total = input.symbols.length;
  const activeTransport = input.symbols.filter((symbol) => (
    ACTIVE_TRANSPORT_STATES.has(symbol.connectionState)
  ));
  const confirmedSubscriptions = input.symbols.filter((symbol) => (
    CONFIRMED_TRANSPORT_STATES.has(symbol.connectionState)
    && symbol.liveIngestion.conditions.subscriptionVerified
  ));
  const streaming = input.symbols.filter((symbol) => symbol.connectionState === "streaming");
  const gateReady = input.symbols.filter((symbol) => symbol.scanHealth.marketDataGateReady);
  const receivedRecords = input.symbols.filter(
    (symbol) => symbol.liveIngestion.conditions.realMarketEventReceived,
  );
  const trustedClassification = (
    input.marketUniverse.freshness === "fresh"
    && input.marketUniverse.dataQuality === "good"
  );
  const sectorRanked = input.sectorPriority.state === "ranked"
    && input.sectorPriority.coverage.rankedSectorCount > 0;
  const promotable = input.sectorPriority.finalCandidates.length > 0;
  const nextEvaluationAt = earliestNextEvaluation(input.symbols);

  const transportState: OpeningReadinessStageState = confirmedSubscriptions.length === total && total > 0
    ? "ready"
    : activeTransport.length > 0
      ? "monitoring"
      : "blocked";
  const liveEvidenceState: OpeningReadinessStageState = gateReady.length > 0
    ? "ready"
    : activeTransport.length > 0
      ? "monitoring"
      : "blocked";
  const classificationState: OpeningReadinessStageState = trustedClassification ? "ready" : "blocked";
  const constituentsState: OpeningReadinessStageState = !trustedClassification
    ? "blocked"
    : sectorRanked
      ? "ready"
      : "withheld";
  const rankingState: OpeningReadinessStageState = sectorRanked
    ? "ready"
    : trustedClassification
      ? "withheld"
      : "blocked";
  const promotionState: OpeningReadinessStageState = promotable
    ? "ready"
    : sectorRanked
      ? "withheld"
      : "blocked";

  const stages: OpeningReadinessStage[] = [
    stage(
      "transport",
      "Protected transport",
      transportState,
      transportState === "ready"
        ? `${confirmedSubscriptions.length}/${total} protected bridges have confirmed subscription transport. Confirmed transport is not itself market evidence.`
        : transportState === "monitoring"
          ? confirmedSubscriptions.length > 0
            ? `${confirmedSubscriptions.length}/${total} protected bridges have confirmed subscription transport; ${total - confirmedSubscriptions.length} remain connecting or otherwise unconfirmed.`
            : `${activeTransport.length}/${total} protected bridges are connecting. Configured subscription fields do not confirm transport readiness.`
          : "No protected bridge currently has a verified Databento subscription transport. Live evidence cannot begin.",
    ),
    stage(
      "live_evidence",
      "Fresh live evidence",
      liveEvidenceState,
      liveEvidenceState === "ready"
        ? `${gateReady.length}/${total} protected symbols have a fresh complete window and the existing live scan gate ready.`
        : confirmedSubscriptions.length === 0 && activeTransport.length > 0
          ? "Live evidence remains pending while protected bridges are connecting. A configured subscription and a scheduler tick are not verified market records."
          : confirmedSubscriptions.length > 0
          ? session.mode === "pre_market_monitoring"
            ? `${receivedRecords.length}/${total} symbols have received real records and ${streaming.length}/${total} are streaming. Pre-market remains under active observation until a complete fresh window exists.`
            : `${receivedRecords.length}/${total} symbols have received real records, but none currently satisfies the existing fresh market-data gate.`
          : "Live evidence is blocked until a verified subscription transport is connected.",
    ),
    stage(
      "trusted_classification",
      "Trusted classification",
      classificationState,
      trustedClassification
        ? `${input.marketUniverse.classificationCoverageCount} fresh verified classifications are available for sector grouping.`
        : input.marketUniverse.reason,
    ),
    stage(
      "sector_constituents",
      "Same-sector constituents",
      constituentsState,
      constituentsState === "ready"
        ? "At least one sector has the required independently fresh, trusted classified constituents."
        : !trustedClassification
          ? "Trusted classification is required before any fresh live symbol can count toward same-sector coverage."
          : `${input.sectorPriority.coverage.classifiedLiveSymbols}/${input.sectorPriority.coverage.requiredConstituentsPerSector} fresh classified constituents are currently available in the protected live population.`,
    ),
    stage(
      "sector_ranking",
      "Sector ranking",
      rankingState,
      sectorRanked
        ? `${input.sectorPriority.coverage.rankedSectorCount} sector ranking(s) are based only on current verified constituent windows.`
        : input.sectorPriority.reason,
    ),
    stage(
      "candidate_promotion",
      "Candidate promotion",
      promotionState,
      promotable
        ? `${input.sectorPriority.finalCandidates.length} final candidate(s) passed the existing independent promotion inputs.`
        : sectorRanked
          ? "Sector context exists, but no candidate has passed every independent promotion requirement. No candidate is inferred."
          : "Candidate promotion is not evaluated until the preceding live-evidence, trusted-classification, and sector-ranking gates are satisfied.",
    ),
  ];

  return {
    generatedAt: now,
    session,
    nextEvaluationAt,
    nextEvaluationReason: nextEvaluationAt
      ? "The next scheduled protected scan will recompute readiness from then-current live records; scheduler activity itself is not market evidence."
      : "No protected scan is currently scheduled. Readiness will remain blocked until a bridge is armed.",
    stages,
  };
}