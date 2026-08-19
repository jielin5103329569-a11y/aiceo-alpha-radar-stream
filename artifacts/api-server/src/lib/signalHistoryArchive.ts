import { Storage } from "@google-cloud/storage";

import {
  deserializeSignalRecord,
  serializeSignalRecord,
} from "./signalValidationOutbox";
import type { ImmutableSignalRecord } from "./signalValidationCore";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

type ArchiveEnvelope = {
  archiveVersion: 1;
  archivedAt: string;
  eventKey: string;
  recordHash: string;
  record: ReturnType<typeof serializeSignalRecord>;
};

export type ArchivedSignalHistory = {
  records: ImmutableSignalRecord[];
  invalidRecordCount: number;
};

export interface SignalHistoryArchive {
  store(record: ImmutableSignalRecord): Promise<void>;
  list(): Promise<ArchivedSignalHistory>;
}

function archivePrefix(): string {
  return (process.env.SIGNAL_VALIDATION_ARCHIVE_PREFIX
    ?? "alpha-radar/signal-validation/v1/immutable-signals")
    .replace(/^\/+|\/+$/g, "");
}

function objectName(eventKey: string): string {
  return `${archivePrefix()}/${encodeURIComponent(eventKey)}.json`;
}

function isAlreadyArchived(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && Number((error as { code?: unknown }).code) === 412;
}

function deserializeEnvelope(value: unknown): ImmutableSignalRecord | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<ArchiveEnvelope>;
  if (
    envelope.archiveVersion !== 1
    || typeof envelope.archivedAt !== "string"
    || Number.isNaN(new Date(envelope.archivedAt).getTime())
    || typeof envelope.eventKey !== "string"
    || typeof envelope.recordHash !== "string"
  ) {
    return null;
  }
  const record = deserializeSignalRecord(envelope.record);
  if (
    !record
    || record.eventKey !== envelope.eventKey
    || record.recordHash !== envelope.recordHash
  ) {
    return null;
  }
  return record;
}

/**
 * A separate GCS-backed, immutable copy of every trigger. Database writes may
 * be replayed safely from this archive after host replacement or a local-disk
 * loss because each object is keyed by the deterministic event id.
 */
export class GoogleCloudSignalHistoryArchive implements SignalHistoryArchive {
  private readonly bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  private readonly storage = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });

  private bucket() {
    if (!this.bucketId) {
      throw new Error(
        "DEFAULT_OBJECT_STORAGE_BUCKET_ID is not configured; cross-host signal history cannot be verified.",
      );
    }
    return this.storage.bucket(this.bucketId);
  }

  async store(record: ImmutableSignalRecord): Promise<void> {
    const file = this.bucket().file(objectName(record.eventKey));
    const envelope: ArchiveEnvelope = {
      archiveVersion: 1,
      archivedAt: new Date().toISOString(),
      eventKey: record.eventKey,
      recordHash: record.recordHash,
      record: serializeSignalRecord(record),
    };
    try {
      await file.save(JSON.stringify(envelope), {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: "application/json",
          cacheControl: "no-store",
        },
      });
    } catch (error) {
      if (!isAlreadyArchived(error)) throw error;
      const [contents] = await file.download();
      const archived = deserializeEnvelope(JSON.parse(contents.toString("utf8")));
      if (!archived || archived.recordHash !== record.recordHash) {
        throw new Error(
          "The immutable signal archive already contains this event key with a different or invalid record hash.",
        );
      }
    }
  }

  async list(): Promise<ArchivedSignalHistory> {
    const [files] = await this.bucket().getFiles({ prefix: `${archivePrefix()}/` });
    const records = new Map<string, ImmutableSignalRecord>();
    let invalidRecordCount = 0;
    for (const file of files) {
      try {
        const [contents] = await file.download();
        const record = deserializeEnvelope(JSON.parse(contents.toString("utf8")));
        if (!record) {
          invalidRecordCount += 1;
          continue;
        }
        const existing = records.get(record.eventKey);
        if (existing && existing.recordHash !== record.recordHash) {
          invalidRecordCount += 1;
          continue;
        }
        records.set(record.eventKey, record);
      } catch {
        invalidRecordCount += 1;
      }
    }
    return {
      records: [...records.values()].sort(
        (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
      ),
      invalidRecordCount,
    };
  }
}