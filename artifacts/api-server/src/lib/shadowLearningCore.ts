import { createHash } from "node:crypto";

import {
  aggregateValidationMetrics,
  calculateOutcomeCheckpoint,
  type CalculatedCheckpoint,
  type TriggerEvidenceItem,
  type ValidationDirection,
  type ValidationHorizonDays,
  type ValidationMetricInput,
  type ValidationPriceObservation,
  VALIDATION_HORIZONS,
  MINIMUM_VALIDATION_SAMPLE,
} from "./signalValidationCore";

export const SHADOW_RECORD_SCHEMA_VERSION = 1;
export const SHADOW_TRIGGER_SCHEMA_VERSION = 2;
export const SHADOW_PRICE_KEY_SCHEMA_VERSION = 2;
export const SHADOW_OUTCOME_KEY_SCHEMA_VERSION = 2;
export const SHADOW_STRATEGY_VERSION = "shadow-alpha-velocity-v1";
export const SHADOW_SCAN_WINDOW = "60s";
export const SHADOW_SCAN_PROFILE = "fresh-streaming-pre-breakout";
export const SHADOW_MODEL_VERSION = "shadow-evaluator-2026-08-20-v1";
export const SHADOW_MINIMUM_COMPLETE_SAMPLE = MINIMUM_VALIDATION_SAMPLE;
export const SHADOW_MINIMUM_HOLDOUT_SAMPLE = 8;
export const SHADOW_REQUIRED_HIT_RATE_ADVANTAGE_PERCENT = 8;
export const SHADOW_REQUIRED_RETURN_ADVANTAGE_PERCENT = 0.5;
export const SHADOW_MINIMUM_CORE_LEAD_TIME_MINUTES = 1;
export const SHADOW_MINIMUM_CORE_INCREMENTAL_VALUE_PERCENT = 4;
export const SHADOW_MAXIMUM_CORE_REDUNDANCY_PERCENT = 50;
export const SHADOW_LEARNING_EVOLUTION_SCHEMA_VERSION = 1;
export const SHADOW_LEARNING_EVOLUTION_SCORING_VERSION = "shadow-learning-evolution-v1";

export type ShadowSignalType =
  | "shadow_pre_breakout"
  | "shadow_true_breakout"
  | "shadow_post_breakout";
export type ShadowTriggerStatus = "triggered";
export type ShadowPersistenceState = "available" | "unavailable";
/**
 * Learning stages are intentionally sidecar-only. They describe which
 * independently versioned feature screen an immutable shadow observation used;
 * they are never read by live Alpha Radar scoring or alert gates.
 */
export type ShadowLearningStage = "pre_breakout" | "true_breakout" | "post_breakout";
export type ShadowCoreLearningPolicy = {
  version: string;
  priority: "highest";
  directions: Readonly<Record<ShadowLearningStage, {
    label: string;
    objective: string;
  }>>;
  sharedValueCriteria: readonly [
    "predictive_power",
    "earliness",
    "risk_reward_improvement",
    "incremental_information_value",
    "stability",
    "noise_false_signal_rate",
  ];
  coreAdmissionRule: string;
};

/**
 * The only core-learning directions for Alpha Radar. New data, indicators,
 * features, and learning results must be attributable to one of these
 * directions and pass the shared future-outcome value standard before they
 * may become a core candidate. This policy never changes live scoring.
 */
export const SHADOW_CORE_LEARNING_POLICY: ShadowCoreLearningPolicy = {
  version: "alpha-radar-three-stage-core-v1",
  priority: "highest",
  directions: {
    pre_breakout: {
      label: "爆发前 / 潜伏",
      objective: "Earlier and more accurate identification of internal strength changes and favourable risk/reward setups at low or reasonable locations.",
    },
    true_breakout: {
      label: "真突破",
      objective: "More accurately distinguish valid structural breaks from false breaks and confirm breakout reality and persistence.",
    },
    post_breakout: {
      label: "突破后趋势 / 止盈",
      objective: "More accurately assess trend life, continuation, exhaustion, scale-down, and profit-taking timing.",
    },
  },
  sharedValueCriteria: [
    "predictive_power",
    "earliness",
    "risk_reward_improvement",
    "incremental_information_value",
    "stability",
    "noise_false_signal_rate",
  ],
  coreAdmissionRule: "A new item may enter core learning only when it maps to one stage and independently demonstrates future-outcome value under every shared criterion; all other items remain outside core learning.",
};
export type ShadowFeatureKey =
  | "relative_strength_improvement"
  | "price_structure"
  | "volatility_contraction"
  | "dense_trading_zone"
  | "sell_pressure_decay"
  | "active_buy_improvement"
  | "volume_structure"
  | "breakout_distance"
  | "structure_breakout"
  | "breakout_volume_confirmation"
  | "aggressive_trade_direction"
  | "l1_bid_ask_tilt"
  | "post_breakout_trade_persistence"
  | "post_breakout_active_flow"
  | "volume_trade_speed"
  | "new_high_quality"
  | "price_volume_divergence"
  | "breakout_support_integrity"
  | "multi_timeframe_alignment"
  | "counter_evidence_resilience"
  | "data_confidence";

export type ShadowStageRule = {
  label: string;
  objective: string;
  featureWeights: Readonly<Record<ShadowFeatureKey, number> | Partial<Record<ShadowFeatureKey, number>>>;
};

/**
 * Fixed, versioned stage screens. Weighting belongs only to shadow experiments:
 * a value has to pass later outcome evaluation before any separately approved
 * production configuration can use it.
 */
export const SHADOW_STAGE_RULES: Readonly<Record<ShadowLearningStage, ShadowStageRule>> = {
  pre_breakout: {
    label: "爆发前 / 潜伏",
    objective: "Discover internal strength changes and favourable asymmetric setups before a verified break.",
    featureWeights: {
      relative_strength_improvement: 0.16,
      price_structure: 0.14,
      volatility_contraction: 0.12,
      dense_trading_zone: 0.10,
      sell_pressure_decay: 0.12,
      active_buy_improvement: 0.14,
      volume_structure: 0.12,
      breakout_distance: 0.10,
      // Quality mechanisms are observed and evaluated in Shadow Learning first.
      // Zero weight ensures they cannot alter a shadow screen before real
      // future-outcome validation supports an explicitly reviewed experiment.
      multi_timeframe_alignment: 0,
      counter_evidence_resilience: 0,
      data_confidence: 0,
    },
  },
  true_breakout: {
    label: "真突破",
    objective: "Distinguish a verified structural break from a false break using real execution evidence.",
    featureWeights: {
      structure_breakout: 0.28,
      breakout_volume_confirmation: 0.20,
      aggressive_trade_direction: 0.18,
      l1_bid_ask_tilt: 0.16,
      post_breakout_trade_persistence: 0.18,
      multi_timeframe_alignment: 0,
      counter_evidence_resilience: 0,
      data_confidence: 0,
    },
  },
  post_breakout: {
    label: "突破后趋势 / 止盈",
    objective: "Assess trend life, support integrity, and whether exit evidence has become material.",
    featureWeights: {
      post_breakout_active_flow: 0.22,
      volume_trade_speed: 0.20,
      new_high_quality: 0.20,
      price_volume_divergence: 0.18,
      breakout_support_integrity: 0.20,
      multi_timeframe_alignment: 0,
      counter_evidence_resilience: 0,
      data_confidence: 0,
    },
  },
} as const;

export type ShadowFeatureTier = "A_core" | "B_supporting" | "C_redundant" | "D_noise" | "unavailable";
export type ShadowStageFeatureSnapshot = Partial<Record<ShadowFeatureKey, number | null>>;

export type ShadowStageFeatureSample = {
  eventKey: string;
  featureValue: number | null;
  hit: boolean;
  favorableReturnPercent: number;
  maxAdversePercent: number;
  leadTimeMinutes: number | null;
  falseSignal: boolean | null;
};

export type ShadowStageFeatureValueAssessment = {
  stage: ShadowLearningStage;
  featureKey: ShadowFeatureKey;
  tier: ShadowFeatureTier;
  sampleState: "available" | "insufficient_sample" | "unavailable";
  sampleSize: number;
  predictiveAdvantagePercent: number | null;
  averageLeadTimeMinutes: number | null;
  riskRewardAdvantagePercent: number | null;
  incrementalValuePercent: number | null;
  stabilityPercent: number | null;
  noiseRatePercent: number | null;
  redundancyPercent: number | null;
  /** Only A-tier, stage-mapped, fully audited evidence may enter core learning. */
  coreEligible: boolean;
  reason: string;
};

/** Maps a verified signed percentage (-100 to 100) to a shadow-only 0–100 feature value. */
export function normalizeSignedPercentFeature(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, (value + 100) / 2));
}

export function isCoreLearningFeature(
  stage: ShadowLearningStage,
  featureKey: ShadowFeatureKey,
): boolean {
  return Object.hasOwn(SHADOW_STAGE_RULES[stage].featureWeights, featureKey);
}
export type ShadowPromotionStatus =
  | "candidate"
  | "not_eligible"
  | "insufficient_sample"
  | "unavailable";

export type ShadowFreshnessSnapshot = {
  marketFeedState: string;
  dataQuality: string;
  scoreState: string;
  streaming: boolean;
  complete: boolean;
  eligible: boolean;
};

export type ShadowInputSummary = {
  alphaScore: number | null;
  confidence: number;
  velocity30s: number | null;
  velocity60s: number | null;
  momentumAcceleration: number | null;
  volumeAcceleration: number | null;
  orderFlowShift: number | null;
  spreadTightening: number | null;
  evidenceCount: number;
  /** Normalized 0–100 stage values; null means no verified source existed. */
  stageFeatures?: ShadowStageFeatureSnapshot;
  learningStage?: ShadowLearningStage;
};

export type ShadowCohortEligibilitySnapshot = {
  baselineSignalType: "state_transition";
  baselineState: string;
  matchingWindowSeconds: number;
  requiredEvidenceKeys: string[];
  dataFreshRequired: true;
};

export type ShadowTriggerInput = {
  strategyVersion: string;
  scanWindow: string;
  scanProfile: string;
  modelVersion: string;
  candidateSource: string;
  signalType: ShadowSignalType;
  symbol: string;
  sector: string | null;
  occurredAt: Date;
  triggerPrice: number;
  direction: ValidationDirection;
  state: string;
  learningStage: ShadowLearningStage;
  shadowScore: number;
  status: ShadowTriggerStatus;
  evidenceSnapshot: TriggerEvidenceItem[];
  freshnessSnapshot: ShadowFreshnessSnapshot;
  inputSummary: ShadowInputSummary;
  cohortKey: string;
  cohortEligibilitySnapshot: ShadowCohortEligibilitySnapshot;
};

export type ImmutableShadowTrigger = ShadowTriggerInput & {
  eventKey: string;
  schemaVersion: number;
  recordHash: string;
};

export type ShadowPriceObservation = {
  observationKey: string;
  recordHash: string;
  symbol: string;
  observedAt: Date;
  price: number;
  source: string;
  freshness: "fresh";
  lifecycleSnapshot?: ShadowLifecycleSnapshot;
};

export type ShadowLifecycleSnapshot = {
  learningStage: ShadowLearningStage;
  postBreakoutState: "unavailable" | "trend_continuation" | "take_profit_watch" | "trend_reversal_confirmed";
  postBreakoutActive: boolean;
  dataFresh: true;
};

export type ShadowStageOutcomeSummary = {
  maximumFavorableExcursionPercent: number | null;
  maximumAdverseExcursionPercent: number | null;
  breakoutObserved: boolean | null;
  falseBreakoutObserved: boolean | null;
  enteredTrendContinuation: boolean | null;
  enteredTakeProfitWatch: boolean | null;
  enteredTrendReversal: boolean | null;
  lifecycleEvidenceState: "available" | "unavailable";
  reason: string;
};

export type ShadowOutcomeRecord = CalculatedCheckpoint & {
  outcomeKey: string;
  recordHash: string;
  triggerEventKey: string;
  stageOutcome: ShadowStageOutcomeSummary;
};

export type ShadowCohortOutcome<T> = {
  cohortKey: string;
  symbol: string;
  sector: string | null;
  occurredAt: Date;
  cohortEligibilitySnapshot: ShadowCohortEligibilitySnapshot;
  value: T;
};

export type BaselineCohortOutcome<T> = {
  eventKey: string;
  symbol: string;
  sector: string | null;
  occurredAt: Date;
  state: string;
  signalType: string;
  dataFresh: boolean;
  satisfiedEvidence: string[];
  value: T;
};

export type ShadowMetricComparison = {
  sampleState: "insufficient_sample" | "available";
  sampleSize: number;
  minimumSampleSize: number;
  hitRatePercent: number | null;
  averageReturnPercent: number | null;
  maximumDrawdownPercent: number | null;
  falsePositiveRatePercent: number | null;
  averageLeadTimeMinutes: number | null;
};

export type ShadowPromotionRecommendation = {
  status: ShadowPromotionStatus;
  reason: string;
  evidenceState: "complete" | "withheld";
  rules: {
    minimumCompleteSample: number;
    minimumHoldoutSample: number;
    requiredHitRateAdvantagePercent: number;
    requiredReturnAdvantagePercent: number;
    independentSplit: string;
  };
};

/**
 * A learning-evolution activity is a read-only, versioned description of a
 * shadow experiment. It is never a production configuration or an authority
 * to modify Alpha Radar, Alerts, scanning, or notification settings.
 */
export type ShadowLearningEvolutionActivity = {
  activityId: string;
  recordHash: string;
  targetStage: ShadowLearningStage;
  dataLayer: "stage_features";
  featureScope: ShadowFeatureKey[];
  hypothesis: string;
  baseline: {
    strategyVersion: string | null;
    modelVersion: string | null;
    comparison: "matched_future_outcome_cohort";
  };
  experimentVersion: string | null;
  sampleRange: {
    startedAt: Date | null;
    endedAt: Date | null;
    triggerCount: number;
  };
  validationWindow: {
    horizonDays: ValidationHorizonDays;
    futureOutcomesOnly: true;
    independentValidation: "required";
  };
  resourceCost: {
    state: "complete" | "incomplete";
    computeUnitHours: number | null;
    dataAcquisitionCost: number | null;
    storageCost: number | null;
    validationCycleDays: number | null;
    manualReviewHours: number | null;
    reason: string;
  };
  auditState: "complete" | "withheld";
  resultReason: string;
};

export type ShadowLearningEvolutionStageScore = {
  stage: ShadowLearningStage;
  evaluationState: "available" | "insufficient_sample" | "withheld";
  sampleSize: number;
  featureCount: number;
  improvements: {
    predictivePowerPercent: number | null;
    earlinessMinutes: number | null;
    riskRewardPercent: number | null;
    incrementalInformationPercent: number | null;
    stabilityPercent: number | null;
    redundancyPercent: number | null;
    falseSignalRatePercent: number | null;
  };
  learningValuePercent: number | null;
  learningReturnOnCost: number | null;
  calibration: {
    state: "independent_validated" | "insufficient_sample" | "unavailable";
    reason: string;
  };
  recommendation: {
    action: "increase_validation" | "maintain_observation" | "reduce_frequency" | "pause" | "retire";
    approvalState: "shadow_only_pending_human_review";
    reason: string;
  };
  reason: string;
};

export type ShadowLearningEvolutionSnapshot = {
  schemaVersion: number;
  scoringVersion: string;
  productionMutationAllowed: false;
  activities: ShadowLearningEvolutionActivity[];
  stageScores: ShadowLearningEvolutionStageScore[];
  reason: string;
  auditHash: string;
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function meanAvailable(values: Array<number | null | undefined>): number | null {
  const available = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return available.length ? Math.round((available.reduce((total, value) => total + value, 0) / available.length) * 100) / 100 : null;
}

function unavailableCost(): ShadowLearningEvolutionActivity["resourceCost"] {
  return {
    state: "incomplete",
    computeUnitHours: null,
    dataAcquisitionCost: null,
    storageCost: null,
    validationCycleDays: null,
    manualReviewHours: null,
    reason: "Resource-cost evidence has not been persisted. The learning return-on-cost score is withheld rather than estimated.",
  };
}

export function buildShadowLearningEvolutionSnapshot(input: {
  persistenceState: ShadowPersistenceState;
  strategyVersion: string | null;
  modelVersion: string | null;
  horizonDays: ValidationHorizonDays;
  stagePromotions: Partial<Record<ShadowLearningStage, ShadowPromotionRecommendation>>;
  stageFeatureAssessments: ShadowStageFeatureValueAssessment[];
  stageSamples: Partial<Record<ShadowLearningStage, Array<{ occurredAt: Date; recordHash: string }>>>;
}): ShadowLearningEvolutionSnapshot {
  const stages = Object.keys(SHADOW_STAGE_RULES) as ShadowLearningStage[];
  const activities = stages.map((stage) => {
    const samples = [...(input.stageSamples[stage] ?? [])].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    const activityWithoutHash = {
      targetStage: stage,
      dataLayer: "stage_features" as const,
      featureScope: Object.keys(SHADOW_STAGE_RULES[stage].featureWeights) as ShadowFeatureKey[],
      hypothesis: `The ${stage} stage feature set produces independently useful future-outcome evidence beyond its matched baseline.`,
      baseline: {
        strategyVersion: input.strategyVersion,
        modelVersion: input.modelVersion,
        comparison: "matched_future_outcome_cohort" as const,
      },
      experimentVersion: input.modelVersion,
      sampleRange: {
        startedAt: samples.at(0)?.occurredAt ?? null,
        endedAt: samples.at(-1)?.occurredAt ?? null,
        triggerCount: samples.length,
      },
      validationWindow: {
        horizonDays: input.horizonDays,
        futureOutcomesOnly: true as const,
        independentValidation: "required" as const,
      },
      resourceCost: unavailableCost(),
      auditState: input.persistenceState === "available" ? "complete" as const : "withheld" as const,
      resultReason: input.persistenceState === "available"
        ? "Activity evidence is derived from immutable shadow triggers and future-only outcome checkpoints."
        : "Activity evidence is withheld because shadow persistence or archive recovery is incomplete.",
    };
    const activityId = hash({
      scoringVersion: SHADOW_LEARNING_EVOLUTION_SCORING_VERSION,
      ...activityWithoutHash,
      evidenceHashes: samples.map((sample) => sample.recordHash),
    }).slice(0, 32);
    return {
      activityId,
      recordHash: hash({ activityId, ...activityWithoutHash, evidenceHashes: samples.map((sample) => sample.recordHash) }),
      ...activityWithoutHash,
    };
  });
  const stageScores = stages.map((stage) => {
    const assessments = input.stageFeatureAssessments.filter((assessment) => assessment.stage === stage);
    const available = assessments.filter((assessment) => assessment.sampleState === "available");
    const sampleSize = available.reduce((largest, assessment) => Math.max(largest, assessment.sampleSize), 0);
    const improvements = {
      predictivePowerPercent: meanAvailable(available.map((assessment) => assessment.predictiveAdvantagePercent)),
      earlinessMinutes: meanAvailable(available.map((assessment) => assessment.averageLeadTimeMinutes)),
      riskRewardPercent: meanAvailable(available.map((assessment) => assessment.riskRewardAdvantagePercent)),
      incrementalInformationPercent: meanAvailable(available.map((assessment) => assessment.incrementalValuePercent)),
      stabilityPercent: meanAvailable(available.map((assessment) => assessment.stabilityPercent)),
      redundancyPercent: meanAvailable(available.map((assessment) => assessment.redundancyPercent)),
      falseSignalRatePercent: meanAvailable(available.map((assessment) => assessment.noiseRatePercent)),
    };
    const stagePromotion = input.stagePromotions[stage];
    const hasStageEvidence = available.length > 0 && (input.stageSamples[stage]?.length ?? 0) > 0;
    const calibration = hasStageEvidence && stagePromotion
      ? stagePromotion.status === "candidate" || stagePromotion.status === "not_eligible"
        ? {
            state: "independent_validated" as const,
            reason: "This stage's matched future-outcome cohorts completed the fixed independent holdout evaluation. This validates scoring evidence only, not production changes.",
          }
        : stagePromotion.status === "insufficient_sample"
          ? {
              state: "insufficient_sample" as const,
              reason: "This stage's independent holdout evidence has not reached the fixed minimum sample threshold.",
            }
          : {
              state: "unavailable" as const,
              reason: "This stage's independent holdout calibration is withheld until persistence and immutable audit evidence are complete.",
            }
      : {
          state: "unavailable" as const,
          reason: "No stage-specific matched-baseline holdout with immutable future-outcome evidence is available; no value upgrade is allowed.",
        };
    const cost = activities.find((activity) => activity.targetStage === stage)!.resourceCost;
    const evidenceReady = (
      input.persistenceState === "available"
      && available.length > 0
      && calibration.state === "independent_validated"
    );
    const learningValuePercent = evidenceReady
      ? meanAvailable([
          improvements.predictivePowerPercent,
          improvements.riskRewardPercent,
          improvements.incrementalInformationPercent,
          improvements.stabilityPercent,
          improvements.falseSignalRatePercent === null ? null : 100 - improvements.falseSignalRatePercent,
          improvements.redundancyPercent === null ? null : 100 - improvements.redundancyPercent,
        ])
      : null;
    const allNoise = available.length > 0 && available.every((assessment) => assessment.tier === "D_noise");
    const allRedundant = available.length > 0 && available.every((assessment) => assessment.tier === "C_redundant");
    const hasCoreCandidate = available.some((assessment) => assessment.coreEligible);
    const evaluationState = input.persistenceState !== "available"
      ? "withheld" as const
      : available.length === 0
        ? "insufficient_sample" as const
        : "available" as const;
    const recommendation = allNoise
      ? {
          action: "retire" as const,
          approvalState: "shadow_only_pending_human_review" as const,
          reason: "All evaluated features are noise under immutable future outcomes. Retirement is a human-review recommendation only and does not delete evidence.",
        }
      : allRedundant
        ? {
            action: "reduce_frequency" as const,
            approvalState: "shadow_only_pending_human_review" as const,
            reason: "Evaluated evidence is redundant with the existing stage screen. Reduce future validation priority only after human review.",
          }
        : hasCoreCandidate && cost.state === "complete" && calibration.state === "independent_validated"
          ? {
              action: "increase_validation" as const,
              approvalState: "shadow_only_pending_human_review" as const,
              reason: "Independent future-outcome evidence, calibration, and complete costs support more shadow validation. Production remains unchanged.",
            }
          : {
              action: "maintain_observation" as const,
              approvalState: "shadow_only_pending_human_review" as const,
              reason: cost.state !== "complete"
                ? "Cost evidence is incomplete, so learning return-on-cost and any resource increase are withheld."
                : "Evidence remains observational pending complete stage-specific calibration and human approval.",
            };
    return {
      stage,
      evaluationState,
      sampleSize,
      featureCount: assessments.length,
      improvements,
      learningValuePercent,
      learningReturnOnCost: null,
      calibration,
      recommendation,
      reason: evaluationState === "withheld"
        ? "Stage scoring is withheld because immutable shadow persistence is incomplete."
        : evaluationState === "insufficient_sample"
          ? "Stage scoring is pending because no feature has a sufficient complete future-outcome sample."
          : "Stage metrics are read-only shadow evidence. Missing cost or stage-specific calibration prevents automatic advancement.",
    };
  });
  const unsigned = {
    schemaVersion: SHADOW_LEARNING_EVOLUTION_SCHEMA_VERSION,
    scoringVersion: SHADOW_LEARNING_EVOLUTION_SCORING_VERSION,
    productionMutationAllowed: false as const,
    activities,
    stageScores,
    reason: "Learning evolution evaluates shadow-only activities and can recommend validation priority only. It cannot modify production Alpha Radar, alerts, scans, or notifications.",
  };
  return { ...unsigned, auditHash: hash(unsigned) };
}

export function shadowTriggerHash(
  input: ShadowTriggerInput,
  schemaVersion = SHADOW_TRIGGER_SCHEMA_VERSION,
): string {
  return hash({
    schemaVersion,
    eventKey: shadowTriggerEventKey(input, schemaVersion),
    ...input,
  });
}

export function shadowCohortKey(input: {
  symbol: string;
  occurredAt: Date;
  state: string;
  sector: string | null;
}): string {
  return hash({
    baselineSignalType: "state_transition",
    symbol: input.symbol.trim().toUpperCase(),
    occurredAt: input.occurredAt,
    state: input.state,
    sector: input.sector,
  });
}

export function shadowTriggerEventKey(
  input: ShadowTriggerInput,
  schemaVersion = SHADOW_TRIGGER_SCHEMA_VERSION,
): string {
  const transitionIdentity = {
    strategyVersion: input.strategyVersion,
    signalType: input.signalType,
    symbol: input.symbol.trim().toUpperCase(),
    occurredAt: input.occurredAt,
    modelVersion: input.modelVersion,
    learningStage: input.learningStage,
  };
  if (schemaVersion === 1) return hash(transitionIdentity);
  return hash({
    schemaVersion,
    transitionIdentity,
    immutableEvidence: input,
  });
}

export function buildImmutableShadowTrigger(input: ShadowTriggerInput): ImmutableShadowTrigger {
  const normalized = {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
    evidenceSnapshot: input.evidenceSnapshot.map((item) => ({ ...item })),
    freshnessSnapshot: { ...input.freshnessSnapshot },
    inputSummary: {
      ...input.inputSummary,
      learningStage: input.learningStage,
      stageFeatures: input.inputSummary.stageFeatures
        ? { ...input.inputSummary.stageFeatures }
        : undefined,
    },
    cohortEligibilitySnapshot: {
      ...input.cohortEligibilitySnapshot,
      requiredEvidenceKeys: [...input.cohortEligibilitySnapshot.requiredEvidenceKeys],
    },
  };
  const eventKey = shadowTriggerEventKey(normalized, SHADOW_TRIGGER_SCHEMA_VERSION);
  return {
    ...normalized,
    eventKey,
    schemaVersion: SHADOW_TRIGGER_SCHEMA_VERSION,
    recordHash: shadowTriggerHash(normalized, SHADOW_TRIGGER_SCHEMA_VERSION),
  };
}

export function shadowTriggerIntegrityIsValid(record: ImmutableShadowTrigger): boolean {
  const { eventKey: _eventKey, schemaVersion, recordHash, ...input } = record;
  return (
    (schemaVersion === 1 || schemaVersion === SHADOW_TRIGGER_SCHEMA_VERSION)
    && _eventKey === shadowTriggerEventKey(input, schemaVersion)
    && recordHash === shadowTriggerHash(input, schemaVersion)
  );
}

export function isEligibleShadowObservation(input: ShadowTriggerInput): boolean {
  const freshness = input.freshnessSnapshot;
  return (
    freshness.streaming
    && freshness.complete
    && freshness.eligible
    && freshness.marketFeedState === "streaming"
    && freshness.dataQuality === "good"
    && freshness.scoreState === "available"
    && input.cohortKey === shadowCohortKey(input)
    && input.cohortEligibilitySnapshot.baselineSignalType === "state_transition"
    && input.cohortEligibilitySnapshot.baselineState === input.state
    && input.cohortEligibilitySnapshot.matchingWindowSeconds === 60
    && input.cohortEligibilitySnapshot.dataFreshRequired
    && input.cohortEligibilitySnapshot.requiredEvidenceKeys.length > 0
    && Object.hasOwn(SHADOW_STAGE_RULES, input.learningStage)
    && Number.isFinite(input.triggerPrice)
    && input.triggerPrice > 0
    && Number.isFinite(input.shadowScore)
  );
}

export function matchShadowBaselineCohorts<T>(
  shadow: ShadowCohortOutcome<T>[],
  baseline: BaselineCohortOutcome<T>[],
): Array<{ cohortKey: string; shadow: T; baseline: T }> {
  const usedBaselineEventKeys = new Set<string>();
  return [...shadow]
    .sort((left, right) => (
      left.occurredAt.getTime() - right.occurredAt.getTime()
      || left.cohortKey.localeCompare(right.cohortKey)
    ))
    .flatMap((candidate) => {
      const snapshot = candidate.cohortEligibilitySnapshot;
      if (
        !candidate.cohortKey
        || !Array.isArray(snapshot?.requiredEvidenceKeys)
        || snapshot.baselineSignalType !== "state_transition"
        || !Number.isFinite(snapshot.matchingWindowSeconds)
        || snapshot.matchingWindowSeconds <= 0
      ) return [];
      const matchingBaseline = baseline
        .filter((baselineCandidate) => (
          !usedBaselineEventKeys.has(baselineCandidate.eventKey)
          && baselineCandidate.signalType === snapshot.baselineSignalType
          && baselineCandidate.symbol === candidate.symbol
          && baselineCandidate.sector === candidate.sector
          && baselineCandidate.state === snapshot.baselineState
          && baselineCandidate.dataFresh === snapshot.dataFreshRequired
          && snapshot.requiredEvidenceKeys.every((key) => baselineCandidate.satisfiedEvidence.includes(key))
          && Math.abs(baselineCandidate.occurredAt.getTime() - candidate.occurredAt.getTime())
            <= snapshot.matchingWindowSeconds * 1_000
        ))
        .sort((left, right) => (
          Math.abs(left.occurredAt.getTime() - candidate.occurredAt.getTime())
            - Math.abs(right.occurredAt.getTime() - candidate.occurredAt.getTime())
          || left.eventKey.localeCompare(right.eventKey)
        ))[0];
      if (!matchingBaseline) return [];
      usedBaselineEventKeys.add(matchingBaseline.eventKey);
      return [{
        cohortKey: candidate.cohortKey,
        shadow: candidate.value,
        baseline: matchingBaseline.value,
      }];
    });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function hitRatePercent(values: ShadowStageFeatureSample[]): number | null {
  if (values.length === 0) return null;
  return (values.filter((sample) => sample.hit).length / values.length) * 100;
}

function stageScore(
  stage: ShadowLearningStage,
  features: ShadowStageFeatureSnapshot | undefined,
): number | null {
  if (!features) return null;
  const weights = SHADOW_STAGE_RULES[stage].featureWeights as Partial<Record<ShadowFeatureKey, number>>;
  const scored = (Object.entries(weights) as Array<[ShadowFeatureKey, number]>)
    .flatMap(([key, weight]) => {
      const value = features[key];
      return value === null || value === undefined || !Number.isFinite(value)
        ? []
        : [{ value: Math.min(100, Math.max(0, value)), weight }];
    });
  const totalWeight = scored.reduce((total, item) => total + item.weight, 0);
  if (totalWeight === 0) return null;
  return Math.round(
    (scored.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight) * 100,
  ) / 100;
}

/**
 * Evaluates a feature only against future, immutable outcome records. This is
 * deliberately a low-frequency reporting primitive, not a live score input.
 */
export function assessStageFeatureValue(input: {
  stage: ShadowLearningStage;
  featureKey: ShadowFeatureKey;
  samples: ShadowStageFeatureSample[];
  redundancyPercent?: number | null;
  persistenceState: ShadowPersistenceState;
  auditComplete: boolean;
}): ShadowStageFeatureValueAssessment {
  const unavailable = (reason: string): ShadowStageFeatureValueAssessment => ({
    stage: input.stage,
    featureKey: input.featureKey,
    tier: "unavailable",
    sampleState: "unavailable",
    sampleSize: 0,
    predictiveAdvantagePercent: null,
    averageLeadTimeMinutes: null,
    riskRewardAdvantagePercent: null,
    incrementalValuePercent: null,
    stabilityPercent: null,
    noiseRatePercent: null,
    redundancyPercent: input.redundancyPercent ?? null,
    coreEligible: false,
    reason,
  });
  if (!input.auditComplete || input.persistenceState !== "available") {
    return unavailable("Value assessment is withheld until immutable outcome evidence and archive recovery are complete.");
  }
  if (!isCoreLearningFeature(input.stage, input.featureKey)) {
    return unavailable("This feature is not part of the fixed screen for the selected learning stage.");
  }
  const samples = input.samples.filter((sample) => (
    Number.isFinite(sample.featureValue)
    && Number.isFinite(sample.favorableReturnPercent)
    && Number.isFinite(sample.maxAdversePercent)
  ));
  if (samples.length < SHADOW_MINIMUM_COMPLETE_SAMPLE) {
    return {
      ...unavailable("Insufficient Sample: value tiers require the fixed complete-outcome minimum."),
      sampleState: "insufficient_sample",
      sampleSize: samples.length,
    };
  }
  const ordered = [...samples].sort((left, right) => (left.featureValue! - right.featureValue!));
  const median = ordered[Math.floor(ordered.length / 2)]!.featureValue!;
  const high = samples.filter((sample) => sample.featureValue! >= median);
  const low = samples.filter((sample) => sample.featureValue! < median);
  if (high.length === 0 || low.length === 0) {
    return {
      ...unavailable("Insufficient variation: the feature has no independently comparable high and low observations."),
      sampleState: "insufficient_sample",
      sampleSize: samples.length,
    };
  }
  const predictiveAdvantagePercent = (hitRatePercent(high) ?? 0) - (hitRatePercent(low) ?? 0);
  const highRiskReward = (average(high.map((sample) => sample.favorableReturnPercent)) ?? 0)
    - (average(high.map((sample) => sample.maxAdversePercent)) ?? 0);
  const lowRiskReward = (average(low.map((sample) => sample.favorableReturnPercent)) ?? 0)
    - (average(low.map((sample) => sample.maxAdversePercent)) ?? 0);
  const riskRewardAdvantagePercent = highRiskReward - lowRiskReward;
  const highLeadTimes = high
    .filter((sample) => sample.hit && sample.leadTimeMinutes !== null)
    .map((sample) => sample.leadTimeMinutes as number);
  const averageLeadTimeMinutes = average(highLeadTimes);
  const foldOne = high.filter((sample) => Number.parseInt(hash(sample.eventKey).slice(0, 2), 16) % 2 === 0);
  const foldTwo = high.filter((sample) => Number.parseInt(hash(sample.eventKey).slice(0, 2), 16) % 2 === 1);
  const foldDifference = Math.abs((hitRatePercent(foldOne) ?? 0) - (hitRatePercent(foldTwo) ?? 0));
  const stabilityPercent = Math.max(0, 100 - foldDifference);
  const noiseRatePercent = (
    high.filter((sample) => sample.falseSignal === true || !sample.hit).length / high.length
  ) * 100;
  const redundancyPercent = input.redundancyPercent ?? null;
  // Incremental value is deliberately unavailable without an independently
  // measured feature-overlap value. Predictive power alone is not evidence
  // that a feature adds information beyond the existing stage screen.
  const incrementalValuePercent = redundancyPercent === null
    ? null
    : predictiveAdvantagePercent * (1 - Math.min(100, Math.max(0, redundancyPercent)) / 100);
  const hasRequiredCoreValueEvidence = (
    averageLeadTimeMinutes !== null
    && averageLeadTimeMinutes >= SHADOW_MINIMUM_CORE_LEAD_TIME_MINUTES
    && incrementalValuePercent !== null
    && incrementalValuePercent >= SHADOW_MINIMUM_CORE_INCREMENTAL_VALUE_PERCENT
    && redundancyPercent !== null
    && redundancyPercent <= SHADOW_MAXIMUM_CORE_REDUNDANCY_PERCENT
  );
  const tier: ShadowFeatureTier = (
    noiseRatePercent >= 50 || predictiveAdvantagePercent <= -5 || riskRewardAdvantagePercent < -0.5
      ? "D_noise"
      : redundancyPercent !== null && redundancyPercent >= 85
        ? "C_redundant"
        : predictiveAdvantagePercent >= 8
          && riskRewardAdvantagePercent >= 0.3
          && stabilityPercent >= 60
          && noiseRatePercent <= 30
           && hasRequiredCoreValueEvidence
          ? "A_core"
          : "B_supporting"
  );
  return {
    stage: input.stage,
    featureKey: input.featureKey,
    tier,
    sampleState: "available",
    sampleSize: samples.length,
    predictiveAdvantagePercent,
    averageLeadTimeMinutes,
    riskRewardAdvantagePercent,
    incrementalValuePercent,
    stabilityPercent,
    noiseRatePercent,
    redundancyPercent,
    coreEligible: tier === "A_core",
    reason: tier === "A_core"
      ? "Core candidate: independent future outcomes show predictive, early, risk/reward, incremental, stable, low-noise value."
      : tier === "B_supporting"
        ? "Supporting only: retained in shadow evaluation but incomplete earliness or independently measured incremental-value evidence prevents core treatment."
        : tier === "C_redundant"
          ? "Redundant: outcome value overlaps an existing feature and may only be reduced or removed in a shadow configuration."
          : "Noise: weak or adverse future-outcome value; never promoted to production from this assessment.",
  };
}

export function evaluateShadowStage(input: Omit<ShadowTriggerInput, "shadowScore" | "status">): ShadowTriggerInput | null {
  if (!isEligibleShadowObservation({ ...input, shadowScore: 0, status: "triggered" })) {
    return null;
  }
  const evidenceSatisfied = input.evidenceSnapshot.filter((item) => item.satisfied).length;
  const velocity = Math.max(0, input.inputSummary.velocity30s ?? 0);
  const acceleration = [
    input.inputSummary.momentumAcceleration,
    input.inputSummary.volumeAcceleration,
    input.inputSummary.orderFlowShift,
    input.inputSummary.spreadTightening,
  ].filter((value) => value !== null && value > 0).length;
  const genericScore = Math.round(Math.min(
    100,
    (input.inputSummary.alphaScore ?? 0) * 0.55
      + input.inputSummary.confidence * 0.25
      + evidenceSatisfied * 5
      + Math.min(10, velocity * 2)
      + acceleration * 2.5,
  ) * 100) / 100;
  const phaseScore = stageScore(input.learningStage, input.inputSummary.stageFeatures);
  const score = phaseScore === null
    ? genericScore
    : Math.round((genericScore * 0.6 + phaseScore * 0.4) * 100) / 100;
  if (score < 60 || evidenceSatisfied < 3) return null;
  return {
    ...input,
    // The persisted trigger row stores its stage-specific input as JSON. Keep
    // the stage in that immutable summary as well as on the trigger envelope,
    // so dashboard feature assessment can isolate stages after DB recovery.
    inputSummary: {
      ...input.inputSummary,
      learningStage: input.learningStage,
    },
    shadowScore: score,
    status: "triggered",
  };
}

/** Backwards-compatible sidecar entry point for the only currently verified live stage. */
export function evaluateShadowPreBreakout(input: Omit<ShadowTriggerInput, "shadowScore" | "status">): ShadowTriggerInput | null {
  return input.learningStage === "pre_breakout"
    ? evaluateShadowStage(input)
    : null;
}

function stageOutcomeSummary(
  trigger: ImmutableShadowTrigger,
  checkpoint: CalculatedCheckpoint,
  observations: Array<ValidationPriceObservation & { lifecycleSnapshot?: ShadowLifecycleSnapshot }>,
): ShadowStageOutcomeSummary {
  if (checkpoint.checkpointStatus !== "complete" || checkpoint.observedAt === null) {
    return {
      maximumFavorableExcursionPercent: null,
      maximumAdverseExcursionPercent: null,
      breakoutObserved: null,
      falseBreakoutObserved: null,
      enteredTrendContinuation: null,
      enteredTakeProfitWatch: null,
      enteredTrendReversal: null,
      lifecycleEvidenceState: "unavailable",
      reason: "Outcome is not complete; future stage evidence is withheld.",
    };
  }
  const window = observations.filter((observation) => (
    observation.observedAt.getTime() > trigger.occurredAt.getTime()
    && observation.observedAt.getTime() <= checkpoint.observedAt!.getTime()
    && Number.isFinite(observation.price)
    && observation.price > 0
  ));
  const returns = window.map((observation) => {
    const raw = ((observation.price - trigger.triggerPrice) / trigger.triggerPrice) * 100;
    return trigger.direction === "downside" ? -raw : raw;
  });
  const lifecycle = window
    .map((observation) => observation.lifecycleSnapshot)
    .filter((snapshot): snapshot is ShadowLifecycleSnapshot => snapshot !== undefined);
  if (lifecycle.length === 0) {
    return {
      maximumFavorableExcursionPercent: returns.length ? Math.max(0, ...returns) : null,
      maximumAdverseExcursionPercent: returns.length ? Math.max(0, ...returns.map((value) => -value)) : null,
      breakoutObserved: null,
      falseBreakoutObserved: null,
      enteredTrendContinuation: null,
      enteredTakeProfitWatch: null,
      enteredTrendReversal: null,
      lifecycleEvidenceState: "unavailable",
      reason: "Price outcome is complete, but no verified lifecycle snapshots were archived for this window.",
    };
  }
  const breakoutObserved = lifecycle.some((snapshot) => snapshot.postBreakoutActive);
  const enteredTrendContinuation = lifecycle.some((snapshot) => snapshot.postBreakoutState === "trend_continuation");
  const enteredTakeProfitWatch = lifecycle.some((snapshot) => snapshot.postBreakoutState === "take_profit_watch");
  const enteredTrendReversal = lifecycle.some((snapshot) => snapshot.postBreakoutState === "trend_reversal_confirmed");
  return {
    maximumFavorableExcursionPercent: returns.length ? Math.max(0, ...returns) : null,
    maximumAdverseExcursionPercent: returns.length ? Math.max(0, ...returns.map((value) => -value)) : null,
    breakoutObserved,
    falseBreakoutObserved: breakoutObserved ? enteredTrendReversal : false,
    enteredTrendContinuation,
    enteredTakeProfitWatch,
    enteredTrendReversal,
    lifecycleEvidenceState: "available",
    reason: "Outcome uses only post-trigger fresh price and lifecycle observations captured in the immutable archive.",
  };
}

export function buildShadowOutcome(
  trigger: ImmutableShadowTrigger,
  horizonDays: ValidationHorizonDays,
  observations: Array<ValidationPriceObservation & { lifecycleSnapshot?: ShadowLifecycleSnapshot }>,
): ShadowOutcomeRecord {
  const checkpoint = calculateOutcomeCheckpoint(trigger, observations, horizonDays);
  const immutableEvidence = {
    ...checkpoint,
    stageOutcome: stageOutcomeSummary(trigger, checkpoint, observations),
    triggerEventKey: trigger.eventKey,
  };
  const immutableOutcome = {
    ...immutableEvidence,
    outcomeKey: hash({
      schemaVersion: SHADOW_OUTCOME_KEY_SCHEMA_VERSION,
      immutableEvidence,
    }),
  };
  return {
    ...immutableOutcome,
    recordHash: hash({ schemaVersion: SHADOW_RECORD_SCHEMA_VERSION, ...immutableOutcome }),
  };
}

export function buildShadowPriceObservation(input: Omit<ShadowPriceObservation, "recordHash">): ShadowPriceObservation {
  return {
    ...input,
    recordHash: hash({ schemaVersion: SHADOW_RECORD_SCHEMA_VERSION, ...input }),
  };
}

export function shadowPriceObservationKey(
  input: Omit<ShadowPriceObservation, "observationKey" | "recordHash">,
): string {
  return hash({
    schemaVersion: SHADOW_PRICE_KEY_SCHEMA_VERSION,
    immutableEvidence: input,
  });
}

export function shadowPriceIntegrityIsValid(record: ShadowPriceObservation): boolean {
  const { recordHash, ...input } = record;
  return recordHash === hash({ schemaVersion: SHADOW_RECORD_SCHEMA_VERSION, ...input });
}

export function shadowOutcomeIntegrityIsValid(record: ShadowOutcomeRecord): boolean {
  const { recordHash, ...input } = record;
  return recordHash === hash({ schemaVersion: SHADOW_RECORD_SCHEMA_VERSION, ...input });
}

export function isIndependentHoldout(eventKey: string): boolean {
  return Number.parseInt(eventKey.slice(0, 2), 16) % 5 === 0;
}

export function comparableMetrics(values: ValidationMetricInput[]): ShadowMetricComparison {
  return aggregateValidationMetrics(values);
}

export function evaluateShadowPromotion(input: {
  persistenceState: ShadowPersistenceState;
  auditComplete: boolean;
  baseline: ValidationMetricInput[];
  shadow: ValidationMetricInput[];
  baselineHoldout: ValidationMetricInput[];
  shadowHoldout: ValidationMetricInput[];
}): ShadowPromotionRecommendation {
  const rules = {
    minimumCompleteSample: SHADOW_MINIMUM_COMPLETE_SAMPLE,
    minimumHoldoutSample: SHADOW_MINIMUM_HOLDOUT_SAMPLE,
    requiredHitRateAdvantagePercent: SHADOW_REQUIRED_HIT_RATE_ADVANTAGE_PERCENT,
    requiredReturnAdvantagePercent: SHADOW_REQUIRED_RETURN_ADVANTAGE_PERCENT,
    independentSplit: "Deterministic 20% event-key holdout, fixed before outcome evaluation.",
  };
  if (input.persistenceState !== "available" || !input.auditComplete) {
    return {
      status: "unavailable",
      reason: "Promotion is withheld until independent shadow archive recovery, freshness checks, and immutable audit evidence are complete.",
      evidenceState: "withheld",
      rules,
    };
  }
  if (
    input.baseline.length < rules.minimumCompleteSample
    || input.shadow.length < rules.minimumCompleteSample
    || input.baselineHoldout.length < rules.minimumHoldoutSample
    || input.shadowHoldout.length < rules.minimumHoldoutSample
  ) {
    return {
      status: "insufficient_sample",
      reason: "Insufficient Sample: baseline, shadow, and their independent holdout cohorts must meet the fixed complete-checkpoint minimum.",
      evidenceState: "complete",
      rules,
    };
  }
  const baseline = comparableMetrics(input.baselineHoldout);
  const shadow = comparableMetrics(input.shadowHoldout);
  const hitAdvantage = (shadow.hitRatePercent ?? -Infinity) - (baseline.hitRatePercent ?? Infinity);
  const returnAdvantage = (shadow.averageReturnPercent ?? -Infinity) - (baseline.averageReturnPercent ?? Infinity);
  const drawdownIsNotWorse = (shadow.maximumDrawdownPercent ?? Infinity)
    <= (baseline.maximumDrawdownPercent ?? -Infinity);
  if (
    hitAdvantage >= rules.requiredHitRateAdvantagePercent
    && returnAdvantage >= rules.requiredReturnAdvantagePercent
    && drawdownIsNotWorse
  ) {
    return {
      status: "candidate",
      reason: "Candidate only: fixed complete-sample and independent holdout thresholds are met. Production strategy remains unchanged and requires manual review.",
      evidenceState: "complete",
      rules,
    };
  }
  return {
    status: "not_eligible",
    reason: "Not eligible: shadow did not meet the pre-defined independent holdout advantage thresholds without worse drawdown.",
    evidenceState: "complete",
    rules,
  };
}

export {
  VALIDATION_HORIZONS,
  type ValidationHorizonDays,
  type ValidationMetricInput,
};