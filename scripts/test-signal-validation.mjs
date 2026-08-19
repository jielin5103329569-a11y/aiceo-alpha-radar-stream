import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const sourcePath = resolve("artifacts/api-server/src/lib/signalValidationCore.ts");
const outputDirectory = mkdtempSync(join(tmpdir(), "signal-validation-test-"));
const outputPath = join(outputDirectory, "signalValidationCore.js");
const outboxOutputPath = join(outputDirectory, "signalValidationOutbox.js");

try {
  const source = readFileSync(sourcePath, "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(outputPath, output);
  const outboxSource = readFileSync(
    resolve("artifacts/api-server/src/lib/signalValidationOutbox.ts"),
    "utf8",
  );
  const outboxOutput = typescript.transpileModule(outboxSource, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(outboxOutputPath, outboxOutput);
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  const require = createRequire(import.meta.url);
  const {
    aggregateValidationMetrics,
    buildImmutableSignalRecord,
    calculateOutcomeCheckpoint,
    signalRecordIntegrityIsValid,
    targetAtForHorizon,
  } = require(outputPath);
  const { SignalValidationOutbox } = require(outboxOutputPath);

  const occurredAt = new Date("2026-08-19T14:30:00.000Z");
  const trigger = {
    symbol: "NVDA",
    occurredAt,
    fromState: "watch",
    state: "accelerating",
    confirmationStatus: "pending",
    signalType: "state_transition",
    direction: "upside",
    triggerPrice: 100,
    alphaScore: 78,
    signalScore: 74,
    confidence: 92,
    volumeValue: 2.4,
    volumeScore: 80,
    velocity30s: 16,
    velocity60s: 9,
    momentumAcceleration: 12,
    volumeAcceleration: 8,
    orderFlowShift: 5,
    spreadTightening: 2,
    sector: null,
    sectorConfirmation: "unavailable",
    sectorConfirmationReason: "Trusted sector evidence unavailable.",
    evidenceCount: 3,
    evidenceSummary: [
      { key: "momentum", label: "Momentum", satisfied: true, detail: "Fresh and improving." },
    ],
    satisfiedEvidence: ["Momentum"],
    missingEvidence: ["Sector confirmation"],
    dataFresh: true,
    freshness: {
      marketFeedState: "streaming",
      dataQuality: "good",
      scoreState: "available",
      momentum: "fresh",
      volume: "fresh",
      orderFlow: "fresh",
      spread: "fresh",
    },
    source: "Databento EQUS.MINI live",
    catalystStatus: "unavailable",
  };

  const firstRecord = buildImmutableSignalRecord(trigger);
  const duplicateRecord = buildImmutableSignalRecord({
    ...trigger,
    evidenceSummary: trigger.evidenceSummary.map((item) => ({ ...item })),
  });
  assert.equal(
    duplicateRecord.eventKey,
    firstRecord.eventKey,
    "the same trigger identity must produce one idempotency key",
  );
  assert.equal(
    duplicateRecord.recordHash,
    firstRecord.recordHash,
    "equivalent trigger evidence must produce a stable immutable hash",
  );
  assert.equal(
    signalRecordIntegrityIsValid(firstRecord),
    true,
    "an unchanged trigger record must pass integrity verification",
  );
  assert.equal(
    signalRecordIntegrityIsValid({ ...firstRecord, triggerPrice: 101 }),
    false,
    "changing trigger-time data after persistence must fail integrity verification",
  );
  assert.equal(
    Object.hasOwn(firstRecord, "rawReturnPercent"),
    false,
    "future outcome fields must not be part of the immutable trigger record",
  );

  const outboxPath = join(outputDirectory, "trigger-outbox.jsonl");
  const outbox = new SignalValidationOutbox(outboxPath);
  const burstRecords = Array.from({ length: 150 }, (_, index) => buildImmutableSignalRecord({
    ...trigger,
    occurredAt: new Date(occurredAt.getTime() + index),
  }));
  for (const record of burstRecords) await outbox.store(record);
  await outbox.store(burstRecords[0]);
  assert.equal(outbox.size, 150, "a burst larger than the old queue cap must retain every unique trigger");

  const afterRestart = new SignalValidationOutbox(outboxPath);
  assert.equal(afterRestart.size, 150, "trigger records must survive service reconstruction");
  assert.equal(
    afterRestart.list().every((record) => signalRecordIntegrityIsValid(record)),
    true,
    "every replayed trigger must retain its immutable hash",
  );
  await afterRestart.acknowledge(
    burstRecords.slice(0, 75).map((record) => record.eventKey),
  );
  const partiallyReplayed = new SignalValidationOutbox(outboxPath);
  assert.equal(partiallyReplayed.size, 75, "only acknowledged trigger records may leave the outbox");
  await partiallyReplayed.acknowledge(
    partiallyReplayed.list().map((record) => record.eventKey),
  );
  assert.equal(
    new SignalValidationOutbox(outboxPath).size,
    0,
    "fully replayed triggers must compact to an empty outbox",
  );

  const unavailablePrimaryPath = join(outputDirectory, "unavailable-primary");
  const emergencyOutboxPath = join(outputDirectory, "emergency-outbox.jsonl");
  mkdirSync(unavailablePrimaryPath);
  const emergencyOutbox = new SignalValidationOutbox(
    unavailablePrimaryPath,
    emergencyOutboxPath,
  );
  await emergencyOutbox.store(firstRecord);
  const emergencyRecovery = new SignalValidationOutbox(
    unavailablePrimaryPath,
    emergencyOutboxPath,
  );
  assert.equal(
    emergencyRecovery.size,
    1,
    "a trigger must survive reconstruction through the fsync-backed fallback when the primary path is unavailable",
  );
  assert.equal(
    emergencyRecovery.invalidLineCount,
    1,
    "an unreadable primary path must remain an explicit validation-integrity failure",
  );

  const unavailableFallbackPath = join(outputDirectory, "unavailable-fallback");
  mkdirSync(unavailableFallbackPath);
  await assert.rejects(
    new SignalValidationOutbox(
      unavailablePrimaryPath,
      unavailableFallbackPath,
    ).store(burstRecords[1]),
    AggregateError,
    "failure of both fsync-backed paths must be explicit rather than silently dropping a trigger",
  );

  const pending = calculateOutcomeCheckpoint(
    trigger,
    [
      { observedAt: new Date("2026-08-19T14:20:00.000Z"), price: 150 },
      { observedAt: new Date("2026-08-19T14:40:00.000Z"), price: 101 },
    ],
    1,
  );
  assert.equal(pending.checkpointStatus, "pending", "a checkpoint must remain pending before its target");
  assert.equal(pending.rawReturnPercent, null, "pending checkpoints must not manufacture a return");

  const completed = calculateOutcomeCheckpoint(
    trigger,
    [
      { observedAt: new Date("2026-08-19T14:20:00.000Z"), price: 150 },
      { observedAt: occurredAt, price: 150 },
      { observedAt: new Date("2026-08-19T14:40:00.000Z"), price: 98 },
      { observedAt: new Date("2026-08-19T14:50:00.000Z"), price: 103 },
      { observedAt: new Date("2026-08-20T20:00:00.000Z"), price: 102 },
    ],
    1,
  );
  assert.equal(completed.checkpointStatus, "complete", "the first fresh price at target must complete the checkpoint");
  assert.equal(completed.rawReturnPercent, 2, "the checkpoint return must use trigger price and future price only");
  assert.equal(completed.maxDrawdownPercent, -2, "drawdown must include post-trigger adverse observations");
  assert.equal(completed.hit, true, "a post-trigger 2% favorable move must count as a hit");
  assert.equal(completed.leadTimeMinutes, 20, "lead time must start at the immutable trigger timestamp");

  const unavailable = calculateOutcomeCheckpoint(
    trigger,
    [{ observedAt: new Date("2026-08-21T01:00:00.000Z"), price: 104 }],
    1,
  );
  assert.equal(
    unavailable.checkpointStatus,
    "unavailable",
    "a price observed too long after the target close must not backfill the checkpoint",
  );
  assert.equal(unavailable.rawReturnPercent, null);

  const friday = new Date("2026-08-21T14:30:00.000Z");
  assert.equal(
    targetAtForHorizon(friday, 1).toISOString(),
    "2026-08-24T20:00:00.000Z",
    "session checkpoints must skip weekends and resolve to the US market close",
  );
  assert.equal(
    targetAtForHorizon(occurredAt, 20).toISOString(),
    "2026-09-17T20:00:00.000Z",
    "20D checkpoints must skip the Labor Day exchange holiday",
  );
  assert.equal(
    targetAtForHorizon(new Date("2026-07-02T14:30:00.000Z"), 1).toISOString(),
    "2026-07-06T20:00:00.000Z",
    "the observed Independence Day closure must not count as a trading session",
  );
  assert.equal(
    targetAtForHorizon(new Date("2026-04-02T14:30:00.000Z"), 1).toISOString(),
    "2026-04-06T20:00:00.000Z",
    "Good Friday must not count as a trading session",
  );
  assert.equal(
    targetAtForHorizon(new Date("2026-11-25T15:30:00.000Z"), 1).toISOString(),
    "2026-11-27T18:00:00.000Z",
    "the day after Thanksgiving must use the 13:00 Eastern early close",
  );
  assert.equal(
    targetAtForHorizon(new Date("2026-03-06T15:30:00.000Z"), 1).toISOString(),
    "2026-03-09T20:00:00.000Z",
    "checkpoint close time must follow the Eastern daylight-saving transition",
  );

  const metricRow = {
    hit: true,
    rawReturnPercent: 3,
    favorableReturnPercent: 3,
    maxDrawdownPercent: -1,
    leadTimeMinutes: 30,
  };
  const insufficient = aggregateValidationMetrics(Array.from({ length: 19 }, () => metricRow));
  assert.equal(insufficient.sampleState, "insufficient_sample", "nineteen completed outcomes are not enough");
  assert.equal(insufficient.hitRatePercent, null, "accuracy must stay null for insufficient samples");
  assert.equal(insufficient.falsePositiveRatePercent, null, "false-positive rate must stay null for insufficient samples");

  const available = aggregateValidationMetrics([
    ...Array.from({ length: 15 }, () => metricRow),
    ...Array.from({ length: 5 }, () => ({
      hit: false,
      rawReturnPercent: -1,
      favorableReturnPercent: -1,
      maxDrawdownPercent: -3,
      leadTimeMinutes: null,
    })),
  ]);
  assert.equal(available.sampleState, "available", "twenty completed outcomes unlock metrics");
  assert.equal(available.sampleSize, 20);
  assert.equal(available.hitRatePercent, 75);
  assert.equal(available.falsePositiveRatePercent, 25);
  assert.equal(available.averageReturnPercent, 2);
  assert.equal(available.maximumDrawdownPercent, -3);
  assert.equal(available.averageLeadTimeMinutes, 30);

  const directionAdjusted = aggregateValidationMetrics([
    ...Array.from({ length: 10 }, () => ({
      ...metricRow,
      rawReturnPercent: 3,
      favorableReturnPercent: 3,
    })),
    ...Array.from({ length: 10 }, () => ({
      ...metricRow,
      rawReturnPercent: -3,
      favorableReturnPercent: 3,
    })),
  ]);
  assert.equal(
    directionAdjusted.averageReturnPercent,
    3,
    "average return must use direction-adjusted outcomes so successful downside signals remain positive",
  );

  console.log("Signal persistence and future-only outcome regression checks passed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}