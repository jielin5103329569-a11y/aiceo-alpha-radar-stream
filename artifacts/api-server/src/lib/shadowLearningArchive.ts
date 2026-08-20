import { Storage } from "@google-cloud/storage";

import {
  shadowOutcomeIntegrityIsValid,
  shadowPriceIntegrityIsValid,
  shadowTriggerIntegrityIsValid,
  type ImmutableShadowTrigger,
  type ShadowOutcomeRecord,
  type ShadowPriceObservation,
} from "./shadowLearningCore";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const PREFIX = "alpha-radar/shadow-learning/v1";

export type ShadowArchiveHistory = {
  triggers: ImmutableShadowTrigger[];
  prices: ShadowPriceObservation[];
  outcomes: ShadowOutcomeRecord[];
  invalidRecordCount: number;
};

export interface ShadowLearningArchive {
  storeTrigger(trigger: ImmutableShadowTrigger): Promise<void>;
  storePrice(observation: ShadowPriceObservation): Promise<void>;
  storeOutcome(outcome: ShadowOutcomeRecord): Promise<void>;
  list(): Promise<ShadowArchiveHistory>;
}

type Envelope = {
  version: 1;
  type: "trigger" | "price" | "outcome";
  key: string;
  recordHash: string;
  record: unknown;
};

function serialize(value: unknown): unknown {
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function deserialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deserialize);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (typeof item.__date === "string") return new Date(item.__date);
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, deserialize(child)]));
  }
  return value;
}

function validPrice(value: unknown): value is ShadowPriceObservation {
  const item = value as Partial<ShadowPriceObservation>;
  return Boolean(
    item
    && typeof item.observationKey === "string"
    && typeof item.recordHash === "string"
    && typeof item.symbol === "string"
    && item.observedAt instanceof Date
    && Number.isFinite(item.price)
    && shadowPriceIntegrityIsValid(item as ShadowPriceObservation),
  );
}

function validOutcome(value: unknown): value is ShadowOutcomeRecord {
  const item = value as Partial<ShadowOutcomeRecord>;
  return Boolean(
    item
    && typeof item.outcomeKey === "string"
    && typeof item.recordHash === "string"
    && typeof item.triggerEventKey === "string"
    && typeof item.horizonDays === "number"
    && item.targetAt instanceof Date
    && shadowOutcomeIntegrityIsValid(item as ShadowOutcomeRecord),
  );
}

export class GoogleCloudShadowLearningArchive implements ShadowLearningArchive {
  private readonly bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  private readonly storage = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });

  private bucket() {
    if (!this.bucketId) {
      throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not configured; shadow promotion is withheld.");
    }
    return this.storage.bucket(this.bucketId);
  }

  private async store(
    type: Envelope["type"],
    key: string,
    recordHash: string,
    record: unknown,
  ): Promise<void> {
    const file = this.bucket().file(`${PREFIX}/${type}/${key}.json`);
    const envelope: Envelope = {
      version: 1,
      type,
      key,
      recordHash,
      record: serialize(record),
    };
    try {
      await file.save(JSON.stringify(envelope), {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: "application/json", cacheControl: "no-store" },
      });
    } catch (error: unknown) {
      const code = (error as { code?: number }).code;
      if (code !== 412) throw error;
      const [contents] = await file.download();
      const existing = JSON.parse(contents.toString("utf8")) as Envelope;
      if (
        existing.version !== 1
        || existing.type !== type
        || existing.key !== key
        || existing.recordHash !== recordHash
        || JSON.stringify(existing.record) !== JSON.stringify(envelope.record)
      ) {
        throw new Error(`Shadow archive key ${key} already exists with different immutable evidence.`);
      }
    }
  }

  storeTrigger(trigger: ImmutableShadowTrigger): Promise<void> {
    return this.store("trigger", trigger.eventKey, trigger.recordHash, trigger);
  }

  storePrice(observation: ShadowPriceObservation): Promise<void> {
    return this.store("price", observation.observationKey, observation.recordHash, observation);
  }

  storeOutcome(outcome: ShadowOutcomeRecord): Promise<void> {
    return this.store("outcome", outcome.outcomeKey, outcome.recordHash, outcome);
  }

  async list(): Promise<ShadowArchiveHistory> {
    const [files] = await this.bucket().getFiles({ prefix: `${PREFIX}/` });
    const history: ShadowArchiveHistory = { triggers: [], prices: [], outcomes: [], invalidRecordCount: 0 };
    for (const file of files) {
      try {
        const [contents] = await file.download();
        const envelope = JSON.parse(contents.toString("utf8")) as Envelope;
        const record = deserialize(envelope.record);
        if (
          envelope.version === 1
          && envelope.type === "trigger"
          && (record as ImmutableShadowTrigger).eventKey === envelope.key
          && (record as ImmutableShadowTrigger).recordHash === envelope.recordHash
          && shadowTriggerIntegrityIsValid(record as ImmutableShadowTrigger)
        ) {
          history.triggers.push(record as ImmutableShadowTrigger);
        } else if (
          envelope.version === 1
          && envelope.type === "price"
          && (record as ShadowPriceObservation).observationKey === envelope.key
          && (record as ShadowPriceObservation).recordHash === envelope.recordHash
          && validPrice(record)
        ) {
          history.prices.push(record);
        } else if (
          envelope.version === 1
          && envelope.type === "outcome"
          && (record as ShadowOutcomeRecord).outcomeKey === envelope.key
          && (record as ShadowOutcomeRecord).recordHash === envelope.recordHash
          && validOutcome(record)
        ) {
          history.outcomes.push(record);
        } else {
          history.invalidRecordCount += 1;
        }
      } catch {
        history.invalidRecordCount += 1;
      }
    }
    return history;
  }
}