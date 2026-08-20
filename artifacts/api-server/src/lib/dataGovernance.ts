import { createHash } from "node:crypto";

import type { AlphaRadarSnapshot } from "./alphaRadar";

export type GovernanceLayerId =
  | "raw_market"
  | "basic_features"
  | "market_structure"
  | "stage_state"
  | "final_decision";
export type GovernanceLayerState = "available" | "withheld" | "unavailable";

export type GovernanceLayer = {
  id: GovernanceLayerId;
  state: GovernanceLayerState;
  observedAt: Date | null;
  sources: string[];
  reason: string;
};

export type GovernanceStage = {
  id: "pre_breakout" | "true_breakout" | "post_breakout";
  state: GovernanceLayerState;
  productionState: string;
  evidence: string[];
  reason: string;
};

export type DataGovernanceSnapshot = {
  schemaVersion: 1;
  generatedAt: Date;
  auditHash: string;
  layers: GovernanceLayer[];
  stages: GovernanceStage[];
  decision: {
    state: GovernanceLayerState;
    eligibleForReadOnlyPresentation: boolean;
    eligibleForProductionPromotion: boolean;
    reason: string;
  };
};

export type DataGovernanceInput = {
  now: Date;
  connectionState: string;
  marketFeedState: string;
  latestMarketEventAt: Date | null;
  subscriptionVerified: boolean;
  realMarketEventReceived: boolean;
  enteredScoringWindow: boolean;
  marketDataGateReady: boolean;
  reference: {
    state: "available" | "unavailable";
    source: string | null;
    observedAt: Date | null;
    reason: string;
  };
  alphaRadar: AlphaRadarSnapshot;
};

function hashSnapshot(value: Omit<DataGovernanceSnapshot, "auditHash">): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item) => (
    item instanceof Date ? item.toISOString() : item
  ))).digest("hex");
}

/**
 * Read-only audit projection for the existing live pipeline. It reuses the
 * production snapshot and never supplies an input to scoring, ranking, alerts,
 * notification delivery, or Shadow Learning eligibility.
 */
export function buildDataGovernanceSnapshot(input: DataGovernanceInput): DataGovernanceSnapshot {
  const alpha = input.alphaRadar;
  const rawReady = (
    input.connectionState === "streaming"
    && input.marketFeedState === "streaming"
    && input.subscriptionVerified
    && input.realMarketEventReceived
    && input.enteredScoringWindow
    && input.marketDataGateReady
  );
  const rawReason = rawReady
    ? "Verified Databento market events entered the current fresh scoring window."
    : "Raw market evidence is unavailable: transport, verified event, fresh-window, or scheduler gate is not satisfied.";
  const featuresReady = rawReady
    && alpha.scoreState === "available"
    && alpha.dataQuality === "good"
    && [alpha.momentum, alpha.volumeIntensity, alpha.orderFlowPressure, alpha.spread]
      .every((metric) => metric.scoreEligible);
  const featuresReason = featuresReady
    ? "Every score component is fresh and the existing score-quality gate is available."
    : "Basic features are withheld because governed raw evidence or an existing score-quality requirement is unavailable.";
  const structureReady = featuresReady && alpha.preBreakout.dataFresh;
  const structureReason = structureReady
    ? "Observed price, volume, order-flow, spread, multi-timeframe, and counter-evidence context is available for stage interpretation."
    : "Market-structure interpretation is withheld because fresh governed feature evidence is unavailable.";

  const layers: GovernanceLayer[] = [
    {
      id: "raw_market",
      state: rawReady ? "available" : "unavailable",
      observedAt: input.latestMarketEventAt,
      sources: rawReady ? ["Databento EQUS.MINI live"] : [],
      reason: rawReason,
    },
    {
      id: "basic_features",
      state: featuresReady ? "available" : rawReady ? "withheld" : "unavailable",
      observedAt: alpha.generatedAt,
      sources: featuresReady
        ? [alpha.momentum.source, alpha.volumeIntensity.source, alpha.orderFlowPressure.source, alpha.spread.source]
        : [],
      reason: featuresReason,
    },
    {
      id: "market_structure",
      state: structureReady ? "available" : featuresReady ? "withheld" : "unavailable",
      observedAt: structureReady ? alpha.generatedAt : null,
      sources: structureReady ? ["governed_feature_context"] : [],
      reason: structureReason,
    },
    {
      id: "stage_state",
      state: structureReady ? "available" : "unavailable",
      observedAt: structureReady ? alpha.preBreakout.lastEvaluatedAt : null,
      sources: structureReady ? ["pre_breakout_state_machine", "post_breakout_monitor"] : [],
      reason: structureReady
        ? "Stage states are explanatory projections of existing independent state machines."
        : "Stage states are unavailable because upstream governed layers are unavailable.",
    },
    {
      id: "final_decision",
      state: "withheld",
      observedAt: null,
      sources: [],
      reason: "Final promotion is intentionally withheld: this read-only projection cannot authorize a production decision or alert.",
    },
  ];
  const stageAvailable = structureReady ? "available" : "unavailable";
  const stages: GovernanceStage[] = [
    {
      id: "pre_breakout",
      state: stageAvailable,
      productionState: alpha.preBreakout.state,
      evidence: [...alpha.preBreakout.confirmation.satisfiedEvidence],
      reason: stageAvailable
        ? alpha.preBreakout.confirmation.reason
        : "Pre-breakout evidence is unavailable because upstream governance is unavailable.",
    },
    {
      id: "true_breakout",
      state: alpha.postBreakout.active && structureReady ? "available" : stageAvailable,
      productionState: alpha.postBreakout.active ? "observed" : "not_observed",
      evidence: alpha.postBreakout.active ? [...alpha.postBreakout.supportReasons] : [],
      reason: alpha.postBreakout.reason,
    },
    {
      id: "post_breakout",
      state: alpha.postBreakout.dataFresh && structureReady ? "available" : "unavailable",
      productionState: alpha.postBreakout.state,
      evidence: [...alpha.postBreakout.supportReasons, ...alpha.postBreakout.deteriorationReasons],
      reason: alpha.postBreakout.reason,
    },
  ];
  const eligibleForReadOnlyPresentation = structureReady;
  const eligibleForProductionPromotion = false;
  const decision = {
    state: "withheld" as GovernanceLayerState,
    eligibleForReadOnlyPresentation,
    eligibleForProductionPromotion,
    reason: !structureReady
      ? "Governance does not authorize promotion: an upstream layer is unavailable."
      : alpha.counterEvidence.blocksHighGradeUpgrade
        ? "Governance does not authorize promotion: existing counter-evidence blocks a high-grade upgrade."
        : alpha.dataConfidence.state === "unavailable"
          ? "Governance does not authorize promotion: existing data confidence is unavailable."
          : "Governance is read-only. Existing production gates remain the sole authority for any alert or notification.",
  };
  const unsigned = {
    schemaVersion: 1 as const,
    generatedAt: input.now,
    layers,
    stages,
    decision,
  };
  return { ...unsigned, auditHash: hashSnapshot(unsigned) };
}