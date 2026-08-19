import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  signalRecordIntegrityIsValid,
  type ImmutableSignalRecord,
} from "./signalValidationCore";

export type SerializedSignalRecord = Omit<ImmutableSignalRecord, "occurredAt"> & {
  occurredAt: string;
};

export function serializeSignalRecord(record: ImmutableSignalRecord): SerializedSignalRecord {
  return {
    ...record,
    occurredAt: record.occurredAt.toISOString(),
  };
}

export function deserializeSignalRecord(value: unknown): ImmutableSignalRecord | null {
  if (!value || typeof value !== "object") return null;
  const serialized = value as Partial<SerializedSignalRecord>;
  if (typeof serialized.occurredAt !== "string") return null;
  const occurredAt = new Date(serialized.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return null;
  const record = {
    ...serialized,
    occurredAt,
  } as ImmutableSignalRecord;
  return signalRecordIntegrityIsValid(record) ? record : null;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendDurably(filePath: string, content: string): Promise<void> {
  const directoryPath = path.dirname(filePath);
  await mkdir(directoryPath, { recursive: true });
  const existed = existsSync(filePath);
  const handle = await open(filePath, "a", 0o600);
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!existed) await syncDirectory(directoryPath);
}

async function replaceDurably(filePath: string, lines: string[]): Promise<void> {
  const directoryPath = path.dirname(filePath);
  if (lines.length === 0) {
    if (existsSync(filePath)) {
      await rm(filePath);
      await syncDirectory(directoryPath);
    }
    return;
  }
  await mkdir(directoryPath, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${lines.join("\n")}\n`, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
  await syncDirectory(directoryPath);
}

export function defaultSignalValidationOutboxPath(): string {
  return path.resolve(
    process.env.SIGNAL_VALIDATION_OUTBOX_PATH
      ?? ".local/runtime/signal-validation-trigger-outbox.jsonl",
  );
}

export class SignalValidationOutbox {
  private readonly records = new Map<string, ImmutableSignalRecord>();
  private ioQueue: Promise<void> = Promise.resolve();
  readonly invalidLineCount: number;
  private readonly fallbackFilePath: string;

  constructor(
    private readonly filePath = defaultSignalValidationOutboxPath(),
    fallbackFilePath = process.env.SIGNAL_VALIDATION_OUTBOX_FALLBACK_PATH
      ?? `${filePath}.fallback`,
  ) {
    this.fallbackFilePath = path.resolve(fallbackFilePath);
    let invalidLineCount = 0;
    for (const candidatePath of [this.filePath, this.fallbackFilePath]) {
      if (!existsSync(candidatePath)) continue;
      let lines: string[];
      try {
        lines = readFileSync(candidatePath, "utf8").split("\n");
      } catch {
        invalidLineCount += 1;
        continue;
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = deserializeSignalRecord(JSON.parse(line));
          if (!record) {
            invalidLineCount += 1;
            continue;
          }
          const existing = this.records.get(record.eventKey);
          if (existing && existing.recordHash !== record.recordHash) {
            invalidLineCount += 1;
            continue;
          }
          this.records.set(record.eventKey, record);
        } catch {
          invalidLineCount += 1;
        }
      }
    }
    this.invalidLineCount = invalidLineCount;
  }

  get size(): number {
    return this.records.size;
  }

  list(): ImmutableSignalRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
      .map((record) => ({
        ...record,
        evidenceSummary: record.evidenceSummary.map((item) => ({ ...item })),
        satisfiedEvidence: [...record.satisfiedEvidence],
        missingEvidence: [...record.missingEvidence],
        freshness: { ...record.freshness },
      }));
  }

  store(record: ImmutableSignalRecord): Promise<void> {
    return this.runIo(async () => {
      const existing = this.records.get(record.eventKey);
      if (existing) {
        if (existing.recordHash !== record.recordHash) {
          throw new Error("The trigger outbox already contains this idempotency key with a different hash.");
        }
        return;
      }
      const line = `${JSON.stringify(serializeSignalRecord(record))}\n`;
      try {
        await appendDurably(this.filePath, line);
      } catch (primaryError) {
        try {
          await appendDurably(this.fallbackFilePath, line);
        } catch (fallbackError) {
          throw new AggregateError(
            [primaryError, fallbackError],
            "The trigger could not be written to either durable outbox path.",
          );
        }
      }
      this.records.set(record.eventKey, record);
    });
  }

  acknowledge(eventKeys: string[]): Promise<void> {
    return this.runIo(async () => {
      if (eventKeys.length === 0) return;
      const acknowledged = new Set(eventKeys);
      for (const candidatePath of [this.filePath, this.fallbackFilePath]) {
        if (!existsSync(candidatePath)) continue;
        const remainingLines = (await readFile(candidatePath, "utf8"))
          .split("\n")
          .filter((line) => {
            if (!line.trim()) return false;
            try {
              const record = deserializeSignalRecord(JSON.parse(line));
              return !record || !acknowledged.has(record.eventKey);
            } catch {
              return true;
            }
          });
        await replaceDurably(candidatePath, remainingLines);
      }
      for (const eventKey of eventKeys) this.records.delete(eventKey);
    });
  }

  private runIo(operation: () => Promise<void>): Promise<void> {
    const result = this.ioQueue.then(operation);
    this.ioQueue = result.catch(() => undefined);
    return result;
  }
}