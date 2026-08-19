import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  type SignalTriggerInput,
} from "../artifacts/api-server/src/lib/signalValidationCore";
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

const suffix = `${process.pid}-${Date.now()}`;
const symbol = `IT${process.pid}`.slice(0, 20);
const sector = `db-integration-${suffix}`;
const outboxDirectory = mkdtempSync(join(tmpdir(), "signal-validation-db-"));
const outbox = new SignalValidationOutbox(
  join(outboxDirectory, "primary.jsonl"),
  join(outboxDirectory, "fallback.jsonl"),
);
const service = new SignalValidationService(outbox);
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

  console.log(
    "Signal validation PostgreSQL integration passed: migration, immutable trigger, checkpoint, dashboard, and audit.",
  );
} finally {
  await pool.end();
  rmSync(outboxDirectory, { recursive: true, force: true });
}