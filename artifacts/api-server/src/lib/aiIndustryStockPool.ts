import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { desc, eq, sql } from "drizzle-orm";
import {
  aiIndustryPoolEventsTable,
  aiIndustryPoolMembersTable,
  aiIndustryPoolSnapshotsTable,
  aiIndustryReferenceUsageTable,
  db,
} from "@workspace/db";

import {
  AI_INDUSTRY_IDENTIFIER_CAPACITY,
  AI_INDUSTRY_TAXONOMY,
  AI_INDUSTRY_TAXONOMY_VERSION,
  type AiIndustryTaxonomyEntry,
} from "./aiIndustryTaxonomy";
import { logger } from "./logger";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(currentDir, "databento_targeted_reference_bridge.py");
const ENRICHMENT_COOLDOWN_MS = 15 * 60 * 1000;
const NEAR_CAPACITY_RATIO = 0.85;

type MembershipState = "observed" | "enrichment_pending" | "withheld" | "verified" | "exited";
type SectorReviewState = "not_eligible" | "withheld_reference" | "ready_for_sector_review";
type CapacityState = "normal" | "near_limit" | "at_capacity" | "blocked";
type TargetedReferenceRecord = {
  symbol: string;
  securityIdentifier: string;
  listingStatus: string | null;
  securityType: string | null;
};

export type AiIndustryPoolMemberSnapshot = {
  symbol: string;
  categories: string[];
  membershipState: MembershipState;
  sectorReviewState: SectorReviewState;
  entryReason: string;
  exitReason: string | null;
  referenceIdentifier: string | null;
  updatedAt: Date;
};

export type AiIndustryPoolSnapshot = {
  strategyVersion: string;
  generatedAt: Date;
  activeCount: number;
  historicalDistinctCount: number;
  identifierCapacity: number;
  remainingEstimate: number;
  capacityState: CapacityState;
  persistenceState: "ready" | "recovering" | "unavailable";
  referenceAuthorizationState: "unknown" | "verified" | "blocked" | "unavailable";
  referenceReason: string;
  reason: string;
  isolatedServices: string[];
  members: AiIndustryPoolMemberSnapshot[];
};

export type AiIndustryPoolHistoryEvent = {
  eventKey: string;
  symbol: string;
  eventType: string;
  reason: string;
  evidence: Record<string, string | number | boolean | null>;
  occurredAt: Date;
};

export type PrequalifiedLiveCandidate = {
  symbol: string;
  marketFeedState: string;
  preBreakoutState: string;
  confirmationStatus: string;
};

function containsEntitlementFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("license_reference_dataset_no_subscription")
    || normalized.includes("no_subscription")
    || normalized.includes("403");
}

function catalogHash(entries: readonly AiIndustryTaxonomyEntry[]): string {
  return createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
}

function capacityState(distinctCount: number): CapacityState {
  if (distinctCount >= AI_INDUSTRY_IDENTIFIER_CAPACITY) return "at_capacity";
  if (distinctCount >= AI_INDUSTRY_IDENTIFIER_CAPACITY * NEAR_CAPACITY_RATIO) return "near_limit";
  return "normal";
}

function isActiveCommonEquity(record: TargetedReferenceRecord): boolean {
  const listingStatus = record.listingStatus?.trim().toLowerCase() ?? "";
  const securityType = record.securityType?.trim().toLowerCase() ?? "";
  const active = listingStatus === "active" || listingStatus === "trading";
  const commonEquity = securityType.includes("common") || securityType === "cs";
  return active && commonEquity;
}

/**
 * Isolated discovery and entitlement ledger. The pool intentionally has no
 * dependency on protected scanners, alert delivery, the operations queue,
 * Shadow Learning, or validation persistence.
 */
export class AiIndustryStockPoolService extends EventEmitter {
  private members = new Map<string, AiIndustryPoolMemberSnapshot>();
  private readonly ledgerIdentifiers = new Set<string>();
  private started = false;
  private persistenceState: AiIndustryPoolSnapshot["persistenceState"] = "recovering";
  private referenceAuthorizationState: AiIndustryPoolSnapshot["referenceAuthorizationState"] = "unknown";
  private referenceReason = "No targeted Reference enrichment has been requested.";
  private lastEnrichmentAttemptAt: Date | null = null;
  private child: ChildProcess | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.restoreAndSynchronize();
  }

  stop(): void {
    this.started = false;
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  getSnapshot(now = new Date()): AiIndustryPoolSnapshot {
    const historicalDistinctCount = this.ledgerIdentifiers.size;
    const state = capacityState(historicalDistinctCount);
    const sortedMembers = [...this.members.values()]
      .filter((member) => member.membershipState !== "exited")
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .slice(0, 40);
    return {
      strategyVersion: AI_INDUSTRY_TAXONOMY_VERSION,
      generatedAt: now,
      activeCount: [...this.members.values()].filter((member) => member.membershipState !== "exited").length,
      historicalDistinctCount,
      identifierCapacity: AI_INDUSTRY_IDENTIFIER_CAPACITY,
      remainingEstimate: Math.max(0, AI_INDUSTRY_IDENTIFIER_CAPACITY - historicalDistinctCount),
      capacityState: this.persistenceState === "unavailable" ? "blocked" : state,
      persistenceState: this.persistenceState,
      referenceAuthorizationState: this.referenceAuthorizationState,
      referenceReason: this.referenceReason,
      reason: "The system-managed taxonomy is discovery-only. Its members cannot expand protected scans or reach Alert or Buy authority without independent live, freshness, and reference gates.",
      isolatedServices: ["protected-symbol scanners", "Alert delivery", "Operations Queue", "Shadow Learning", "signal validation"],
      members: sortedMembers,
    };
  }

  async listRecentHistory(limit = 100): Promise<AiIndustryPoolHistoryEvent[]> {
    const events = await db.select({
      eventKey: aiIndustryPoolEventsTable.eventKey,
      symbol: aiIndustryPoolEventsTable.symbol,
      eventType: aiIndustryPoolEventsTable.eventType,
      reason: aiIndustryPoolEventsTable.reason,
      evidence: aiIndustryPoolEventsTable.evidence,
      occurredAt: aiIndustryPoolEventsTable.occurredAt,
    }).from(aiIndustryPoolEventsTable)
      .orderBy(desc(aiIndustryPoolEventsTable.occurredAt))
      .limit(Math.min(100, Math.max(1, limit)));
    return events;
  }

  /**
   * Called only with candidates from the isolated focused-scan sidecar that
   * already passed its own live pre-breakout confirmation. It schedules one
   * bounded Reference request and never changes scanner/ranking state.
   */
  considerPrequalifiedLiveCandidates(candidates: readonly PrequalifiedLiveCandidate[]): void {
    if (!this.started || this.child || this.persistenceState !== "ready") return;
    if (this.lastEnrichmentAttemptAt && Date.now() - this.lastEnrichmentAttemptAt.getTime() < ENRICHMENT_COOLDOWN_MS) return;
    const symbols = candidates
      .filter((candidate) =>
        candidate.marketFeedState === "streaming"
        && candidate.preBreakoutState === "confirmed"
        && candidate.confirmationStatus === "confirmed"
        && this.members.has(candidate.symbol),
      )
      .map((candidate) => candidate.symbol)
      .filter((symbol) => this.members.get(symbol)?.membershipState !== "verified")
      .slice(0, 12);
    if (symbols.length === 0) return;
    this.lastEnrichmentAttemptAt = new Date();
    // This sidecar is never allowed to propagate an asynchronous storage or
    // bridge failure into the protected radar process.
    void this.reserveAndEnrich(symbols).catch((error: unknown) => {
      this.handleBackgroundFailure(error, symbols);
    });
  }

  private handleBackgroundFailure(error: unknown, symbols: readonly string[]): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.persistenceState = "unavailable";
    this.referenceAuthorizationState = "unavailable";
    this.referenceReason = "AI industry pool persistence or enrichment is unavailable; all pending candidates are withheld.";
    const updatedAt = new Date();
    for (const symbol of symbols) {
      const member = this.members.get(symbol);
      if (!member) continue;
      this.members.set(symbol, {
        ...member,
        membershipState: "withheld",
        sectorReviewState: "withheld_reference",
        exitReason: reason,
        updatedAt,
      });
    }
    logger.warn({ error, symbols }, "AI industry pool background work failed closed and remains isolated");
    this.emit("status", this.getSnapshot());
  }

  private async restoreAndSynchronize(): Promise<void> {
    try {
      const existing = await db.select().from(aiIndustryPoolMembersTable);
      for (const member of existing) {
        this.members.set(member.symbol, {
          symbol: member.symbol,
          categories: member.categories,
          membershipState: member.membershipState as MembershipState,
          sectorReviewState: member.sectorReviewState as SectorReviewState,
          entryReason: member.entryReason,
          exitReason: member.exitReason,
          referenceIdentifier: member.securityIdentifier,
          updatedAt: member.updatedAt,
        });
      }
      const usage = await db.select({ securityIdentifier: aiIndustryReferenceUsageTable.securityIdentifier })
        .from(aiIndustryReferenceUsageTable);
      usage.forEach((entry) => this.ledgerIdentifiers.add(entry.securityIdentifier));
      await this.synchronizeCatalog();
      this.persistenceState = "ready";
      this.emit("status", this.getSnapshot());
    } catch (error) {
      this.persistenceState = "unavailable";
      logger.warn({ error }, "AI industry pool persistence is unavailable; pool remains read-only and withheld");
      this.emit("status", this.getSnapshot());
    }
  }

  private async synchronizeCatalog(): Promise<void> {
    const now = new Date();
    const hash = catalogHash(AI_INDUSTRY_TAXONOMY);
    const capacityBoundedCatalog = AI_INDUSTRY_TAXONOMY.slice(0, AI_INDUSTRY_IDENTIFIER_CAPACITY);
    const currentCatalogSymbols = new Set(capacityBoundedCatalog.map((entry) => entry.symbol));
    for (const member of this.members.values()) {
      if (member.membershipState !== "exited" && !currentCatalogSymbols.has(member.symbol)) {
        await this.setMemberState(
          member.symbol,
          "exited",
          "not_eligible",
          "The server-managed taxonomy no longer classifies this symbol as AI-industry discovery coverage.",
        );
      }
    }
    for (const entry of capacityBoundedCatalog) {
      const prior = this.members.get(entry.symbol);
      const snapshot: AiIndustryPoolMemberSnapshot = {
        symbol: entry.symbol,
        categories: entry.categories,
        membershipState: prior?.membershipState === "exited" ? "observed" : prior?.membershipState ?? "observed",
        sectorReviewState: prior?.membershipState === "exited" ? "not_eligible" : prior?.sectorReviewState ?? "not_eligible",
        entryReason: prior?.membershipState === "exited"
          ? "Re-entered after the server-managed taxonomy classified it as AI-industry discovery coverage."
          : prior?.entryReason ?? "System-managed AI infrastructure taxonomy discovery.",
        exitReason: prior?.membershipState === "exited" ? null : prior?.exitReason ?? null,
        referenceIdentifier: prior?.referenceIdentifier ?? null,
        updatedAt: now,
      };
      this.members.set(entry.symbol, snapshot);
      await db.insert(aiIndustryPoolMembersTable).values({
        symbol: snapshot.symbol,
        securityIdentifier: snapshot.referenceIdentifier,
        categories: snapshot.categories,
        membershipState: snapshot.membershipState,
        sectorReviewState: snapshot.sectorReviewState,
        entryReason: snapshot.entryReason,
        exitReason: null,
        strategyVersion: AI_INDUSTRY_TAXONOMY_VERSION,
        firstObservedAt: prior?.updatedAt ?? now,
        lastObservedAt: now,
      }).onConflictDoUpdate({
        target: aiIndustryPoolMembersTable.symbol,
        set: {
          categories: snapshot.categories,
          membershipState: snapshot.membershipState,
          sectorReviewState: snapshot.sectorReviewState,
          strategyVersion: AI_INDUSTRY_TAXONOMY_VERSION,
          lastObservedAt: now,
          updatedAt: now,
        },
      });
      if (!prior || prior.membershipState === "exited") {
        await db.insert(aiIndustryPoolEventsTable).values({
          eventKey: `${prior?.membershipState === "exited" ? "reenter" : "enter"}:${AI_INDUSTRY_TAXONOMY_VERSION}:${entry.symbol}`,
          symbol: entry.symbol,
          eventType: "entered",
          reason: snapshot.entryReason,
          evidence: { taxonomyVersion: AI_INDUSTRY_TAXONOMY_VERSION, categoryCount: entry.categories.length },
          occurredAt: now,
        }).onConflictDoNothing({ target: aiIndustryPoolEventsTable.eventKey });
      }
    }
    await db.insert(aiIndustryPoolSnapshotsTable).values({
      strategyVersion: AI_INDUSTRY_TAXONOMY_VERSION,
      catalogHash: hash,
      activeCount: [...this.members.values()].filter((member) => member.membershipState !== "exited").length,
      historicalDistinctCount: this.ledgerIdentifiers.size,
      capacity: AI_INDUSTRY_IDENTIFIER_CAPACITY,
      capacityState: capacityState(this.ledgerIdentifiers.size),
      referenceAuthorizationState: this.referenceAuthorizationState,
      referenceReason: this.referenceReason,
      generatedAt: now,
    }).onConflictDoNothing({ target: aiIndustryPoolSnapshotsTable.catalogHash });
  }

  private async reserveAndEnrich(symbols: string[]): Promise<void> {
    const allowed = await this.reserveEnrichmentCapacity(symbols);
    const withheld = symbols.filter((symbol) => !allowed.includes(symbol));
    for (const symbol of withheld) {
      await this.setMemberState(symbol, "withheld", "withheld_reference", "Reference identifier capacity is exhausted.");
    }
    if (allowed.length > 0) await this.enrich(allowed);
  }

  /** Reserve before provider access. A restart retains a reserved identifier
   * rather than risking an unaccounted provider request or capacity overrun. */
  private async reserveEnrichmentCapacity(symbols: string[]): Promise<string[]> {
    return db.transaction(async (tx) => {
      // This fixed namespace lock serializes capacity allocation across API
      // processes while keeping the lock only for this short transaction.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(531_000_053)`);
      const persisted = await tx.select({ securityIdentifier: aiIndustryReferenceUsageTable.securityIdentifier })
        .from(aiIndustryReferenceUsageTable);
      const identifiers = new Set(persisted.map((entry) => entry.securityIdentifier));
      this.ledgerIdentifiers.clear();
      identifiers.forEach((identifier) => this.ledgerIdentifiers.add(identifier));
      const allowed: string[] = [];
      const now = new Date();
      for (const symbol of [...new Set(symbols)]) {
        if (identifiers.has(symbol) || identifiers.size < AI_INDUSTRY_IDENTIFIER_CAPACITY) {
          allowed.push(symbol);
          identifiers.add(symbol);
          const [prior] = await tx.select().from(aiIndustryReferenceUsageTable)
            .where(eq(aiIndustryReferenceUsageTable.securityIdentifier, symbol));
          if (prior) {
            await tx.update(aiIndustryReferenceUsageTable).set({
              requestCount: prior.requestCount + 1,
              lastOutcome: "reserved",
              lastReason: "Capacity reserved before bounded targeted Security Master request.",
              lastRequestedAt: now,
              updatedAt: now,
            }).where(eq(aiIndustryReferenceUsageTable.securityIdentifier, symbol));
          } else {
            await tx.insert(aiIndustryReferenceUsageTable).values({
              securityIdentifier: symbol,
              symbol,
              requestCount: 1,
              successfulLookupCount: 0,
              lastOutcome: "reserved",
              lastReason: "Capacity reserved before bounded targeted Security Master request.",
              firstRequestedAt: now,
              lastRequestedAt: now,
              lastSuccessfulAt: null,
            });
          }
        }
      }
      allowed.forEach((symbol) => this.ledgerIdentifiers.add(symbol));
      return allowed;
    });
  }

  private async enrich(symbols: string[]): Promise<void> {
    for (const symbol of symbols) await this.setMemberState(symbol, "enrichment_pending", "not_eligible", null);
    try {
      const records = await this.runEnrichmentBridge(symbols);
      this.referenceAuthorizationState = "verified";
      this.referenceReason = "Security Master responded to a bounded live-prequalified request; every partial, missing, or ineligible record remains withheld.";
      for (const symbol of symbols) {
        const record = records.get(symbol);
        if (!record) {
          await this.recordUsage(symbol, symbol, "withheld_missing", "Security Master returned no record for this requested symbol.", false);
          await this.setMemberState(symbol, "withheld", "withheld_reference", "Security Master returned no record for this requested symbol.");
        } else if (!isActiveCommonEquity(record)) {
          await this.recordUsage(symbol, symbol, "withheld_ineligible", "Security Master record is not an active common-equity listing.", false);
          await this.setMemberState(symbol, "withheld", "withheld_reference", "Security Master record is not an active common-equity listing.");
        } else {
          await this.recordUsage(symbol, symbol, "verified", "Licensed targeted Security Master record received.", true);
          await this.setMemberState(symbol, "verified", "ready_for_sector_review", null, record.securityIdentifier);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.referenceAuthorizationState = containsEntitlementFailure(reason) ? "blocked" : "unavailable";
      this.referenceReason = containsEntitlementFailure(reason)
        ? "Databento Security Master entitlement is unavailable; requested candidates are withheld."
        : "Targeted Databento Security Master enrichment did not complete; requested candidates are withheld.";
      for (const symbol of symbols) {
        await this.recordUsage(symbol, symbol, "withheld", reason, false);
        await this.setMemberState(symbol, "withheld", "withheld_reference", reason);
      }
      logger.warn({ symbols, reason }, "AI industry targeted Reference enrichment withheld");
    } finally {
      this.emit("status", this.getSnapshot());
    }
  }

  private runEnrichmentBridge(symbols: string[]): Promise<Map<string, TargetedReferenceRecord>> {
    return new Promise((resolve, reject) => {
      const records = new Map<string, TargetedReferenceRecord>();
      let complete = false;
      let outputBuffer = "";
      const child = spawn("python3", ["-u", bridgePath, ...symbols], {
        cwd: currentDir,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;
      child.stdout?.on("data", (chunk: Buffer) => {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split("\n");
        outputBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === "error") reject(new Error(String(event.message ?? "Targeted Reference bridge failed.")));
            if (event.type === "security" && typeof event.symbol === "string") {
              const symbol = event.symbol.toUpperCase();
              if (!symbols.includes(symbol)) continue;
              records.set(symbol, {
                symbol,
                securityIdentifier: typeof event.securityIdentifier === "string" ? event.securityIdentifier : symbol,
                listingStatus: typeof event.listingStatus === "string" ? event.listingStatus : null,
                securityType: typeof event.securityType === "string" ? event.securityType : null,
              });
            }
            if (event.type === "complete") complete = true;
          } catch {
            reject(new Error("Targeted Reference bridge emitted malformed output."));
          }
        }
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", async (code) => {
        if (this.child === child) this.child = null;
        if (code !== 0 || !complete) {
          reject(new Error(stderr.slice(0, 500) || "Targeted Reference enrichment did not complete."));
          return;
        }
        resolve(records);
      });
    });
  }

  private async recordUsage(identifier: string, symbol: string, outcome: string, reason: string, successful: boolean): Promise<void> {
    const now = new Date();
    const [prior] = await db.select().from(aiIndustryReferenceUsageTable)
      .where(eq(aiIndustryReferenceUsageTable.securityIdentifier, identifier));
    await db.insert(aiIndustryReferenceUsageTable).values({
      securityIdentifier: identifier,
      symbol,
      requestCount: prior?.requestCount ?? 1,
      successfulLookupCount: (prior?.successfulLookupCount ?? 0) + (successful ? 1 : 0),
      lastOutcome: outcome,
      lastReason: reason.slice(0, 1_000),
      firstRequestedAt: prior?.firstRequestedAt ?? now,
      lastRequestedAt: now,
      lastSuccessfulAt: successful ? now : prior?.lastSuccessfulAt ?? null,
    }).onConflictDoUpdate({
      target: aiIndustryReferenceUsageTable.securityIdentifier,
      set: {
        requestCount: prior?.requestCount ?? 1,
        successfulLookupCount: (prior?.successfulLookupCount ?? 0) + (successful ? 1 : 0),
        lastOutcome: outcome,
        lastReason: reason.slice(0, 1_000),
        lastRequestedAt: now,
        lastSuccessfulAt: successful ? now : prior?.lastSuccessfulAt ?? null,
        updatedAt: now,
      },
    });
    this.ledgerIdentifiers.add(identifier);
  }

  private async setMemberState(
    symbol: string,
    membershipState: MembershipState,
    sectorReviewState: SectorReviewState,
    reason: string | null,
    securityIdentifier?: string,
  ): Promise<void> {
    const prior = this.members.get(symbol);
    if (!prior) return;
    const now = new Date();
    const next: AiIndustryPoolMemberSnapshot = {
      ...prior,
      membershipState,
      sectorReviewState,
      referenceIdentifier: securityIdentifier ?? prior.referenceIdentifier,
      exitReason: membershipState === "exited" ? reason : prior.exitReason,
      updatedAt: now,
    };
    this.members.set(symbol, next);
    await db.update(aiIndustryPoolMembersTable).set({
      securityIdentifier: next.referenceIdentifier,
      membershipState,
      sectorReviewState,
      exitReason: next.exitReason,
      updatedAt: now,
      lastObservedAt: now,
    }).where(eq(aiIndustryPoolMembersTable.symbol, symbol));
    if (reason) {
      await db.insert(aiIndustryPoolEventsTable).values({
        eventKey: `${membershipState}:${symbol}:${this.lastEnrichmentAttemptAt?.toISOString() ?? now.toISOString()}`,
        symbol,
        eventType: membershipState,
        reason: reason.slice(0, 1_000),
        evidence: { sectorReviewState, source: "targeted_security_master" },
        occurredAt: now,
      }).onConflictDoNothing({ target: aiIndustryPoolEventsTable.eventKey });
    }
  }
}

export const aiIndustryStockPool = new AiIndustryStockPoolService();