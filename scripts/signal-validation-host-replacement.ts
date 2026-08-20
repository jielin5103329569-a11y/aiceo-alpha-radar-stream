import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  db,
  pool,
  radarSignalEventsTable,
} from "../lib/db/src/index";
import { eq } from "drizzle-orm";

import { SignalValidationService } from "../artifacts/api-server/src/lib/signalValidation";
import {
  buildImmutableSignalRecord,
  type ImmutableSignalRecord,
  type SignalTriggerInput,
} from "../artifacts/api-server/src/lib/signalValidationCore";
import {
  type ArchivedPriceHistory,
  type ArchivedPriceObservation,
  type ArchivedSignalHistory,
  type SignalHistoryArchive,
} from "../artifacts/api-server/src/lib/signalHistoryArchive";
import { SignalValidationOutbox } from "../artifacts/api-server/src/lib/signalValidationOutbox";
import {
  deserializeSignalRecord,
  serializeSignalRecord,
} from "../artifacts/api-server/src/lib/signalValidationOutbox";

const role = process.env.SIGNAL_VALIDATION_HOST_ROLE;
const archiveDirectory = process.env.SIGNAL_VALIDATION_HOST_ARCHIVE_DIR;
const outboxDirectory = process.env.SIGNAL_VALIDATION_HOST_OUTBOX_DIR;
const suffix = process.env.SIGNAL_VALIDATION_HOST_SUFFIX;

assert.ok(
  role === "capture" || role === "conflict" || role === "plant-legacy-conflict" || role === "recover",
  "A supported host-replacement role is required.",
);
assert.ok(archiveDirectory, "SIGNAL_VALIDATION_HOST_ARCHIVE_DIR is required.");
assert.ok(outboxDirectory, "SIGNAL_VALIDATION_HOST_OUTBOX_DIR is required.");
assert.ok(suffix, "SIGNAL_VALIDATION_HOST_SUFFIX is required.");

class FileSignalHistoryArchive implements SignalHistoryArchive {
  constructor(
    private readonly directory: string,
    private readonly suppressRecoveryList = false,
  ) {}

  private signalPath(eventKey: string): string {
    return join(this.directory, `${encodeURIComponent(eventKey)}.json`);
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async store(record: ImmutableSignalRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const filePath = this.signalPath(record.eventKey);
    try {
      const handle = await open(filePath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(serializeSignalRecord(record)), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncDirectory(dirname(filePath));
      return;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
    const existing = deserializeSignalRecord(JSON.parse(await readFile(filePath, "utf8")));
    if (!existing || existing.recordHash !== record.recordHash) {
      throw new Error("File archive immutable key/hash conflict.");
    }
  }

  async list(): Promise<ArchivedSignalHistory> {
    if (this.suppressRecoveryList) return { records: [], invalidRecordCount: 0 };
    if (!existsSync(this.directory)) return { records: [], invalidRecordCount: 0 };
    const records: ImmutableSignalRecord[] = [];
    let invalidRecordCount = 0;
    for (const entry of await readdir(this.directory)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const record = deserializeSignalRecord(JSON.parse(
          await readFile(join(this.directory, entry), "utf8"),
        ));
        if (!record) {
          invalidRecordCount += 1;
          continue;
        }
        records.push(record);
      } catch {
        invalidRecordCount += 1;
      }
    }
    return {
      records: records.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()),
      invalidRecordCount,
    };
  }

  async storePriceObservation(_observation: ArchivedPriceObservation): Promise<void> {
    // This focused host-replacement test exercises the trigger write-ahead path.
  }

  async listPriceObservations(): Promise<ArchivedPriceHistory> {
    return { observations: [], invalidRecordCount: 0 };
  }
}

function failingOutbox(directory: string): SignalValidationOutbox {
  const primary = join(directory, "unavailable-primary");
  const fallback = join(directory, "unavailable-fallback");
  if (!existsSync(primary)) {
    throw new Error("The test wrapper must prepare unavailable outbox paths.");
  }
  return new SignalValidationOutbox(primary, fallback);
}

async function waitFor<T>(
  label: string,
  load: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} did not become ready.`);
}

const trigger: SignalTriggerInput = {
  symbol: "NVDA",
  occurredAt: new Date("2026-07-07T14:30:00.000Z"),
  fromState: "watch",
  state: "latent",
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
  sector: `host-replacement-${suffix}`,
  sectorConfirmation: "unavailable",
  sectorConfirmationReason: "Trusted sector evidence unavailable.",
  evidenceCount: 3,
  evidenceSummary: [{ key: "momentum", label: "Momentum", satisfied: true, detail: "Fresh and improving." }],
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
const record = buildImmutableSignalRecord(trigger);
const conflictingTrigger = {
  ...trigger,
  triggerPrice: 101,
};
const conflictingRecord = buildImmutableSignalRecord(conflictingTrigger);
const archive = new FileSignalHistoryArchive(archiveDirectory);

try {
  if (role === "capture") {
    const service = new SignalValidationService(failingOutbox(outboxDirectory), archive);
    (service as unknown as {
      persistSignalRecord: (value: ImmutableSignalRecord) => Promise<void>;
    }).persistSignalRecord = async () => {
      throw new Error("Simulated database outage in original host.");
    };
    const receipt = await service.captureSignal(trigger);
    assert.equal(receipt?.durableAcceptance, "accepted");
    assert.equal(receipt?.eventKey, record.eventKey);
    assert.equal(receipt?.recordHash, record.recordHash);
    assert.equal((await archive.list()).records.length, 1);
    console.log("Accepted trigger committed to fsync-backed archive before abrupt host exit.");
    process.exit(0);
  }

  if (role === "conflict") {
    const service = new SignalValidationService(
      new SignalValidationOutbox(
        join(outboxDirectory, "primary.jsonl"),
        join(outboxDirectory, "fallback.jsonl"),
      ),
      new FileSignalHistoryArchive(archiveDirectory, true),
    );
    const receipt = await service.captureSignal(conflictingTrigger);
    assert.equal(
      receipt?.durableAcceptance,
      "not_accepted",
      "an archive hash conflict must not be accepted when local outbox paths are available again",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      new SignalValidationOutbox(
        join(outboxDirectory, "primary.jsonl"),
        join(outboxDirectory, "fallback.jsonl"),
      ).size,
      0,
      "a rejected archive conflict must never enter a recovered local outbox",
    );
    console.log("Available outbox rejected conflicting immutable capture before enqueue.");
    process.exit(0);
  }

  if (role === "plant-legacy-conflict") {
    const outbox = new SignalValidationOutbox(
      join(outboxDirectory, "primary.jsonl"),
      join(outboxDirectory, "fallback.jsonl"),
    );
    await outbox.store(conflictingRecord);
    assert.equal(outbox.size, 1);
    console.log("Legacy conflicting local outbox record prepared for recovery reconciliation.");
    process.exit(0);
  }

  const service = new SignalValidationService(
    new SignalValidationOutbox(
      join(outboxDirectory, "primary.jsonl"),
      join(outboxDirectory, "fallback.jsonl"),
    ),
    archive,
  );
  const restored = await waitFor(
    "cross-process accepted trigger replay",
    () => db
      .select()
      .from(radarSignalEventsTable)
      .where(eq(radarSignalEventsTable.eventKey, record.eventKey)),
    (rows) => rows.length === 1,
  );
  assert.equal(restored[0]?.recordHash, record.recordHash);
  const persisted = await db
    .select()
    .from(radarSignalEventsTable)
    .where(eq(radarSignalEventsTable.eventKey, record.eventKey));
  assert.equal(persisted.length, 1, "each replacement host must retain exactly one immutable record.");
  assert.equal(
    await waitFor(
      "recovered trigger acknowledgement",
      async () => new SignalValidationOutbox(
        join(outboxDirectory, "primary.jsonl"),
        join(outboxDirectory, "fallback.jsonl"),
      ).size,
      (size) => size === 0,
    ),
    0,
    "a recovered trigger must be acknowledged after ordered idempotent database replay",
  );
  assert.ok(service);
  console.log("Fresh host recovered exactly one immutable trigger from fsync-backed archive.");
} finally {
  await pool.end();
}