import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "shadow-learning-test-"));
const outputPath = join(outputDirectory, "shadowLearningCore.js");
const signalOutputPath = join(outputDirectory, "signalValidationCore.js");

function compile(sourcePath, outputPath) {
  const output = typescript.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(outputPath, output);
}

function input(overrides = {}) {
  return {
    strategyVersion: "shadow-alpha-velocity-v1",
    scanWindow: "60s",
    scanProfile: "fresh-streaming-pre-breakout",
    modelVersion: "shadow-evaluator-2026-08-20-v1",
    candidateSource: "test-observer",
    signalType: "shadow_pre_breakout",
    symbol: "NVDA",
    sector: "Technology",
    occurredAt: new Date("2026-08-03T14:30:00.000Z"),
    triggerPrice: 100,
    direction: "upside",
    state: "breakout_critical",
    learningStage: "pre_breakout",
    evidenceSnapshot: [
      { key: "momentum", label: "Momentum", satisfied: true, detail: "fresh" },
      { key: "volume", label: "Volume", satisfied: true, detail: "fresh" },
      { key: "flow", label: "Flow", satisfied: true, detail: "fresh" },
    ],
    freshnessSnapshot: {
      marketFeedState: "streaming",
      dataQuality: "good",
      scoreState: "available",
      streaming: true,
      complete: true,
      eligible: true,
    },
    inputSummary: {
      alphaScore: 80,
      confidence: 80,
      velocity30s: 2,
      velocity60s: 1,
      momentumAcceleration: 1,
      volumeAcceleration: 1,
      orderFlowShift: 1,
      spreadTightening: 1,
      evidenceCount: 3,
      stageFeatures: {
        relative_strength_improvement: 90,
        price_structure: 75,
        volatility_contraction: 70,
        dense_trading_zone: 65,
        sell_pressure_decay: 80,
        active_buy_improvement: 85,
        volume_structure: 82,
        breakout_distance: 60,
      },
    },
    cohortKey: "will-be-replaced",
    cohortEligibilitySnapshot: {
      baselineSignalType: "state_transition",
      baselineState: "breakout_critical",
      matchingWindowSeconds: 60,
      requiredEvidenceKeys: ["momentum", "volume", "flow"],
      dataFreshRequired: true,
    },
    ...overrides,
  };
}

try {
  compile(
    resolve("artifacts/api-server/src/lib/signalValidationCore.ts"),
    signalOutputPath,
  );
  compile(
    resolve("artifacts/api-server/src/lib/shadowLearningCore.ts"),
    outputPath,
  );
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url);
  const {
    buildImmutableShadowTrigger,
    buildShadowPriceObservation,
    buildShadowOutcome,
    assessStageFeatureValue,
    isCoreLearningFeature,
    SHADOW_CORE_LEARNING_POLICY,
    comparableMetrics,
    evaluateShadowStage,
    evaluateShadowPreBreakout,
    evaluateShadowPromotion,
    isEligibleShadowObservation,
    matchShadowBaselineCohorts,
    normalizeSignedPercentFeature,
    shadowCohortKey,
    shadowTriggerIntegrityIsValid,
    shadowOutcomeIntegrityIsValid,
    shadowPriceIntegrityIsValid,
  } = require(outputPath);

  const firstInput = input();
  assert.equal(SHADOW_CORE_LEARNING_POLICY.priority, "highest", "the three-stage policy is the highest learning priority");
  assert.deepEqual(
    Object.keys(SHADOW_CORE_LEARNING_POLICY.directions),
    ["pre_breakout", "true_breakout", "post_breakout"],
    "all core learning directions are limited to the three independent stages",
  );
  assert.equal(
    isCoreLearningFeature("true_breakout", "structure_breakout"),
    true,
    "a stage-specific feature can be admitted to that stage's core evaluation",
  );
  assert.equal(
    isCoreLearningFeature("true_breakout", "volume_trade_speed"),
    false,
    "a feature without an explicit stage purpose cannot enter that stage's core learning",
  );
  assert.equal(normalizeSignedPercentFeature(-100), 0, "signed pressure keeps the -100 endpoint");
  assert.equal(normalizeSignedPercentFeature(-20), 40, "signed pressure preserves negative magnitude");
  assert.equal(normalizeSignedPercentFeature(0), 50, "neutral pressure maps to the midpoint");
  assert.equal(normalizeSignedPercentFeature(25), 62.5, "signed pressure preserves positive magnitude");
  assert.equal(normalizeSignedPercentFeature(100), 100, "signed pressure keeps the 100 endpoint");
  firstInput.cohortKey = shadowCohortKey(firstInput);
  const accepted = evaluateShadowPreBreakout(firstInput);
  assert.ok(accepted, "fresh, complete, streaming server observation creates only a shadow candidate");
  assert.equal(
    accepted.inputSummary.learningStage,
    "pre_breakout",
    "a persisted Shadow input summary must retain its own stage for isolated later feature assessment",
  );
  assert.equal(
    evaluateShadowPreBreakout({
      ...firstInput,
      freshnessSnapshot: { ...firstInput.freshnessSnapshot, marketFeedState: "stale" },
    }),
    null,
    "stale input never progresses shadow evaluation",
  );
  const trueBreakoutInput = input({
    learningStage: "true_breakout",
    signalType: "shadow_pre_breakout",
    inputSummary: {
      ...firstInput.inputSummary,
      stageFeatures: {
        structure_breakout: 92,
        breakout_volume_confirmation: 90,
        aggressive_trade_direction: 85,
        l1_bid_ask_tilt: 82,
        post_breakout_trade_persistence: 88,
      },
    },
  });
  trueBreakoutInput.cohortKey = shadowCohortKey(trueBreakoutInput);
  assert.ok(
    evaluateShadowStage(trueBreakoutInput),
    "the independently weighted true-breakout screen can be evaluated only in the shadow framework",
  );
  assert.equal(
    evaluateShadowStage(trueBreakoutInput)?.inputSummary.learningStage,
    "true_breakout",
    "true-breakout feature evidence must be persisted with its own stage rather than inherited from pre-breakout",
  );
  assert.equal(
    evaluateShadowPreBreakout(trueBreakoutInput),
    null,
    "the live pre-breakout sidecar never reuses a true-breakout screen",
  );
  assert.equal(
    isEligibleShadowObservation({ ...accepted, freshnessSnapshot: { ...accepted.freshnessSnapshot, complete: false } }),
    false,
    "incomplete input never becomes an eligible shadow record",
  );

  const record = buildImmutableShadowTrigger(accepted);
  const duplicate = buildImmutableShadowTrigger(accepted);
  assert.equal(record.eventKey, duplicate.eventKey, "duplicate writes use a deterministic immutable key");
  assert.equal(record.recordHash, duplicate.recordHash, "duplicate writes preserve the frozen evidence hash");
  accepted.evidenceSnapshot[0].detail = "mutated after trigger";
  assert.equal(record.evidenceSnapshot[0].detail, "fresh", "future mutations cannot change frozen trigger evidence");
  assert.equal(shadowTriggerIntegrityIsValid(record), true, "stored trigger retains its integrity hash");
  assert.equal(
    shadowTriggerIntegrityIsValid({ ...record, eventKey: "substituted-event-key" }),
    false,
    "tampered trigger identity is rejected before archive recovery",
  );

  const beforeCheckpoint = buildShadowOutcome(record, 1, [
    { observedAt: new Date("2026-08-03T14:31:00.000Z"), price: 101 },
  ]);
  assert.equal(beforeCheckpoint.checkpointStatus, "pending", "future prices before the checkpoint cannot finalize an outcome");
  const completed = buildShadowOutcome(record, 1, [
    {
      observedAt: new Date("2026-08-03T14:31:00.000Z"),
      price: 101,
      lifecycleSnapshot: {
        learningStage: "true_breakout",
        postBreakoutState: "trend_continuation",
        postBreakoutActive: true,
        dataFresh: true,
      },
    },
    {
      observedAt: new Date("2026-08-04T20:00:00.000Z"),
      price: 104,
      lifecycleSnapshot: {
        learningStage: "post_breakout",
        postBreakoutState: "take_profit_watch",
        postBreakoutActive: true,
        dataFresh: true,
      },
    },
  ]);
  assert.equal(completed.checkpointStatus, "complete", "only post-trigger future prices finalize the separate outcome");
  assert.equal(shadowOutcomeIntegrityIsValid(completed), true, "final outcome has an immutable evidence hash");
  assert.equal(completed.stageOutcome.enteredTrendContinuation, true, "future lifecycle evidence records a real trend-continuation transition");
  assert.equal(completed.stageOutcome.enteredTakeProfitWatch, true, "future lifecycle evidence records a real take-profit transition");
  assert.equal(completed.stageOutcome.maximumFavorableExcursionPercent, 4, "future outcome records maximum favorable excursion");
  assert.equal(completed.stageOutcome.maximumAdverseExcursionPercent, 0, "future outcome records maximum adverse excursion");
  assert.equal(
    shadowOutcomeIntegrityIsValid({ ...completed, observedPrice: 999 }),
    false,
    "tampered outcome evidence is rejected before recovery",
  );
  const archivedPrice = buildShadowPriceObservation({
    observationKey: "NVDA|2026-08-03T14:31:00.000Z|101",
    symbol: "NVDA",
    observedAt: new Date("2026-08-03T14:31:00.000Z"),
    price: 101,
    source: "Databento EQUS.MINI live",
    freshness: "fresh",
  });
  assert.equal(shadowPriceIntegrityIsValid(archivedPrice), true, "post-trigger price has immutable archive evidence");
  assert.equal(
    shadowPriceIntegrityIsValid({ ...archivedPrice, price: 102 }),
    false,
    "tampered price evidence is rejected before recovery",
  );
  assert.equal(record.recordHash, duplicate.recordHash, "outcome computation never rewrites trigger evidence");

  const coreSamples = Array.from({ length: 20 }, (_, index) => ({
    eventKey: `core-${index}`,
    featureValue: index < 10 ? 90 : 20,
    hit: index < 10,
    favorableReturnPercent: index < 10 ? 4 : 0.5,
    maxAdversePercent: index < 10 ? 0.5 : 3,
    leadTimeMinutes: index < 10 ? 15 : 60,
    falseSignal: index < 10 ? false : true,
  }));
  const coreAssessment = assessStageFeatureValue({
    stage: "pre_breakout",
    featureKey: "relative_strength_improvement",
    samples: coreSamples,
    redundancyPercent: 20,
    persistenceState: "available",
    auditComplete: true,
  });
  assert.equal(coreAssessment.tier, "A_core", "predictive, stable, low-noise pre-breakout data becomes a core shadow feature");
  assert.equal(coreAssessment.coreEligible, true, "only independently valuable A-tier evidence can enter the core learning candidate set");
  const incompleteCoreAssessment = assessStageFeatureValue({
    stage: "pre_breakout",
    featureKey: "relative_strength_improvement",
    samples: coreSamples.map((sample) => ({ ...sample, leadTimeMinutes: null })),
    redundancyPercent: null,
    persistenceState: "available",
    auditComplete: true,
  });
  assert.equal(incompleteCoreAssessment.tier, "B_supporting", "missing earliness or independent incremental-value evidence cannot become a core feature");
  assert.equal(incompleteCoreAssessment.coreEligible, false, "core admission fails closed when shared value criteria are incomplete");
  const noiseAssessment = assessStageFeatureValue({
    stage: "post_breakout",
    featureKey: "new_high_quality",
    samples: coreSamples.map((sample) => ({ ...sample, hit: false, falseSignal: true, favorableReturnPercent: -1 })),
    persistenceState: "available",
    auditComplete: true,
  });
  assert.equal(noiseAssessment.tier, "D_noise", "high false-signal post-breakout data is classified as noise");
  assert.equal(noiseAssessment.coreEligible, false, "noise cannot enter the core learning candidate set");
  const withheldAssessment = assessStageFeatureValue({
    stage: "true_breakout",
    featureKey: "structure_breakout",
    samples: coreSamples,
    persistenceState: "unavailable",
    auditComplete: false,
  });
  assert.equal(withheldAssessment.tier, "unavailable", "missing audit recovery withholds all learning tiers");
  assert.equal(withheldAssessment.coreEligible, false, "withheld evidence never enters core learning");

  const worse = { hit: false, rawReturnPercent: -1, favorableReturnPercent: -1, maxDrawdownPercent: 4, leadTimeMinutes: null };
  const better = { hit: true, rawReturnPercent: 3, favorableReturnPercent: 3, maxDrawdownPercent: -0.5, leadTimeMinutes: 20 };
  const insufficient = evaluateShadowPromotion({
    persistenceState: "available",
    auditComplete: true,
    baseline: [better],
    shadow: [better],
    baselineHoldout: [better],
    shadowHoldout: [better],
  });
  assert.equal(insufficient.status, "insufficient_sample", "small cohorts are explicitly withheld");
  const available = comparableMetrics(Array.from({ length: 20 }, () => better));
  assert.equal(available.sampleState, "available", "the fixed complete-sample threshold is auditable");
  const rejected = evaluateShadowPromotion({
    persistenceState: "available",
    auditComplete: true,
    baseline: Array.from({ length: 20 }, () => better),
    shadow: Array.from({ length: 20 }, () => worse),
    baselineHoldout: Array.from({ length: 8 }, () => better),
    shadowHoldout: Array.from({ length: 8 }, () => worse),
  });
  assert.equal(rejected.status, "not_eligible", "the server promotion gate rejects underperforming shadow metrics");
  const matchedCohorts = matchShadowBaselineCohorts(
    [{
      cohortKey: record.cohortKey,
      symbol: record.symbol,
      sector: record.sector,
      occurredAt: record.occurredAt,
      cohortEligibilitySnapshot: record.cohortEligibilitySnapshot,
      value: better,
    }],
    [
      {
        eventKey: "unmatched-history",
        symbol: "NVDA",
        sector: "Technology",
        occurredAt: new Date("2026-08-03T13:00:00.000Z"),
        state: "breakout_critical",
        signalType: "state_transition",
        dataFresh: true,
        satisfiedEvidence: ["momentum", "volume", "flow"],
        value: worse,
      },
      {
        eventKey: "matched-observation",
        symbol: "NVDA",
        sector: "Technology",
        occurredAt: new Date("2026-08-03T14:30:00.000Z"),
        state: "breakout_critical",
        signalType: "state_transition",
        dataFresh: true,
        satisfiedEvidence: ["momentum", "volume", "flow"],
        value: better,
      },
    ],
  );
  assert.equal(matchedCohorts.length, 1, "only the trigger-time observational cohort is comparable");
  assert.equal(
    matchedCohorts[0].baseline,
    better,
    "unmatched historical baseline events cannot affect promotion metrics",
  );

  const recoveredArchive = new Map([[record.eventKey, structuredClone(record)]]);
  const recovered = recoveredArchive.get(record.eventKey);
  assert.ok(recovered && shadowTriggerIntegrityIsValid(recovered), "archive-backed immutable trigger survives host replacement recovery");
  const liveSource = readFileSync(resolve("artifacts/api-server/src/lib/databentoLive.ts"), "utf8");
  assert.match(liveSource, /void shadowLearning\.captureObservation/, "shadow persistence remains non-blocking beside live processing");
  assert.match(
    liveSource,
    /signalType: "shadow_true_breakout"/,
    "verified true-breakout observations use an independent shadow trigger identity",
  );
  assert.match(
    liveSource,
    /signalType: "shadow_post_breakout"/,
    "post-breakout lifecycle observations use an independent shadow trigger identity",
  );
  const stagedSidecarSource = liveSource.slice(
    liveSource.indexOf("private capturePostBreakoutShadowStages"),
    liveSource.indexOf("private recordSignalHistory"),
  );
  assert.doesNotMatch(
    stagedSidecarSource,
    /alphaRanking|focusedScans|alertService|AlertMonitor|signalValidation\.captureSignal/,
    "all three stage sidecars remain isolated from live routing, production signals, and alert handoff",
  );

  console.log("Shadow Learning integration checks passed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}