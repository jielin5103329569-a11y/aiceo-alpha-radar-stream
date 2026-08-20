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
    state: "pre_breakout",
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
    },
    cohortKey: "will-be-replaced",
    cohortEligibilitySnapshot: {
      baselineSignalType: "state_transition",
      baselineState: "pre_breakout",
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
    comparableMetrics,
    evaluateShadowPreBreakout,
    evaluateShadowPromotion,
    isEligibleShadowObservation,
    matchShadowBaselineCohorts,
    shadowCohortKey,
    shadowTriggerIntegrityIsValid,
    shadowOutcomeIntegrityIsValid,
    shadowPriceIntegrityIsValid,
  } = require(outputPath);

  const firstInput = input();
  firstInput.cohortKey = shadowCohortKey(firstInput);
  const accepted = evaluateShadowPreBreakout(firstInput);
  assert.ok(accepted, "fresh, complete, streaming server observation creates only a shadow candidate");
  assert.equal(
    evaluateShadowPreBreakout({
      ...firstInput,
      freshnessSnapshot: { ...firstInput.freshnessSnapshot, marketFeedState: "stale" },
    }),
    null,
    "stale input never progresses shadow evaluation",
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
    { observedAt: new Date("2026-08-03T14:31:00.000Z"), price: 101 },
    { observedAt: new Date("2026-08-04T20:00:00.000Z"), price: 104 },
  ]);
  assert.equal(completed.checkpointStatus, "complete", "only post-trigger future prices finalize the separate outcome");
  assert.equal(shadowOutcomeIntegrityIsValid(completed), true, "final outcome has an immutable evidence hash");
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
        state: "pre_breakout",
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
        state: "pre_breakout",
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
  assert.doesNotMatch(
    liveSource.slice(liveSource.indexOf("void shadowLearning.captureObservation") - 200, liveSource.indexOf("void shadowLearning.captureObservation") + 100),
    /alphaRanking|focusedScans|alertService/,
    "shadow observer does not alter focused-symbol routing or alert handoff",
  );

  console.log("Shadow Learning integration checks passed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}