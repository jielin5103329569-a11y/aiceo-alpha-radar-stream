import { fileURLToPath } from "node:url";
import {
  and,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { logger } from "./logger";
import {
  buildImmutableShadowTrigger,
  buildShadowPriceObservation,
  buildShadowOutcome,
  comparableMetrics,
  evaluateShadowPromotion,
  isEligibleShadowObservation,
  isIndependentHoldout,
  matchShadowBaselineCohorts,
  type ShadowCohortEligibilitySnapshot,
  type ImmutableShadowTrigger,
  type ShadowMetricComparison,
  type ShadowOutcomeRecord,
  type ShadowPriceObservation,
  type ShadowPromotionRecommendation,
  type ShadowTriggerInput,
  type ShadowPersistenceState,
  SHADOW_SCAN_WINDOW,
  SHADOW_STRATEGY_VERSION,
  VALIDATION_HORIZONS,
  type ValidationHorizonDays,
  type ValidationMetricInput,
} from "./shadowLearningCore";
import {
  GoogleCloudShadowLearningArchive,
  type ShadowLearningArchive,
} from "./shadowLearningArchive";

export type ShadowLearningQuery = {
  strategyVersion?: string;
  signalType?: string;
  scanWindow?: string;
  sector?: string;
  horizonDays?: ValidationHorizonDays;
};

export type ShadowLearningDashboard = {
  generatedAt: Date;
  persistenceState: ShadowPersistenceState;
  reason: string;
  selectedHorizonDays: ValidationHorizonDays;
  shadow: ShadowMetricComparison;
  baseline: ShadowMetricComparison;
  strategy: {
    strategyVersion: string;
    scanWindow: string;
    scanProfile: string;
    modelVersion: string;
    candidateSource: string;
  } | null;
  promotion: ShadowPromotionRecommendation;
  recentTriggers: Array<{
    eventKey: string;
    recordHash: string;
    strategyVersion: string;
    scanWindow: string;
    modelVersion: string;
    candidateSource: string;
    signalType: string;
    symbol: string;
    sector: string | null;
    occurredAt: Date;
    shadowScore: number;
    status: string;
  }>;
};

type PriceInput = {
  symbol: string;
  observedAt: Date;
  price: number;
  source: string;
  freshness: {
    marketFeedState: string;
    dataQuality: string;
    scoreState: string;
    streaming: boolean;
    complete: boolean;
    eligible: boolean;
  };
};

function metricInput(outcome: {
  hit: boolean | null;
  rawReturnPercent: number | null;
  favorableReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  leadTimeMinutes: number | null;
}): ValidationMetricInput | null {
  if (
    outcome.hit === null
    || outcome.rawReturnPercent === null
    || outcome.favorableReturnPercent === null
    || outcome.maxDrawdownPercent === null
  ) return null;
  return {
    hit: outcome.hit,
    rawReturnPercent: outcome.rawReturnPercent,
    favorableReturnPercent: outcome.favorableReturnPercent,
    maxDrawdownPercent: outcome.maxDrawdownPercent,
    leadTimeMinutes: outcome.leadTimeMinutes,
  };
}

function maskedMetrics(inputs: ValidationMetricInput[]): ShadowMetricComparison {
  const metrics = comparableMetrics(inputs);
  return metrics.sampleState === "available"
    ? metrics
    : {
        ...metrics,
        hitRatePercent: null,
        averageReturnPercent: null,
        maximumDrawdownPercent: null,
        falsePositiveRatePercent: null,
        averageLeadTimeMinutes: null,
      };
}

function shadowObservationKey(input: PriceInput): string {
  return `${input.symbol.trim().toUpperCase()}|${input.observedAt.toISOString()}|${input.price}`;
}

export class ShadowLearningService {
  private readonly trackedSymbols = new Set<string>();
  private readonly pendingTriggerKeys = new Set<string>();
  private readonly pendingPriceKeys = new Set<string>();
  private readonly pendingOutcomeKeys = new Set<string>();
  private writeQueue: Promise<void> = Promise.resolve();
  private recoveryState: ShadowPersistenceState = "unavailable";
  private recoveryReason = "Shadow archive recovery is pending. Promotion is withheld.";
  private recoveryStarted = false;
  private migrationPromise: Promise<void> | null = null;

  constructor(
    private readonly archive: ShadowLearningArchive = new GoogleCloudShadowLearningArchive(),
  ) {
    void this.recoverArchive();
  }

  captureObservation(input: ShadowTriggerInput): Promise<{ eventKey: string; recordHash: string } | null> {
    if (!isEligibleShadowObservation(input)) return Promise.resolve(null);
    const record = buildImmutableShadowTrigger(input);
    this.trackedSymbols.add(record.symbol);
    this.pendingTriggerKeys.add(record.eventKey);
    return this.archive.storeTrigger(record)
      .then(async () => {
        await this.enqueue(() => this.persistTrigger(record), "trigger");
        return { eventKey: record.eventKey, recordHash: record.recordHash };
      })
      .catch((error: unknown) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), eventKey: record.eventKey },
          "Shadow trigger archive write failed; live radar remains unaffected",
        );
        this.recoveryState = "unavailable";
        this.recoveryReason = "Shadow trigger archive acknowledgement failed. Promotion is withheld; live Alpha Radar is unaffected.";
        return null;
      })
      .finally(() => {
        this.pendingTriggerKeys.delete(record.eventKey);
      });
  }

  observePrice(input: PriceInput): void {
    const symbol = input.symbol.trim().toUpperCase();
    if (
      !this.trackedSymbols.has(symbol)
      || !input.freshness.streaming
      || !input.freshness.complete
      || !input.freshness.eligible
      || input.freshness.marketFeedState !== "streaming"
      || input.freshness.dataQuality !== "good"
      || input.freshness.scoreState !== "available"
      || !Number.isFinite(input.price)
      || input.price <= 0
    ) return;
    const observation = buildShadowPriceObservation({
      observationKey: shadowObservationKey({ ...input, symbol }),
      symbol,
      observedAt: input.observedAt,
      price: input.price,
      source: input.source,
      freshness: "fresh",
    });
    if (this.pendingPriceKeys.has(observation.observationKey)) return;
    this.pendingPriceKeys.add(observation.observationKey);
    void this.archive.storePrice(observation)
      .then(() => this.enqueue(async () => {
        await this.persistPrice(observation);
        await this.materializeOutcomes(symbol);
      }, "price"))
      .catch((error: unknown) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), symbol },
          "Shadow price archive write failed; promotion is withheld without changing live radar",
        );
        this.recoveryState = "unavailable";
        this.recoveryReason = "Shadow outcome price archival is incomplete. Promotion is withheld.";
      })
      .finally(() => this.pendingPriceKeys.delete(observation.observationKey));
  }

  async getDashboard(query: ShadowLearningQuery = {}): Promise<ShadowLearningDashboard> {
    const selectedHorizonDays = query.horizonDays ?? 5;
    if (
      this.recoveryState !== "available"
      || this.pendingTriggerKeys.size > 0
      || this.pendingPriceKeys.size > 0
      || this.pendingOutcomeKeys.size > 0
    ) {
      return this.unavailableDashboard(selectedHorizonDays);
    }
    try {
      const dbModule = await this.database();
      const where = [
        query.strategyVersion
          ? eq(dbModule.shadowLearningTriggersTable.strategyVersion, query.strategyVersion)
          : undefined,
        query.signalType
          ? eq(dbModule.shadowLearningTriggersTable.signalType, query.signalType)
          : undefined,
        query.scanWindow
          ? eq(dbModule.shadowLearningTriggersTable.scanWindow, query.scanWindow)
          : undefined,
        query.sector
          ? eq(dbModule.shadowLearningTriggersTable.sector, query.sector)
          : undefined,
      ].filter(Boolean);
      const triggers = await dbModule.db
        .select()
        .from(dbModule.shadowLearningTriggersTable)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(dbModule.shadowLearningTriggersTable.occurredAt));
      const triggerIds = triggers.map((trigger) => trigger.id);
      const shadowOutcomes = triggerIds.length === 0
        ? []
        : await dbModule.db
          .select({
            triggerId: dbModule.shadowLearningOutcomesTable.triggerId,
            outcome: dbModule.shadowLearningOutcomesTable,
          })
          .from(dbModule.shadowLearningOutcomesTable)
          .where(and(
            inArray(dbModule.shadowLearningOutcomesTable.triggerId, triggerIds),
            eq(dbModule.shadowLearningOutcomesTable.horizonDays, selectedHorizonDays),
            eq(dbModule.shadowLearningOutcomesTable.checkpointStatus, "complete"),
          ));
      const triggerById = new Map(triggers.map((trigger) => [trigger.id, trigger]));
      const shadowComplete = shadowOutcomes.flatMap(({ triggerId, outcome }) => {
        const metric = metricInput(outcome);
        const trigger = triggerById.get(triggerId);
        return metric && trigger ? [{
          cohortKey: trigger.cohortKey,
          symbol: trigger.symbol,
          sector: trigger.sector,
          occurredAt: trigger.occurredAt,
          cohortEligibilitySnapshot: trigger.cohortEligibilitySnapshot as ShadowCohortEligibilitySnapshot,
          metric,
        }] : [];
      });
      const baselineScopeSupported = (
        (!query.strategyVersion || query.strategyVersion === SHADOW_STRATEGY_VERSION)
        && (!query.scanWindow || query.scanWindow === SHADOW_SCAN_WINDOW)
        && (!query.signalType || query.signalType === "shadow_pre_breakout")
      );
      const baselineRows = !baselineScopeSupported
        || shadowComplete.length === 0
        ? []
        : await dbModule.db
          .select({
            eventKey: dbModule.radarSignalEventsTable.eventKey,
            symbol: dbModule.radarSignalEventsTable.symbol,
            sector: dbModule.radarSignalEventsTable.sector,
            occurredAt: dbModule.radarSignalEventsTable.occurredAt,
            state: dbModule.radarSignalEventsTable.state,
            signalType: dbModule.radarSignalEventsTable.signalType,
            dataFresh: dbModule.radarSignalEventsTable.dataFresh,
            satisfiedEvidence: dbModule.radarSignalEventsTable.satisfiedEvidence,
            outcome: dbModule.radarSignalOutcomeEventsTable,
          })
          .from(dbModule.radarSignalOutcomeEventsTable)
          .innerJoin(
            dbModule.radarSignalEventsTable,
            eq(
              dbModule.radarSignalOutcomeEventsTable.signalId,
              dbModule.radarSignalEventsTable.id,
            ),
          )
          .where(and(
            eq(dbModule.radarSignalOutcomeEventsTable.horizonDays, selectedHorizonDays),
            eq(dbModule.radarSignalOutcomeEventsTable.checkpointStatus, "complete"),
            eq(dbModule.radarSignalEventsTable.signalType, "state_transition"),
            eq(dbModule.radarSignalEventsTable.dataFresh, true),
            inArray(
              dbModule.radarSignalEventsTable.symbol,
              [...new Set(shadowComplete.map((item) => item.symbol))],
            ),
            query.sector
              ? eq(dbModule.radarSignalEventsTable.sector, query.sector)
              : undefined,
          ));
      const baselineComplete = baselineRows.flatMap(({
        eventKey,
        symbol,
        sector,
        occurredAt,
        state,
        signalType,
        dataFresh,
        satisfiedEvidence,
        outcome,
      }) => {
        const metric = metricInput(outcome);
        return metric ? [{
          eventKey,
          symbol,
          sector,
          occurredAt,
          state,
          signalType,
          dataFresh,
          satisfiedEvidence: satisfiedEvidence as string[],
          metric,
        }] : [];
      });
      const matchedCohorts = matchShadowBaselineCohorts(
        shadowComplete.map((item) => ({
          cohortKey: item.cohortKey,
          symbol: item.symbol,
          sector: item.sector,
          occurredAt: item.occurredAt,
          cohortEligibilitySnapshot: item.cohortEligibilitySnapshot,
          value: item.metric,
        })),
        baselineComplete.map((item) => ({
          eventKey: item.eventKey,
          symbol: item.symbol,
          sector: item.sector,
          occurredAt: item.occurredAt,
          state: item.state,
          signalType: item.signalType,
          dataFresh: item.dataFresh,
          satisfiedEvidence: item.satisfiedEvidence,
          value: item.metric,
        })),
      );
      const matchingEvidenceComplete = shadowComplete.length === matchedCohorts.length;
      const baselineInputs = matchedCohorts.map(({ baseline }) => baseline);
      const shadowInputs = matchedCohorts.map(({ shadow }) => shadow);
      const promotion = evaluateShadowPromotion({
        persistenceState: "available",
        auditComplete: matchingEvidenceComplete,
        baseline: baselineInputs,
        shadow: shadowInputs,
        baselineHoldout: matchedCohorts
          .filter(({ cohortKey }) => isIndependentHoldout(cohortKey))
          .map(({ baseline }) => baseline),
        shadowHoldout: matchedCohorts
          .filter(({ cohortKey }) => isIndependentHoldout(cohortKey))
          .map(({ shadow }) => shadow),
      });
      const newest = triggers[0] ?? null;
      return {
        generatedAt: new Date(),
        persistenceState: "available",
        reason: "Shadow Learning is observational only. Scores, routing, focused symbols, and scan cadence are unchanged.",
        selectedHorizonDays,
        baseline: maskedMetrics(baselineInputs),
        shadow: maskedMetrics(shadowInputs),
        strategy: newest
          ? {
              strategyVersion: newest.strategyVersion,
              scanWindow: newest.scanWindow,
              scanProfile: newest.scanProfile,
              modelVersion: newest.modelVersion,
              candidateSource: newest.candidateSource,
            }
          : null,
        promotion,
        recentTriggers: triggers.slice(0, 10).map((trigger) => ({
          eventKey: trigger.eventKey,
          recordHash: trigger.recordHash,
          strategyVersion: trigger.strategyVersion,
          scanWindow: trigger.scanWindow,
          modelVersion: trigger.modelVersion,
          candidateSource: trigger.candidateSource,
          signalType: trigger.signalType,
          symbol: trigger.symbol,
          sector: trigger.sector,
          occurredAt: trigger.occurredAt,
          shadowScore: trigger.shadowScore,
          status: trigger.status,
        })),
      };
    } catch (error: unknown) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Shadow Learning dashboard could not read persistent validation data",
      );
      this.recoveryState = "unavailable";
      this.recoveryReason = "Shadow validation storage is unavailable. Promotion is withheld; live Alpha Radar is unaffected.";
      return this.unavailableDashboard(selectedHorizonDays);
    }
  }

  private unavailableDashboard(selectedHorizonDays: ValidationHorizonDays): ShadowLearningDashboard {
    const withheld = evaluateShadowPromotion({
      persistenceState: "unavailable",
      auditComplete: false,
      baseline: [],
      shadow: [],
      baselineHoldout: [],
      shadowHoldout: [],
    });
    return {
      generatedAt: new Date(),
      persistenceState: "unavailable",
      reason: this.recoveryReason,
      selectedHorizonDays,
      baseline: maskedMetrics([]),
      shadow: maskedMetrics([]),
      strategy: null,
      promotion: withheld,
      recentTriggers: [],
    };
  }

  private enqueue(operation: () => Promise<void>, label: string): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(operation)
      .catch((error: unknown) => {
        this.recoveryState = "unavailable";
        this.recoveryReason = `Shadow ${label} persistence failed. Promotion is withheld; live Alpha Radar is unaffected.`;
        logger.error(
          { error: error instanceof Error ? error.message : String(error), label },
          "Shadow Learning persistence failed without changing live radar",
        );
      });
    return this.writeQueue;
  }

  private async database() {
    const databaseModule = await import("@workspace/db");
    if (!this.migrationPromise) {
      const migrationsFolder = process.env.SHADOW_LEARNING_MIGRATIONS_PATH
        ?? fileURLToPath(new URL("./db-migrations", import.meta.url));
      this.migrationPromise = migrate(databaseModule.db, {
        migrationsFolder,
        migrationsSchema: process.env.SHADOW_LEARNING_MIGRATIONS_SCHEMA ?? "drizzle",
      }).catch((error: unknown) => {
        this.migrationPromise = null;
        throw error;
      });
    }
    await this.migrationPromise;
    return databaseModule;
  }

  private async persistTrigger(trigger: ImmutableShadowTrigger): Promise<void> {
    const dbModule = await this.database();
    const [existing] = await dbModule.db.select({
      recordHash: dbModule.shadowLearningTriggersTable.recordHash,
    }).from(dbModule.shadowLearningTriggersTable)
      .where(eq(dbModule.shadowLearningTriggersTable.eventKey, trigger.eventKey))
      .limit(1);
    if (existing && existing.recordHash !== trigger.recordHash) {
      throw new Error("Shadow trigger database record conflicts with immutable archive evidence.");
    }
    await dbModule.db.insert(dbModule.shadowLearningTriggersTable).values({
      eventKey: trigger.eventKey,
      schemaVersion: trigger.schemaVersion,
      recordHash: trigger.recordHash,
      strategyVersion: trigger.strategyVersion,
      scanWindow: trigger.scanWindow,
      scanProfile: trigger.scanProfile,
      modelVersion: trigger.modelVersion,
      candidateSource: trigger.candidateSource,
      signalType: trigger.signalType,
      symbol: trigger.symbol,
      sector: trigger.sector,
      occurredAt: trigger.occurredAt,
      triggerPrice: trigger.triggerPrice,
      direction: trigger.direction,
      state: trigger.state,
      shadowScore: trigger.shadowScore,
      status: trigger.status,
      evidenceSnapshot: trigger.evidenceSnapshot,
      freshnessSnapshot: trigger.freshnessSnapshot,
      inputSummary: trigger.inputSummary,
      cohortKey: trigger.cohortKey,
      cohortEligibilitySnapshot: trigger.cohortEligibilitySnapshot,
    }).onConflictDoNothing();
  }

  private async persistPrice(observation: ShadowPriceObservation): Promise<void> {
    const dbModule = await this.database();
    const [existing] = await dbModule.db.select({
      recordHash: dbModule.shadowLearningPriceObservationsTable.recordHash,
    }).from(dbModule.shadowLearningPriceObservationsTable)
      .where(eq(
        dbModule.shadowLearningPriceObservationsTable.observationKey,
        observation.observationKey,
      ))
      .limit(1);
    if (existing && existing.recordHash !== observation.recordHash) {
      throw new Error("Shadow price database record conflicts with immutable archive evidence.");
    }
    await dbModule.db.insert(dbModule.shadowLearningPriceObservationsTable).values(observation)
      .onConflictDoNothing();
  }

  private async materializeOutcomes(symbol: string): Promise<void> {
    const dbModule = await this.database();
    const [triggers, prices] = await Promise.all([
      dbModule.db.select().from(dbModule.shadowLearningTriggersTable)
        .where(eq(dbModule.shadowLearningTriggersTable.symbol, symbol)),
      dbModule.db.select().from(dbModule.shadowLearningPriceObservationsTable)
        .where(eq(dbModule.shadowLearningPriceObservationsTable.symbol, symbol)),
    ]);
    const observations = prices.map((price) => ({
      observedAt: price.observedAt,
      price: price.price,
    }));
    for (const trigger of triggers) {
      const immutable = trigger as ImmutableShadowTrigger;
      for (const horizonDays of VALIDATION_HORIZONS) {
        const outcome = buildShadowOutcome(immutable, horizonDays, observations);
        if (outcome.checkpointStatus !== "complete" || this.pendingOutcomeKeys.has(outcome.outcomeKey)) continue;
        this.pendingOutcomeKeys.add(outcome.outcomeKey);
        try {
          await this.archive.storeOutcome(outcome);
          await this.persistOutcome(outcome);
        } finally {
          this.pendingOutcomeKeys.delete(outcome.outcomeKey);
        }
      }
    }
  }

  private async persistOutcome(outcome: ShadowOutcomeRecord): Promise<void> {
    const dbModule = await this.database();
    const [trigger] = await dbModule.db.select()
      .from(dbModule.shadowLearningTriggersTable)
      .where(eq(dbModule.shadowLearningTriggersTable.eventKey, outcome.triggerEventKey))
      .limit(1);
    if (!trigger) return;
    const [existing] = await dbModule.db.select({
      recordHash: dbModule.shadowLearningOutcomesTable.recordHash,
    }).from(dbModule.shadowLearningOutcomesTable)
      .where(eq(dbModule.shadowLearningOutcomesTable.outcomeKey, outcome.outcomeKey))
      .limit(1);
    if (existing && existing.recordHash !== outcome.recordHash) {
      throw new Error("Shadow outcome database record conflicts with immutable archive evidence.");
    }
    await dbModule.db.insert(dbModule.shadowLearningOutcomesTable).values({
      outcomeKey: outcome.outcomeKey,
      recordHash: outcome.recordHash,
      triggerId: trigger.id,
      horizonDays: outcome.horizonDays,
      checkpointStatus: outcome.checkpointStatus,
      targetAt: outcome.targetAt,
      observedAt: outcome.observedAt,
      observedPrice: outcome.observedPrice,
      rawReturnPercent: outcome.rawReturnPercent,
      favorableReturnPercent: outcome.favorableReturnPercent,
      maxDrawdownPercent: outcome.maxDrawdownPercent,
      hit: outcome.hit,
      leadTimeMinutes: outcome.leadTimeMinutes,
      reason: outcome.reason,
    }).onConflictDoNothing();
  }

  private async recoverArchive(): Promise<void> {
    if (this.recoveryStarted) return;
    this.recoveryStarted = true;
    try {
      const history = await this.archive.list();
      if (history.invalidRecordCount > 0) {
        throw new Error("Shadow archive contains invalid immutable records.");
      }
      for (const trigger of history.triggers) {
        this.trackedSymbols.add(trigger.symbol);
        await this.persistTrigger(trigger);
      }
      for (const price of history.prices) await this.persistPrice(price);
      for (const outcome of history.outcomes) await this.persistOutcome(outcome);
      for (const symbol of new Set(history.prices.map((price) => price.symbol))) {
        await this.materializeOutcomes(symbol);
      }
      this.recoveryState = "available";
      this.recoveryReason = "Shadow archive recovered. Promotion remains read-only and never changes production strategy.";
    } catch (error: unknown) {
      this.recoveryState = "unavailable";
      this.recoveryReason = `Shadow archive recovery is unavailable${error instanceof Error ? `: ${error.message}` : ""}. Promotion is withheld.`;
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Shadow Learning archive recovery unavailable; live radar is unaffected",
      );
    }
  }
}

export const shadowLearning = new ShadowLearningService();