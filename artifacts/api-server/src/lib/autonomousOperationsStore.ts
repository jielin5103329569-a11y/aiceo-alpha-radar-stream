import {
  autonomousOperationsAuditTable,
  autonomousOperationsWorkItemsTable,
  db,
  type AutonomousOperationCheckpoint,
  type AutonomousOperationEvidence,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

export type PersistedOperationsWork = {
  workId: string;
  title: string;
  ownerModule: string;
  implementationKey: string;
  state: string;
  dependsOn: string[];
  resourceClaims: string[];
  attempts: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  executionTimeoutMs: number;
  nextRunAt: Date | null;
  runId: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  checkpoint: AutonomousOperationCheckpoint | null;
  verificationEvidence: AutonomousOperationEvidence | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OperationsPersistence = {
  loadWork(): Promise<PersistedOperationsWork[]>;
  saveWork(work: PersistedOperationsWork, options?: { expectedRunId?: string }): Promise<boolean>;
  claimWork(input: {
    workId: string;
    runId: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<{
    attempts: number;
    runId: string;
    leaseExpiresAt: Date;
    lastHeartbeatAt: Date;
    updatedAt: Date;
  } | null>;
  appendAudit(input: {
    workId: string | null;
    event: string;
    reason: string;
    evidence: AutonomousOperationEvidence;
    occurredAt: Date;
  }): Promise<boolean>;
  getHealth(): { state: "ready" | "unavailable"; lastError: string | null };
};

function safeText(value: string, max: number): string {
  return value.replace(/(?:sk|pk|rk|db)[-_][a-z0-9_-]{12,}/gi, "[redacted]").replace(/[\r\n]/g, " ").slice(0, max);
}

function evidence(input: AutonomousOperationEvidence): AutonomousOperationEvidence {
  return {
    summary: safeText(input.summary, 320),
    details: Object.fromEntries(
      Object.entries(input.details)
        .slice(0, 16)
        .map(([key, value]) => [safeText(key, 64), typeof value === "string" ? safeText(value, 320) : value]),
    ),
  };
}

/**
 * Best-effort persistence boundary. A database outage is visible through the
 * coordinator snapshot but can never stop the API, market feed, or AlertService.
 */
export class AutonomousOperationsStore implements OperationsPersistence {
  private workLastError: string | null = null;
  private auditLastError: string | null = null;
  private readonly workWriteTails = new Map<string, Promise<boolean>>();

  getHealth(): { state: "ready" | "unavailable"; lastError: string | null } {
    return {
      state: this.workLastError ? "unavailable" : "ready",
      lastError: this.workLastError,
    };
  }

  async loadWork(): Promise<PersistedOperationsWork[]> {
    try {
      const rows = await db
        .select()
        .from(autonomousOperationsWorkItemsTable)
        .orderBy(asc(autonomousOperationsWorkItemsTable.createdAt));
      this.workLastError = null;
      return rows.map((row) => ({
        workId: row.workKey,
        title: row.title,
        ownerModule: row.ownerModule,
        implementationKey: row.implementationKey,
        state: row.state,
        dependsOn: row.dependsOn,
        resourceClaims: row.resourceClaims,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        retryBaseDelayMs: row.retryBaseDelayMs,
        executionTimeoutMs: row.executionTimeoutMs,
        nextRunAt: row.nextRunAt,
        runId: row.runId,
        leaseExpiresAt: row.leaseExpiresAt,
        lastHeartbeatAt: row.lastHeartbeatAt,
        checkpoint: row.checkpoint,
        verificationEvidence: row.verificationEvidence,
        lastError: row.lastError,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    } catch (error) {
      this.workLastError = safeText(error instanceof Error ? error.message : String(error), 320);
      return [];
    }
  }

  async saveWork(work: PersistedOperationsWork, options?: { expectedRunId?: string }): Promise<boolean> {
    const priorWrite = this.workWriteTails.get(work.workId) ?? Promise.resolve();
    const write = priorWrite.catch(() => undefined).then(async () => {
      try {
        const mutableValues = {
          title: safeText(work.title, 200),
          ownerModule: safeText(work.ownerModule, 120),
          implementationKey: safeText(work.implementationKey, 160),
          state: safeText(work.state, 32),
          dependsOn: work.dependsOn,
          resourceClaims: work.resourceClaims,
          attempts: work.attempts,
          maxAttempts: work.maxAttempts,
          retryBaseDelayMs: work.retryBaseDelayMs,
          executionTimeoutMs: work.executionTimeoutMs,
          nextRunAt: work.nextRunAt,
          runId: work.runId,
          leaseExpiresAt: work.leaseExpiresAt,
          lastHeartbeatAt: work.lastHeartbeatAt,
          checkpoint: work.checkpoint,
          verificationEvidence: work.verificationEvidence,
          lastError: work.lastError ? safeText(work.lastError, 500) : null,
          updatedAt: work.updatedAt,
        };
        if (options?.expectedRunId) {
          const [updated] = await db
            .update(autonomousOperationsWorkItemsTable)
            .set(mutableValues)
            .where(and(
              eq(autonomousOperationsWorkItemsTable.workKey, work.workId),
              eq(autonomousOperationsWorkItemsTable.runId, options.expectedRunId),
            ))
            .returning({ workKey: autonomousOperationsWorkItemsTable.workKey });
          if (!updated) return false;
          this.workLastError = null;
          return true;
        }
        await db
        .insert(autonomousOperationsWorkItemsTable)
        .values({
          workKey: work.workId,
          ...mutableValues,
          createdAt: work.createdAt,
        })
        .onConflictDoUpdate({
          target: autonomousOperationsWorkItemsTable.workKey,
          set: mutableValues,
          });
        this.workLastError = null;
        return true;
      } catch (error) {
        this.workLastError = safeText(error instanceof Error ? error.message : String(error), 320);
        return false;
      }
    });
    this.workWriteTails.set(work.workId, write);
    try {
      return await write;
    } finally {
      if (this.workWriteTails.get(work.workId) === write) this.workWriteTails.delete(work.workId);
    }
  }

  /**
   * The only transition that grants a handler permission to run. PostgreSQL
   * evaluates the ready-state predicate and sets the run token atomically, so
   * concurrent API processes cannot execute the same static handler.
   */
  async claimWork(input: {
    workId: string;
    runId: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<{
    attempts: number;
    runId: string;
    leaseExpiresAt: Date;
    lastHeartbeatAt: Date;
    updatedAt: Date;
  } | null> {
    try {
      const [row] = await db
        .update(autonomousOperationsWorkItemsTable)
        .set({
          state: "running",
          attempts: sql`${autonomousOperationsWorkItemsTable.attempts} + 1`,
          runId: input.runId,
          leaseExpiresAt: input.leaseExpiresAt,
          lastHeartbeatAt: input.now,
          nextRunAt: null,
          lastError: null,
          updatedAt: input.now,
        })
        .where(and(
          eq(autonomousOperationsWorkItemsTable.workKey, input.workId),
          inArray(autonomousOperationsWorkItemsTable.state, ["internally_accepted", "stalled"]),
          or(
            isNull(autonomousOperationsWorkItemsTable.nextRunAt),
            lte(autonomousOperationsWorkItemsTable.nextRunAt, input.now),
          ),
        ))
        .returning({
          attempts: autonomousOperationsWorkItemsTable.attempts,
          runId: autonomousOperationsWorkItemsTable.runId,
          leaseExpiresAt: autonomousOperationsWorkItemsTable.leaseExpiresAt,
          lastHeartbeatAt: autonomousOperationsWorkItemsTable.lastHeartbeatAt,
          updatedAt: autonomousOperationsWorkItemsTable.updatedAt,
        });
      this.workLastError = null;
      if (!row) return null;
      const { runId, leaseExpiresAt, lastHeartbeatAt } = row;
      if (!runId || !leaseExpiresAt || !lastHeartbeatAt) return null;
      return {
        attempts: row.attempts,
        runId,
        leaseExpiresAt,
        lastHeartbeatAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      this.workLastError = safeText(error instanceof Error ? error.message : String(error), 320);
      return null;
    }
  }

  async appendAudit(input: {
    workId: string | null;
    event: string;
    reason: string;
    evidence: AutonomousOperationEvidence;
    occurredAt: Date;
  }): Promise<boolean> {
    try {
      await db.insert(autonomousOperationsAuditTable).values({
        workKey: input.workId,
        event: safeText(input.event, 48),
        reason: safeText(input.reason, 500),
        evidence: evidence(input.evidence),
        occurredAt: input.occurredAt,
      });
      this.auditLastError = null;
      return true;
    } catch (error) {
      this.auditLastError = safeText(error instanceof Error ? error.message : String(error), 320);
      return false;
    }
  }

  async listRecentAudit(limit = 40) {
    return db
      .select()
      .from(autonomousOperationsAuditTable)
      .orderBy(desc(autonomousOperationsAuditTable.occurredAt))
      .limit(Math.max(1, Math.min(100, Math.trunc(limit))));
  }
}