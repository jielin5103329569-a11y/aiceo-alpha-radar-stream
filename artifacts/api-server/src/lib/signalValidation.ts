import type {
  RadarSignalEvent,
  RadarSignalOutcomeEvent,
} from "@workspace/db";
import { fileURLToPath } from "node:url";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
} from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { alias } from "drizzle-orm/pg-core";

import { logger } from "./logger";
import {
  aggregateValidationMetrics,
  buildImmutableSignalRecord,
  calculateOutcomeCheckpoint,
  signalRecordIntegrityIsValid,
  targetAtForHorizon,
  VALIDATION_HIT_THRESHOLD_PERCENT,
  VALIDATION_HORIZONS,
  type ImmutableSignalRecord,
  type SignalTriggerInput,
  type ValidationCheckpointStatus,
  type ValidationHorizonDays,
  type ValidationSignalState,
  type ValidationSignalType,
} from "./signalValidationCore";
import { SignalValidationOutbox } from "./signalValidationOutbox";

export type SignalValidationQuery = {
  state?: ValidationSignalState;
  sector?: string;
  signalType?: ValidationSignalType;
  horizonDays?: ValidationHorizonDays;
  limit?: number;
};

export type SignalValidationCheckpointView = {
  horizonDays: ValidationHorizonDays;
  checkpointStatus: ValidationCheckpointStatus;
  targetAt: Date;
  observedAt: Date | null;
  observedPrice: number | null;
  rawReturnPercent: number | null;
  favorableReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  hit: boolean | null;
  leadTimeMinutes: number | null;
  reason: string;
};

export type PersistedSignalView = {
  id: string;
  schemaVersion: number;
  recordHash: string;
  symbol: string;
  occurredAt: Date;
  fromState: string;
  state: ValidationSignalState;
  confirmationStatus: string;
  signalType: ValidationSignalType;
  direction: "upside" | "downside" | "neutral";
  triggerPrice: number;
  alphaScore: number | null;
  signalScore: number | null;
  confidence: number;
  volumeValue: number | null;
  volumeScore: number | null;
  velocity30s: number | null;
  velocity60s: number | null;
  momentumAcceleration: number | null;
  volumeAcceleration: number | null;
  orderFlowShift: number | null;
  spreadTightening: number | null;
  sector: string | null;
  sectorConfirmation: string;
  sectorConfirmationReason: string;
  evidenceCount: number;
  evidenceSummary: Array<{
    key: string;
    label: string;
    satisfied: boolean;
    detail: string;
  }>;
  satisfiedEvidence: string[];
  missingEvidence: string[];
  dataFresh: boolean;
  freshness: {
    marketFeedState: string;
    dataQuality: string;
    scoreState: string;
    momentum: string;
    volume: string;
    orderFlow: string;
    spread: string;
  };
  source: string;
  catalystStatus: string;
  checkpoints: SignalValidationCheckpointView[];
};

export type SignalValidationDashboard = {
  generatedAt: Date;
  persistenceState: "available" | "unavailable";
  reason: string;
  selectedHorizonDays: ValidationHorizonDays;
  hitThresholdPercent: number;
  metricDefinitions: {
    hit: string;
    falsePositive: string;
    leadTime: string;
    maximumDrawdown: string;
  };
  metrics: ReturnType<typeof aggregateValidationMetrics>;
  totalSignals: number;
  signals: PersistedSignalView[];
};

export type SignalValidationAudit = {
  generatedAt: Date;
  integrity: "verified" | "failed";
  signal: PersistedSignalView;
};

const MAX_DASHBOARD_SIGNALS = 100;
const MAX_PENDING_PRICE_WRITES = 100;
const MIN_PRICE_OBSERVATION_INTERVAL_MS = 15_000;
const TRIGGER_RETRY_INITIAL_MS = 1_000;
const TRIGGER_RETRY_MAX_MS = 60_000;

function checkpointFromRow(row: RadarSignalOutcomeEvent): SignalValidationCheckpointView {
  return {
    horizonDays: row.horizonDays as ValidationHorizonDays,
    checkpointStatus: row.checkpointStatus as ValidationCheckpointStatus,
    targetAt: row.targetAt,
    observedAt: row.observedAt,
    observedPrice: row.observedPrice,
    rawReturnPercent: row.rawReturnPercent,
    favorableReturnPercent: row.favorableReturnPercent,
    maxDrawdownPercent: row.maxDrawdownPercent,
    hit: row.hit,
    leadTimeMinutes: row.leadTimeMinutes,
    reason: row.reason,
  };
}

function selectedCheckpoints(
  signal: RadarSignalEvent,
  rows: RadarSignalOutcomeEvent[],
): SignalValidationCheckpointView[] {
  return VALIDATION_HORIZONS.map((horizonDays) => {
    const rowsForHorizon = rows.filter((row) => row.horizonDays === horizonDays);
    const selected = rowsForHorizon.find((row) => row.checkpointStatus === "complete")
      ?? rowsForHorizon.find((row) => row.checkpointStatus === "unavailable")
      ?? rowsForHorizon.find((row) => row.checkpointStatus === "pending");
    return selected
      ? checkpointFromRow(selected)
      : {
          horizonDays,
          checkpointStatus: "pending",
          targetAt: targetAtForHorizon(signal.occurredAt, horizonDays),
          observedAt: null,
          observedPrice: null,
          rawReturnPercent: null,
          favorableReturnPercent: null,
          maxDrawdownPercent: null,
          hit: null,
          leadTimeMinutes: null,
          reason: "Checkpoint initialization is pending.",
        };
  });
}

function signalTriggerFromRow(row: RadarSignalEvent): SignalTriggerInput {
  return {
    symbol: row.symbol,
    occurredAt: row.occurredAt,
    fromState: row.fromState,
    state: row.state as ValidationSignalState,
    confirmationStatus: row.confirmationStatus,
    signalType: row.signalType as ValidationSignalType,
    direction: row.direction as SignalTriggerInput["direction"],
    triggerPrice: row.triggerPrice,
    alphaScore: row.alphaScore,
    signalScore: row.signalScore,
    confidence: row.confidence,
    volumeValue: row.volumeValue,
    volumeScore: row.volumeScore,
    velocity30s: row.velocity30s,
    velocity60s: row.velocity60s,
    momentumAcceleration: row.momentumAcceleration,
    volumeAcceleration: row.volumeAcceleration,
    orderFlowShift: row.orderFlowShift,
    spreadTightening: row.spreadTightening,
    sector: row.sector,
    sectorConfirmation: row.sectorConfirmation as SignalTriggerInput["sectorConfirmation"],
    sectorConfirmationReason: row.sectorConfirmationReason,
    evidenceCount: row.evidenceCount,
    evidenceSummary: row.evidenceSummary,
    satisfiedEvidence: row.satisfiedEvidence,
    missingEvidence: row.missingEvidence,
    dataFresh: row.dataFresh,
    freshness: row.freshness,
    source: row.source as SignalTriggerInput["source"],
    catalystStatus: row.catalystStatus as SignalTriggerInput["catalystStatus"],
  };
}

function signalView(
  row: RadarSignalEvent,
  outcomes: RadarSignalOutcomeEvent[],
): PersistedSignalView {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    recordHash: row.recordHash,
    ...signalTriggerFromRow(row),
    checkpoints: selectedCheckpoints(row, outcomes.filter((outcome) => outcome.signalId === row.id)),
  };
}

function unavailableDashboard(
  reason: string,
  selectedHorizonDays: ValidationHorizonDays,
): SignalValidationDashboard {
  return {
    generatedAt: new Date(),
    persistenceState: "unavailable",
    reason,
    selectedHorizonDays,
    hitThresholdPercent: VALIDATION_HIT_THRESHOLD_PERCENT,
    metricDefinitions: {
      hit: "A fresh post-signal observation reached a 2% direction-adjusted move by the selected checkpoint.",
      falsePositive: "A completed checkpoint that did not reach the hit threshold.",
      leadTime: "Minutes from the immutable trigger timestamp to the first observed hit.",
      maximumDrawdown: "Worst direction-adjusted observed return between trigger and checkpoint.",
    },
    metrics: aggregateValidationMetrics([]),
    totalSignals: 0,
    signals: [],
  };
}

export class SignalValidationService {
  private writeQueue: Promise<void> = Promise.resolve();
  private queuedWriteCount = 0;
  private readonly pendingPrices = new Map<string, { price: number; observedAt: Date }>();
  private readonly scheduledPriceFlushes = new Set<string>();
  private readonly lastQueuedPriceAt = new Map<string, number>();
  private triggerFlushRunning = false;
  private triggerRetryTimer: NodeJS.Timeout | null = null;
  private triggerRetryDelayMs = TRIGGER_RETRY_INITIAL_MS;
  private migrationPromise: Promise<void> | null = null;
  private readonly pendingOutboxWrites = new Map<string, ImmutableSignalRecord>();
  private readonly failedTriggerRecords = new Map<string, ImmutableSignalRecord>();
  private outboxWriteFailure: string | null = null;

  constructor(private readonly triggerOutbox = new SignalValidationOutbox()) {
    if (triggerOutbox.invalidLineCount > 0) {
      logger.error(
        { invalidLineCount: triggerOutbox.invalidLineCount },
        "Signal trigger outbox contains invalid records that will not be replayed",
      );
    }
    if (triggerOutbox.size > 0) this.scheduleTriggerFlush(0);
  }

  captureSignal(input: SignalTriggerInput): void {
    if (
      !input.dataFresh
      || !Number.isFinite(input.triggerPrice)
      || input.triggerPrice <= 0
    ) {
      return;
    }
    const record = buildImmutableSignalRecord(input);
    this.pendingOutboxWrites.set(record.eventKey, record);
    void this.triggerOutbox.store(record)
      .then(() => {
        this.pendingOutboxWrites.delete(record.eventKey);
        this.scheduleTriggerFlush(0);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingOutboxWrites.delete(record.eventKey);
        this.failedTriggerRecords.set(record.eventKey, record);
        this.outboxWriteFailure = message;
        this.scheduleTriggerFlush(this.triggerRetryDelayMs);
        logger.error(
          {
            error: message,
            symbol: input.symbol,
            eventKey: record.eventKey,
          },
          "Signal trigger could not be written to the durable outbox; validation persistence is unavailable but live radar is unaffected",
        );
      });
  }

  observePrice(symbol: string, price: number, observedAt: Date): void {
    if (!Number.isFinite(price) || price <= 0 || Number.isNaN(observedAt.getTime())) return;
    const normalizedSymbol = symbol.trim().toUpperCase();
    const previousQueuedAt = this.lastQueuedPriceAt.get(normalizedSymbol) ?? 0;
    if (observedAt.getTime() - previousQueuedAt < MIN_PRICE_OBSERVATION_INTERVAL_MS) return;
    this.lastQueuedPriceAt.set(normalizedSymbol, observedAt.getTime());
    this.pendingPrices.set(normalizedSymbol, { price, observedAt });
    this.schedulePriceFlush(normalizedSymbol);
  }

  async getDashboard(query: SignalValidationQuery = {}): Promise<SignalValidationDashboard> {
    const selectedHorizonDays = query.horizonDays ?? 5;
    try {
      const {
        db,
        radarSignalEventsTable,
        radarSignalOutcomeEventsTable,
      } = await this.database();
      const signalConditions = [];
      if (query.state) signalConditions.push(eq(radarSignalEventsTable.state, query.state));
      if (query.signalType) {
        signalConditions.push(eq(radarSignalEventsTable.signalType, query.signalType));
      }
      if (query.sector) signalConditions.push(eq(radarSignalEventsTable.sector, query.sector));
      const limit = Math.max(1, Math.min(MAX_DASHBOARD_SIGNALS, Math.trunc(query.limit ?? 20)));
      const rows = await db
        .select()
        .from(radarSignalEventsTable)
        .where(signalConditions.length > 0 ? and(...signalConditions) : undefined)
        .orderBy(desc(radarSignalEventsTable.occurredAt))
        .limit(limit);
      const totalRows = await db
        .select({ value: count() })
        .from(radarSignalEventsTable)
        .where(signalConditions.length > 0 ? and(...signalConditions) : undefined);
      const outcomes = rows.length > 0
        ? await db
          .select()
          .from(radarSignalOutcomeEventsTable)
          .where(inArray(radarSignalOutcomeEventsTable.signalId, rows.map((row) => row.id)))
          .orderBy(asc(radarSignalOutcomeEventsTable.horizonDays))
        : [];

      const metricConditions = [
        eq(radarSignalOutcomeEventsTable.horizonDays, selectedHorizonDays),
        eq(radarSignalOutcomeEventsTable.checkpointStatus, "complete"),
      ];
      if (query.state) metricConditions.push(eq(radarSignalEventsTable.state, query.state));
      if (query.signalType) {
        metricConditions.push(eq(radarSignalEventsTable.signalType, query.signalType));
      }
      if (query.sector) metricConditions.push(eq(radarSignalEventsTable.sector, query.sector));
      const metricRows = await db
        .select({
          hit: radarSignalOutcomeEventsTable.hit,
          rawReturnPercent: radarSignalOutcomeEventsTable.rawReturnPercent,
          favorableReturnPercent: radarSignalOutcomeEventsTable.favorableReturnPercent,
          maxDrawdownPercent: radarSignalOutcomeEventsTable.maxDrawdownPercent,
          leadTimeMinutes: radarSignalOutcomeEventsTable.leadTimeMinutes,
        })
        .from(radarSignalOutcomeEventsTable)
        .innerJoin(
          radarSignalEventsTable,
          eq(radarSignalEventsTable.id, radarSignalOutcomeEventsTable.signalId),
        )
        .where(and(...metricConditions));
      const metrics = aggregateValidationMetrics(
        metricRows
          .filter((row) => (
            row.hit !== null
            && row.rawReturnPercent !== null
            && row.favorableReturnPercent !== null
            && row.maxDrawdownPercent !== null
          ))
          .map((row) => ({
            hit: row.hit as boolean,
            rawReturnPercent: row.rawReturnPercent as number,
            favorableReturnPercent: row.favorableReturnPercent as number,
            maxDrawdownPercent: row.maxDrawdownPercent as number,
            leadTimeMinutes: row.leadTimeMinutes,
          })),
      );
      const pendingTriggerCount = this.triggerOutbox.size;
      const validationCaughtUp = pendingTriggerCount === 0
        && this.pendingOutboxWrites.size === 0
        && this.failedTriggerRecords.size === 0
        && this.outboxWriteFailure === null
        && this.triggerOutbox.invalidLineCount === 0;
      const publishedMetrics = validationCaughtUp
        ? metrics
        : {
            ...metrics,
            sampleState: "insufficient_sample" as const,
            hitRatePercent: null,
            averageReturnPercent: null,
            maximumDrawdownPercent: null,
            falsePositiveRatePercent: null,
            averageLeadTimeMinutes: null,
          };
      return {
        generatedAt: new Date(),
        persistenceState: validationCaughtUp ? "available" : "unavailable",
        reason: this.pendingOutboxWrites.size > 0
          ? `${this.pendingOutboxWrites.size} immutable trigger record${this.pendingOutboxWrites.size === 1 ? " is" : "s are"} being written to the durable outbox. Accuracy is withheld; live Alpha Radar is unaffected.`
          : this.outboxWriteFailure
          ? `The durable trigger outbox is unavailable and ${this.failedTriggerRecords.size} trigger record${this.failedTriggerRecords.size === 1 ? " is" : "s are"} awaiting retry. Accuracy is withheld; live Alpha Radar is unaffected.`
          : pendingTriggerCount > 0
            ? `${pendingTriggerCount} immutable trigger record${pendingTriggerCount === 1 ? " is" : "s are"} safely queued for database replay. Accuracy is withheld until persistence catches up; live Alpha Radar is unaffected.`
            : this.triggerOutbox.invalidLineCount > 0
              ? "The trigger outbox contains invalid records. Accuracy is withheld; live Alpha Radar is unaffected."
              : metrics.sampleState === "insufficient_sample"
                ? `Insufficient sample: ${metrics.sampleSize} completed ${selectedHorizonDays}D checkpoints; ${metrics.minimumSampleSize} are required before accuracy is published.`
                : "Metrics use the full matching persistent cohort, immutable trigger evidence, and post-signal observations only.",
        selectedHorizonDays,
        hitThresholdPercent: VALIDATION_HIT_THRESHOLD_PERCENT,
        metricDefinitions: {
          hit: "A fresh post-signal observation reached a 2% direction-adjusted move by the selected checkpoint.",
          falsePositive: "A completed checkpoint that did not reach the hit threshold.",
          leadTime: "Minutes from the immutable trigger timestamp to the first observed hit.",
          maximumDrawdown: "Worst direction-adjusted observed return between trigger and checkpoint.",
        },
        metrics: publishedMetrics,
        totalSignals: Number(totalRows[0]?.value ?? 0),
        signals: rows.map((row) => signalView(row, outcomes)),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown persistence error";
      logger.error({ error: message }, "Signal validation dashboard is unavailable");
      return unavailableDashboard(
        this.pendingOutboxWrites.size > 0
          ? `Persistent validation storage is unavailable and ${this.pendingOutboxWrites.size} immutable trigger record${this.pendingOutboxWrites.size === 1 ? " is" : "s are"} still being written to the durable outbox. Accuracy is withheld and live Alpha Radar remains unaffected.`
          : this.outboxWriteFailure
          ? `Persistent validation storage and the durable trigger outbox are unavailable. ${this.failedTriggerRecords.size} trigger record${this.failedTriggerRecords.size === 1 ? " is" : "s are"} awaiting retry in this process. Accuracy is withheld and live Alpha Radar remains unaffected.`
          : this.triggerOutbox.size > 0
            ? `Persistent validation storage is unavailable. ${this.triggerOutbox.size} immutable trigger record${this.triggerOutbox.size === 1 ? " is" : "s are"} safely queued for replay. Live Alpha Radar remains isolated and unaffected.`
            : "Persistent validation storage is unavailable. Live Alpha Radar remains isolated and unaffected.",
        selectedHorizonDays,
      );
    }
  }

  async getAudit(signalId: string): Promise<SignalValidationAudit | null> {
    const {
      db,
      radarSignalEventsTable,
      radarSignalOutcomeEventsTable,
    } = await this.database();
    const signal = (await db
      .select()
      .from(radarSignalEventsTable)
      .where(eq(radarSignalEventsTable.id, signalId))
      .limit(1))[0];
    if (!signal) return null;
    const outcomes = await db
      .select()
      .from(radarSignalOutcomeEventsTable)
      .where(eq(radarSignalOutcomeEventsTable.signalId, signal.id))
      .orderBy(asc(radarSignalOutcomeEventsTable.horizonDays));
    const immutableRecord: ImmutableSignalRecord = {
      ...signalTriggerFromRow(signal),
      eventKey: signal.eventKey,
      schemaVersion: signal.schemaVersion,
      recordHash: signal.recordHash,
    };
    return {
      generatedAt: new Date(),
      integrity: signalRecordIntegrityIsValid(immutableRecord) ? "verified" : "failed",
      signal: signalView(signal, outcomes),
    };
  }

  private scheduleTriggerFlush(delayMs: number): void {
    if (
      (this.triggerOutbox.size === 0 && this.failedTriggerRecords.size === 0)
      || this.triggerFlushRunning
      || this.triggerRetryTimer
    ) {
      return;
    }
    this.triggerRetryTimer = setTimeout(() => {
      this.triggerRetryTimer = null;
      this.triggerFlushRunning = true;
      void this.flushTriggerOutbox()
        .then(() => {
          this.triggerRetryDelayMs = TRIGGER_RETRY_INITIAL_MS;
        })
        .catch((error: unknown) => {
          logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
              pendingTriggerCount: this.triggerOutbox.size,
              retryDelayMs: this.triggerRetryDelayMs,
            },
            "Signal trigger replay failed without affecting live radar",
          );
          this.triggerRetryDelayMs = Math.min(
            TRIGGER_RETRY_MAX_MS,
            this.triggerRetryDelayMs * 2,
          );
        })
        .finally(() => {
          this.triggerFlushRunning = false;
          if (this.triggerOutbox.size > 0 || this.failedTriggerRecords.size > 0) {
            this.scheduleTriggerFlush(this.triggerRetryDelayMs);
          }
        });
    }, delayMs);
    this.triggerRetryTimer.unref();
  }

  private async flushTriggerOutbox(): Promise<void> {
    const acknowledged: string[] = [];
    try {
      for (const [eventKey, record] of this.failedTriggerRecords) {
        await this.triggerOutbox.store(record);
        this.failedTriggerRecords.delete(eventKey);
      }
      if (this.failedTriggerRecords.size === 0) this.outboxWriteFailure = null;
      for (const record of this.triggerOutbox.list()) {
        await this.persistSignalRecord(record);
        acknowledged.push(record.eventKey);
      }
    } finally {
      await this.triggerOutbox.acknowledge(acknowledged);
    }
  }

  private async persistSignalRecord(record: ImmutableSignalRecord): Promise<void> {
    const {
      db,
      radarSignalEventsTable,
      radarSignalOutcomeEventsTable,
    } = await this.database();
    const insertedSignal = await db.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(radarSignalEventsTable)
        .values(record)
        .onConflictDoNothing({ target: radarSignalEventsTable.eventKey })
        .returning();
      const signal = inserted[0]
        ?? (await transaction
          .select()
          .from(radarSignalEventsTable)
          .where(eq(radarSignalEventsTable.eventKey, record.eventKey))
          .limit(1))[0];
      if (!signal) throw new Error("Signal persistence did not return an inserted or existing record.");
      if (signal.recordHash !== record.recordHash) {
        throw new Error(
          "An existing idempotency key has a different immutable record hash; the stored trigger was not changed.",
        );
      }
      await transaction
        .insert(radarSignalOutcomeEventsTable)
        .values(VALIDATION_HORIZONS.map((horizonDays) => ({
          outcomeKey: `${record.eventKey}:${horizonDays}:pending`,
          signalId: signal.id,
          horizonDays,
          checkpointStatus: "pending",
          targetAt: targetAtForHorizon(record.occurredAt, horizonDays),
          observedAt: null,
          observedPrice: null,
          rawReturnPercent: null,
          favorableReturnPercent: null,
          maxDrawdownPercent: null,
          hit: null,
          leadTimeMinutes: null,
          reason: `Waiting for a fresh post-signal price at or after the ${horizonDays}D US equities session close.`,
        })))
        .onConflictDoNothing({ target: radarSignalOutcomeEventsTable.outcomeKey });
      return signal;
    });
    logger.info(
      {
        signalId: insertedSignal.id,
        symbol: insertedSignal.symbol,
        state: insertedSignal.state,
        occurredAt: insertedSignal.occurredAt,
      },
      "Persisted immutable Alpha Radar signal",
    );
  }

  private schedulePriceFlush(symbol: string): void {
    if (this.scheduledPriceFlushes.has(symbol)) return;
    this.scheduledPriceFlushes.add(symbol);
    const accepted = this.enqueuePrice(async () => {
      const observation = this.pendingPrices.get(symbol);
      this.pendingPrices.delete(symbol);
      try {
        if (observation) await this.persistPriceObservation(symbol, observation.price, observation.observedAt);
      } finally {
        this.scheduledPriceFlushes.delete(symbol);
        if (this.pendingPrices.has(symbol)) this.schedulePriceFlush(symbol);
      }
    }, "price checkpoint evaluation", symbol);
    if (!accepted) this.scheduledPriceFlushes.delete(symbol);
  }

  private async persistPriceObservation(
    symbol: string,
    price: number,
    observedAt: Date,
  ): Promise<void> {
    const {
      db,
      radarSignalEventsTable,
      radarSignalOutcomeEventsTable,
      radarSignalPriceObservationsTable,
    } = await this.database();
    const terminalOutcome = alias(radarSignalOutcomeEventsTable, "terminal_outcome");
    const incomplete = await db
      .select({
        signalId: radarSignalEventsTable.id,
        eventKey: radarSignalEventsTable.eventKey,
        occurredAt: radarSignalEventsTable.occurredAt,
        triggerPrice: radarSignalEventsTable.triggerPrice,
        direction: radarSignalEventsTable.direction,
        horizonDays: radarSignalOutcomeEventsTable.horizonDays,
        targetAt: radarSignalOutcomeEventsTable.targetAt,
      })
      .from(radarSignalOutcomeEventsTable)
      .innerJoin(
        radarSignalEventsTable,
        eq(radarSignalEventsTable.id, radarSignalOutcomeEventsTable.signalId),
      )
      .leftJoin(
        terminalOutcome,
        and(
          eq(terminalOutcome.signalId, radarSignalOutcomeEventsTable.signalId),
          eq(terminalOutcome.horizonDays, radarSignalOutcomeEventsTable.horizonDays),
          inArray(terminalOutcome.checkpointStatus, ["complete", "unavailable"]),
        ),
      )
      .where(and(
        eq(radarSignalEventsTable.symbol, symbol),
        eq(radarSignalOutcomeEventsTable.checkpointStatus, "pending"),
        isNull(terminalOutcome.id),
      ));
    if (incomplete.length === 0) return;

    const observationKey = `${symbol}|${observedAt.toISOString()}|${price.toFixed(8)}`;
    await db
      .insert(radarSignalPriceObservationsTable)
      .values({
        observationKey,
        symbol,
        observedAt,
        price,
        source: "Databento EQUS.MINI live",
        freshness: "fresh",
      })
      .onConflictDoNothing({ target: radarSignalPriceObservationsTable.observationKey });

    const dueBySignal = new Map<string, {
      eventKey: string;
      occurredAt: Date;
      triggerPrice: number;
      direction: SignalTriggerInput["direction"];
      horizons: ValidationHorizonDays[];
    }>();
    for (const row of incomplete) {
      if (row.targetAt.getTime() > observedAt.getTime()) continue;
      const existing = dueBySignal.get(row.signalId);
      if (existing) {
        existing.horizons.push(row.horizonDays as ValidationHorizonDays);
      } else {
        dueBySignal.set(row.signalId, {
          eventKey: row.eventKey,
          occurredAt: row.occurredAt,
          triggerPrice: row.triggerPrice,
          direction: row.direction as SignalTriggerInput["direction"],
          horizons: [row.horizonDays as ValidationHorizonDays],
        });
      }
    }

    for (const [signalId, signal] of dueBySignal) {
      const observations = await db
        .select({
          observedAt: radarSignalPriceObservationsTable.observedAt,
          price: radarSignalPriceObservationsTable.price,
        })
        .from(radarSignalPriceObservationsTable)
        .where(and(
          eq(radarSignalPriceObservationsTable.symbol, symbol),
          gt(radarSignalPriceObservationsTable.observedAt, signal.occurredAt),
          lte(radarSignalPriceObservationsTable.observedAt, observedAt),
        ))
        .orderBy(asc(radarSignalPriceObservationsTable.observedAt));
      for (const horizonDays of signal.horizons) {
        const checkpoint = calculateOutcomeCheckpoint(signal, observations, horizonDays);
        if (checkpoint.checkpointStatus === "pending") continue;
        await db
          .insert(radarSignalOutcomeEventsTable)
          .values({
            outcomeKey: `${signal.eventKey}:${horizonDays}:${checkpoint.checkpointStatus}`,
            signalId,
            ...checkpoint,
          })
          .onConflictDoNothing({ target: radarSignalOutcomeEventsTable.outcomeKey });
      }
    }
  }

  private async database(): Promise<typeof import("@workspace/db")> {
    const databaseModule = await import("@workspace/db");
    if (!this.migrationPromise) {
      const migrationsFolder = process.env.SIGNAL_VALIDATION_MIGRATIONS_PATH
        ?? fileURLToPath(new URL("./db-migrations", import.meta.url));
      this.migrationPromise = migrate(databaseModule.db, {
        migrationsFolder,
        migrationsSchema: process.env.SIGNAL_VALIDATION_MIGRATIONS_SCHEMA ?? "drizzle",
      })
        .catch((error: unknown) => {
          this.migrationPromise = null;
          throw error;
        });
    }
    await this.migrationPromise;
    return databaseModule;
  }

  private enqueuePrice(
    operation: () => Promise<void>,
    label: string,
    symbol: string,
  ): boolean {
    if (this.queuedWriteCount >= MAX_PENDING_PRICE_WRITES) {
      logger.error(
        { operation: label, symbol, queuedWriteCount: this.queuedWriteCount },
        "A coalescible price observation was dropped to protect live radar from persistence backpressure",
      );
      return false;
    }
    this.queuedWriteCount += 1;
    this.writeQueue = this.writeQueue
      .then(operation)
      .catch((error: unknown) => {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            operation: label,
            symbol,
          },
          "Signal validation persistence failed without affecting live radar",
        );
      })
      .finally(() => {
        this.queuedWriteCount = Math.max(0, this.queuedWriteCount - 1);
      });
    return true;
  }
}

export const signalValidation = new SignalValidationService();