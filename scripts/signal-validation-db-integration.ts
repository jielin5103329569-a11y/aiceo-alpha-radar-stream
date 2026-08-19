import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  db,
  pool,
  radarSignalEventsTable,
  radarSignalOutcomeEventsTable,
} from "../lib/db/src/index";
import { eq } from "drizzle-orm";

import { SignalValidationService } from "../artifacts/api-server/src/lib/signalValidation";
import {
  buildImmutableSignalRecord,
  targetAtForHorizon,
  type ImmutableSignalRecord,
  type SignalTriggerInput,
} from "../artifacts/api-server/src/lib/signalValidationCore";
import type {
  ArchivedSignalHistory,
  ArchivedPriceHistory,
  ArchivedPriceObservation,
  SignalHistoryArchive,
} from "../artifacts/api-server/src/lib/signalHistoryArchive";
import { SignalValidationOutbox } from "../artifacts/api-server/src/lib/signalValidationOutbox";

async function waitFor<T>(
  label: string,
  load: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await load();
      if (ready(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${label} did not become ready.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ""}`,
  );
}

class MemorySignalHistoryArchive implements SignalHistoryArchive {
  readonly records = new Map<string, ImmutableSignalRecord>();
  readonly priceObservations = new Map<string, ArchivedPriceObservation>();

  async store(record: ImmutableSignalRecord): Promise<void> {
    const existing = this.records.get(record.eventKey);
    if (existing && existing.recordHash !== record.recordHash) {
      throw new Error("Archive idempotency conflict.");
    }
    this.records.set(record.eventKey, record);
  }

  async list(): Promise<ArchivedSignalHistory> {
    return {
      records: [...this.records.values()],
      invalidRecordCount: 0,
    };
  }

  async storePriceObservation(observation: ArchivedPriceObservation): Promise<void> {
    const existing = this.priceObservations.get(observation.observationKey);
    if (
      existing
      && (
        existing.price !== observation.price
        || existing.observedAt.getTime() !== observation.observedAt.getTime()
      )
    ) {
      throw new Error("Price archive idempotency conflict.");
    }
    this.priceObservations.set(observation.observationKey, observation);
  }

  async listPriceObservations(): Promise<ArchivedPriceHistory> {
    return {
      observations: [...this.priceObservations.values()],
      invalidRecordCount: 0,
    };
  }
}

class DeferredMemorySignalHistoryArchive extends MemorySignalHistoryArchive {
  private pendingStore: {
    record: ImmutableSignalRecord;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  store(record: ImmutableSignalRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingStore = {
        record,
        resolve,
        reject,
      };
    });
  }

  rejectPendingStore(reason: string): void {
    const pending = this.pendingStore;
    this.pendingStore = null;
    pending?.reject(new Error(reason));
  }

  commitPendingStore(): void {
    const pending = this.pendingStore;
    if (!pending) throw new Error("No pending archive write to commit.");
    this.pendingStore = null;
    this.records.set(pending.record.eventKey, pending.record);
    pending.resolve();
  }
}

function failingOutbox(directory: string): SignalValidationOutbox {
  const primary = join(directory, "unavailable-primary");
  const fallback = join(directory, "unavailable-fallback");
  mkdirSync(primary);
  mkdirSync(fallback);
  return new SignalValidationOutbox(primary, fallback);
}

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const suffix = `${process.pid}-${Date.now()}`;
const symbol = `IT${process.pid}`.slice(0, 20);
const sector = `db-integration-${suffix}`;
const outboxDirectory = mkdtempSync(join(tmpdir(), "signal-validation-db-"));
const durabilityDirectories: string[] = [];
function durabilityDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  durabilityDirectories.push(directory);
  return directory;
}
const outbox = new SignalValidationOutbox(
  join(outboxDirectory, "primary.jsonl"),
  join(outboxDirectory, "fallback.jsonl"),
);
const archive = new MemorySignalHistoryArchive();
const service = new SignalValidationService(outbox, archive);
const trigger: SignalTriggerInput = {
  symbol,
  occurredAt: new Date("2026-07-01T14:30:00.000Z"),
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
  sector,
  sectorConfirmation: "unavailable",
  sectorConfirmationReason: "Trusted sector evidence unavailable.",
  evidenceCount: 3,
  evidenceSummary: [
    {
      key: "momentum",
      label: "Momentum",
      satisfied: true,
      detail: "Fresh and improving.",
    },
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
const immutableRecord = buildImmutableSignalRecord(trigger);
  const durableTrigger: SignalTriggerInput = {
    ...trigger,
    occurredAt: new Date("2026-07-02T14:30:00.000Z"),
    sector: `${sector}-durability`,
  };
  const interruptedRecord = buildImmutableSignalRecord({
    ...durableTrigger,
    occurredAt: new Date("2026-07-03T14:30:00.000Z"),
  });
  const durableRecord = buildImmutableSignalRecord(durableTrigger);

try {
  service.captureSignal(trigger);
  const persistedSignals = await waitFor(
    "immutable trigger persistence",
    () => db
      .select()
      .from(radarSignalEventsTable)
      .where(eq(radarSignalEventsTable.eventKey, immutableRecord.eventKey)),
    (rows) => rows.length === 1,
  );
  assert.equal(persistedSignals[0]?.recordHash, immutableRecord.recordHash);
  assert.equal(persistedSignals[0]?.catalystStatus, "unavailable");

  await waitFor(
    "trigger outbox acknowledgement",
    async () => outbox.size,
    (size) => size === 0,
  );

  const targetAt = targetAtForHorizon(trigger.occurredAt, 1);
  service.observePrice(symbol, 103, targetAt);
  const completeOutcomes = await waitFor(
    "1D checkpoint completion",
    () => db
      .select()
      .from(radarSignalOutcomeEventsTable)
      .where(eq(radarSignalOutcomeEventsTable.signalId, persistedSignals[0]!.id)),
    (rows) => rows.some((row) => (
      row.horizonDays === 1
      && row.checkpointStatus === "complete"
    )),
  );
  const completed = completeOutcomes.find((row) => (
    row.horizonDays === 1
    && row.checkpointStatus === "complete"
  ));
  assert.equal(completed?.hit, true);
  assert.equal(completed?.rawReturnPercent, 3);
  assert.equal(completed?.favorableReturnPercent, 3);
  assert.equal(
    archive.priceObservations.size,
    1,
    "the fresh post-signal price used for the checkpoint must have an independent archive copy",
  );

  const dashboard = await service.getDashboard({
    sector,
    horizonDays: 1,
    limit: 1,
  });
  assert.equal(dashboard.persistenceState, "available");
  assert.equal(dashboard.totalSignals, 1);
  assert.equal(dashboard.metrics.sampleSize, 1);
  assert.equal(dashboard.metrics.sampleState, "insufficient_sample");
  assert.equal(dashboard.metrics.hitRatePercent, null);
  assert.equal(dashboard.signals[0]?.recordHash, immutableRecord.recordHash);
  assert.equal(
    dashboard.signals[0]?.checkpoints.find((checkpoint) => checkpoint.horizonDays === 1)
      ?.checkpointStatus,
    "complete",
  );

  const audit = await service.getAudit(persistedSignals[0]!.id);
  assert.equal(audit?.integrity, "verified");
  assert.equal(audit?.signal.catalystStatus, "unavailable");
  assert.equal(archive.records.size, 1, "the immutable trigger must have an independent archive copy");

  await db
    .delete(radarSignalOutcomeEventsTable)
    .where(eq(radarSignalOutcomeEventsTable.signalId, persistedSignals[0]!.id));
  await db
    .delete(radarSignalEventsTable)
    .where(eq(radarSignalEventsTable.id, persistedSignals[0]!.id));
  const replacementOutbox = new SignalValidationOutbox(
    join(outboxDirectory, "replacement-primary.jsonl"),
    join(outboxDirectory, "replacement-fallback.jsonl"),
  );
  const replacementService = new SignalValidationService(replacementOutbox, archive);
  const restoredSignals = await waitFor(
    "cross-host archive recovery",
    () => db
      .select()
      .from(radarSignalEventsTable)
      .where(eq(radarSignalEventsTable.eventKey, immutableRecord.eventKey)),
    (rows) => rows.length === 1,
  );
  assert.equal(restoredSignals[0]?.recordHash, immutableRecord.recordHash);
  assert.equal(
    (await replacementService.getAudit(restoredSignals[0]!.id))?.integrity,
    "verified",
    "a host replacement must restore the exact archived immutable trigger",
  );
  const restoredOutcomes = await waitFor(
    "cross-host price observation recovery",
    () => db
      .select()
      .from(radarSignalOutcomeEventsTable)
      .where(eq(radarSignalOutcomeEventsTable.signalId, restoredSignals[0]!.id)),
    (rows) => rows.some((row) => (
      row.horizonDays === 1
      && row.checkpointStatus === "complete"
      && row.observedPrice === 103
    )),
  );
  assert.equal(
    restoredOutcomes.find((row) => (
      row.horizonDays === 1 && row.checkpointStatus === "complete"
    ))?.favorableReturnPercent,
    3,
    "a recovered checkpoint must use the archived post-signal observation, not a fabricated replacement price",
  );

  // The acceptance boundary is the independent archive acknowledgement, not
  // the in-memory live-capture call. Both local outbox paths are deliberately
  // unavailable in this scenario.
  const interruptedArchive = new DeferredMemorySignalHistoryArchive();
  const interruptedOutboxDirectory = durabilityDirectory("signal-validation-interrupted-");
  const interruptedService = new SignalValidationService(
    failingOutbox(interruptedOutboxDirectory),
    interruptedArchive,
  );
  const interruptedReceiptPromise = interruptedService.captureSignal({
    ...durableTrigger,
    occurredAt: interruptedRecord.occurredAt,
  });
  assert.ok(interruptedReceiptPromise);
  const pendingConflictReceipt = await interruptedService.captureSignal({
    ...durableTrigger,
    occurredAt: interruptedRecord.occurredAt,
    triggerPrice: 101,
  });
  assert.equal(
    pendingConflictReceipt?.durableAcceptance,
    "not_accepted",
    "a conflicting hash must not reuse an in-flight archive acknowledgement",
  );
  let interruptedSettled = false;
  void interruptedReceiptPromise.then(() => {
    interruptedSettled = true;
  });
  await nextTurn();
  assert.equal(
    interruptedSettled,
    false,
    "a pending archive write must not be reported as durably accepted",
  );
  assert.equal(interruptedArchive.records.size, 0);
  interruptedArchive.rejectPendingStore(
    "Simulated abrupt host replacement before archive commit.",
  );
  const interruptedReceipt = await interruptedReceiptPromise;
  assert.equal(interruptedReceipt?.durableAcceptance, "not_accepted");
  assert.equal(
    (await db
      .select()
      .from(radarSignalEventsTable)
      .where(eq(radarSignalEventsTable.eventKey, interruptedRecord.eventKey))).length,
    0,
    "an unacknowledged in-memory attempt must not be fabricated as a persisted signal after replacement",
  );

  // Simulate database failure plus primary/fallback outbox failure. Once the
  // external archive acknowledges, a replacement host must recover exactly one
  // immutable record without depending on the prior process's memory or disk.
  const durableArchive = new MemorySignalHistoryArchive();
  const failedHostOutboxDirectory = durabilityDirectory("signal-validation-failed-host-");
  const failedHostService = new SignalValidationService(
    failingOutbox(failedHostOutboxDirectory),
    durableArchive,
  );
  (failedHostService as unknown as {
    persistSignalRecord: (record: ImmutableSignalRecord) => Promise<void>;
  }).persistSignalRecord = async () => {
    throw new Error("Simulated database outage before host replacement.");
  };
  const durableReceipt = await failedHostService.captureSignal(durableTrigger);
  assert.equal(
    durableReceipt?.durableAcceptance,
    "accepted",
    "archive acknowledgement is the durable acceptance boundary when database and both local outboxes are unavailable",
  );
  assert.equal(durableReceipt?.eventKey, durableRecord.eventKey);
  assert.equal(durableReceipt?.recordHash, durableRecord.recordHash);
  assert.equal(durableArchive.records.size, 1);
  const archivedConflictReceipt = await failedHostService.captureSignal({
    ...durableTrigger,
    triggerPrice: 101,
  });
  assert.equal(
    archivedConflictReceipt?.durableAcceptance,
    "not_accepted",
    "a conflicting hash must not reuse an existing archive acknowledgement",
  );
  assert.equal(
    durableArchive.records.get(durableRecord.eventKey)?.recordHash,
    durableRecord.recordHash,
    "an immutable archive conflict must preserve the original accepted hash",
  );

  const recoveryOutboxDirectory = durabilityDirectory("signal-validation-replacement-");
  const recoveredHost = new SignalValidationService(
    new SignalValidationOutbox(
      join(recoveryOutboxDirectory, "primary.jsonl"),
      join(recoveryOutboxDirectory, "fallback.jsonl"),
    ),
    durableArchive,
  );
  const recoveredDurableSignals = await waitFor(
    "durably accepted trigger recovery after host replacement",
    () => db
      .select()
      .from(radarSignalEventsTable)
      .where(eq(radarSignalEventsTable.eventKey, durableRecord.eventKey)),
    (rows) => rows.length === 1,
  );
  assert.equal(recoveredDurableSignals[0]?.recordHash, durableRecord.recordHash);

  // A second reconstructed host replays the same external archive. The unique
  // immutable event key/hash must keep the database at exactly one record.
  const duplicateRecoveryOutboxDirectory = durabilityDirectory("signal-validation-duplicate-recovery-");
  const duplicateRecoveryHost = new SignalValidationService(
    new SignalValidationOutbox(
      join(duplicateRecoveryOutboxDirectory, "primary.jsonl"),
      join(duplicateRecoveryOutboxDirectory, "fallback.jsonl"),
    ),
    durableArchive,
  );
  await waitFor(
    "first replacement outbox acknowledgement",
    async () => new SignalValidationOutbox(
      join(recoveryOutboxDirectory, "primary.jsonl"),
      join(recoveryOutboxDirectory, "fallback.jsonl"),
    ).size,
    (size) => size === 0,
  );
  await waitFor(
    "second replacement outbox acknowledgement",
    async () => new SignalValidationOutbox(
      join(duplicateRecoveryOutboxDirectory, "primary.jsonl"),
      join(duplicateRecoveryOutboxDirectory, "fallback.jsonl"),
    ).size,
    (size) => size === 0,
  );
  const replayedDurableSignals = await db
    .select()
    .from(radarSignalEventsTable)
    .where(eq(radarSignalEventsTable.eventKey, durableRecord.eventKey));
  assert.equal(replayedDurableSignals.length, 1, "two host recoveries must produce zero duplicate immutable triggers");
  assert.equal(replayedDurableSignals[0]?.recordHash, durableRecord.recordHash);
  assert.ok(recoveredHost);
  assert.ok(duplicateRecoveryHost);

  console.log(
    "Signal validation PostgreSQL integration passed: migration, immutable trigger, checkpoint, dashboard, audit, durable acceptance boundary, double-outbox failure, abrupt termination semantics, and zero-loss/zero-duplicate host recovery.",
  );
} finally {
  await pool.end();
  rmSync(outboxDirectory, { recursive: true, force: true });
  for (const directory of durabilityDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
}