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
export const SHADOW_STRATEGY_VERSION = "shadow-alpha-velocity-v1";
export const SHADOW_SCAN_WINDOW = "60s";
export const SHADOW_SCAN_PROFILE = "fresh-streaming-pre-breakout";
export const SHADOW_MODEL_VERSION = "shadow-evaluator-2026-08-20-v1";
export const SHADOW_MINIMUM_COMPLETE_SAMPLE = MINIMUM_VALIDATION_SAMPLE;
export const SHADOW_MINIMUM_HOLDOUT_SAMPLE = 8;
export const SHADOW_REQUIRED_HIT_RATE_ADVANTAGE_PERCENT = 8;
export const SHADOW_REQUIRED_RETURN_ADVANTAGE_PERCENT = 0.5;

export type ShadowSignalType = "shadow_pre_breakout";
export type ShadowTriggerStatus = "triggered";
export type ShadowPersistenceState = "available" | "unavailable";
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
};

export type ShadowOutcomeRecord = CalculatedCheckpoint & {
  outcomeKey: string;
  recordHash: string;
  triggerEventKey: string;
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

export function shadowTriggerHash(input: ShadowTriggerInput): string {
  return hash({
    schemaVersion: SHADOW_RECORD_SCHEMA_VERSION,
    eventKey: shadowTriggerEventKey(input),
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

function shadowTriggerEventKey(input: ShadowTriggerInput): string {
  return hash({
    strategyVersion: input.strategyVersion,
    signalType: input.signalType,
    symbol: input.symbol.trim().toUpperCase(),
    occurredAt: input.occurredAt,
    modelVersion: input.modelVersion,
  });
}

export function buildImmutableShadowTrigger(input: ShadowTriggerInput): ImmutableShadowTrigger {
  const normalized = {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
    evidenceSnapshot: input.evidenceSnapshot.map((item) => ({ ...item })),
    freshnessSnapshot: { ...input.freshnessSnapshot },
    inputSummary: { ...input.inputSummary },
    cohortEligibilitySnapshot: {
      ...input.cohortEligibilitySnapshot,
      requiredEvidenceKeys: [...input.cohortEligibilitySnapshot.requiredEvidenceKeys],
    },
  };
  const eventKey = shadowTriggerEventKey(normalized);
  return {
    ...normalized,
    eventKey,
    schemaVersion: SHADOW_RECORD_SCHEMA_VERSION,
    recordHash: shadowTriggerHash(normalized),
  };
}

export function shadowTriggerIntegrityIsValid(record: ImmutableShadowTrigger): boolean {
  const { eventKey: _eventKey, schemaVersion, recordHash, ...input } = record;
  return (
    schemaVersion === SHADOW_RECORD_SCHEMA_VERSION
    && _eventKey === shadowTriggerEventKey(input)
    && recordHash === shadowTriggerHash(input)
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

export function evaluateShadowPreBreakout(input: Omit<ShadowTriggerInput, "shadowScore" | "status">): ShadowTriggerInput | null {
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
  const score = Math.round(Math.min(
    100,
    (input.inputSummary.alphaScore ?? 0) * 0.55
      + input.inputSummary.confidence * 0.25
      + evidenceSatisfied * 5
      + Math.min(10, velocity * 2)
      + acceleration * 2.5,
  ) * 100) / 100;
  if (score < 60 || evidenceSatisfied < 3) return null;
  return { ...input, shadowScore: score, status: "triggered" };
}

export function buildShadowOutcome(
  trigger: ImmutableShadowTrigger,
  horizonDays: ValidationHorizonDays,
  observations: ValidationPriceObservation[],
): ShadowOutcomeRecord {
  const checkpoint = calculateOutcomeCheckpoint(trigger, observations, horizonDays);
  const immutableOutcome = {
    ...checkpoint,
    triggerEventKey: trigger.eventKey,
    outcomeKey: hash({
      triggerEventKey: trigger.eventKey,
      horizonDays,
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