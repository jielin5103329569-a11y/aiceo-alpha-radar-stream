import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger";

export type MarketUniverseRefreshState =
  | "idle"
  | "refreshing"
  | "ready"
  | "degraded"
  | "unavailable";
export type ReferenceFreshness = "fresh" | "stale" | "missing";
export type ReferenceDataQuality = "good" | "degraded" | "unavailable";
export type SecurityLifecycleStatus =
  | "active"
  | "halted"
  | "inactive"
  | "delisted"
  | "unknown";
export type SecurityEligibility = "eligible" | "ineligible";
export type NormalizedSecurityType =
  | "common_stock"
  | "fund"
  | "adr"
  | "preferred"
  | "warrant"
  | "unit"
  | "right"
  | "other"
  | "unknown";

export type SecurityReference = {
  symbol: string;
  providerSymbol: string;
  instrumentId: string | null;
  listingId: string | null;
  issuerName: string | null;
  listingExchange: string | null;
  primaryExchange: string | null;
  securityType: NormalizedSecurityType;
  providerSecurityType: string | null;
  instrumentClass: string | null;
  lifecycleStatus: SecurityLifecycleStatus;
  lifecycleReason: string;
  eligibility: SecurityEligibility;
  eligibilityReasons: string[];
  sector: string | null;
  industryGroup: string | null;
  industry: string | null;
  classificationSource: string | null;
  referenceUpdatedAt: Date;
};

export type MarketUniverseSummary = {
  provider: "Databento";
  dataset: string;
  source: string;
  deliveryMode: "reference_only";
  refreshState: MarketUniverseRefreshState;
  lastAttemptAt: Date | null;
  refreshedAt: Date | null;
  sourceTimestamp: Date | null;
  expiresAt: Date | null;
  freshness: ReferenceFreshness;
  dataQuality: ReferenceDataQuality;
  reason: string;
  totalCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  commonEquityVerifiedCount: number;
  classificationCoverageCount: number;
  lifecycleCounts: Record<SecurityLifecycleStatus, number>;
  eligibleSample: string[];
};

export type MarketUniverseQuery = {
  search?: string;
  eligibility?: SecurityEligibility | "all";
  lifecycle?: SecurityLifecycleStatus | "all";
  limit?: number;
  offset?: number;
};

export type MarketUniverseResult = {
  summary: MarketUniverseSummary;
  items: SecurityReference[];
  total: number;
  limit: number;
  offset: number;
};

export type RawSecurityReference = {
  providerSymbol?: unknown;
  instrumentId?: unknown;
  listingId?: unknown;
  issuerName?: unknown;
  listingExchange?: unknown;
  primaryExchange?: unknown;
  providerSecurityType?: unknown;
  instrumentClass?: unknown;
  securityUpdateAction?: unknown;
  listingStatus?: unknown;
  tradingStatus?: unknown;
  cfi?: unknown;
  sector?: unknown;
  industryGroup?: unknown;
  industry?: unknown;
  classificationSource?: unknown;
  referenceUpdatedAt?: unknown;
  primaryListing?: unknown;
};

export type MarketUniverseSourceMetadata = {
  dataset: string;
  source: string;
  sourceKind: "security_master" | "definitions";
  sourceTimestamp: Date;
  maxAgeMs?: number;
  reason: string;
};

type BridgeEvent =
  | {
      type: "meta";
      dataset: string;
      source: string;
      sourceKind: "security_master" | "definitions";
      sourceTimestamp: string;
      maxAgeMs: number;
      reason: string;
    }
  | ({ type: "security" } & RawSecurityReference)
  | { type: "complete"; recordCount: number }
  | { type: "error"; message: string };

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(currentDir, "databento_reference_bridge.py");
const DEFAULT_REFERENCE_MAX_AGE_MS = 96 * 60 * 60 * 1_000;
const SECURITY_MASTER_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1_000;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const REFRESH_TIMEOUT_MS = 120_000;
const MAX_QUERY_LIMIT = 200;
const COMMON_STOCK_TYPES = new Set([
  "COMMON",
  "COMMON STOCK",
  "COMMON_STOCK",
  "COMMON SHARES",
  "CS",
  "EQ",
  "EQUITY",
  "ORDINARY SHARES",
  "STOCK",
]);

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.toLowerCase() !== "nan" && text.toLowerCase() !== "nat"
    ? text
    : null;
}

function dateValue(value: unknown): Date | null {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeReferenceSymbol(value: unknown): string | null {
  const symbol = cleanText(value)?.toUpperCase() ?? null;
  if (!symbol || !/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) return null;
  return symbol;
}

export function normalizeSecurityType(
  providerSecurityType: unknown,
  cfi: unknown,
): NormalizedSecurityType {
  const type = cleanText(providerSecurityType)?.toUpperCase() ?? "";
  const cfiValue = cleanText(cfi)?.toUpperCase() ?? "";
  if (COMMON_STOCK_TYPES.has(type) || cfiValue.startsWith("ES")) return "common_stock";
  if (/ETF|ETN|FUND|MUTUAL|CLOSED.END/.test(type)) return "fund";
  if (/ADR|DEPOSITARY/.test(type) || cfiValue.startsWith("ED")) return "adr";
  if (/PREF/.test(type) || cfiValue.startsWith("EP")) return "preferred";
  if (/WARRANT/.test(type) || cfiValue.startsWith("RW")) return "warrant";
  if (/UNIT/.test(type)) return "unit";
  if (/RIGHT/.test(type)) return "right";
  return type || cfiValue ? "other" : "unknown";
}

export function normalizeLifecycle(
  securityUpdateAction: unknown,
  listingStatus: unknown,
  tradingStatus: unknown,
): { status: SecurityLifecycleStatus; reason: string } {
  const action = cleanText(securityUpdateAction)?.toUpperCase() ?? "";
  const listing = cleanText(listingStatus)?.toUpperCase() ?? "";
  const trading = cleanText(tradingStatus)?.toUpperCase() ?? "";

  if (action === "D" || action === "DELETE" || listing === "D" || listing === "DELISTED") {
    return { status: "delisted", reason: "The reference source marks this listing as deleted or delisted." };
  }
  if (
    ["H", "HALTED", "S", "SUSPENDED"].includes(listing)
    || ["2", "HALTED", "TRADING HALT"].includes(trading)
  ) {
    return { status: "halted", reason: "The reference source marks trading as halted or suspended." };
  }
  if (
    ["I", "INACTIVE", "N", "NOT LISTED"].includes(listing)
    || ["4", "18", "INACTIVE", "NOT AVAILABLE"].includes(trading)
  ) {
    return { status: "inactive", reason: "The reference source marks this listing as inactive." };
  }
  if (
    ["A", "ACTIVE", "LISTED"].includes(listing)
    || ["1", "3", "17", "21", "ACTIVE", "READY TO TRADE", "PRE-OPEN"].includes(trading)
  ) {
    return { status: "active", reason: "The reference source marks this listing as active." };
  }
  return {
    status: "unknown",
    reason: "The reference source did not provide a recognized lifecycle status.",
  };
}

function eligibilityFor(
  securityType: NormalizedSecurityType,
  lifecycleStatus: SecurityLifecycleStatus,
  securityTypeVerified: boolean,
): { eligibility: SecurityEligibility; reasons: string[] } {
  const reasons: string[] = [];
  if (!securityTypeVerified) {
    reasons.push("The current reference source does not verify common-equity type.");
  } else if (securityType !== "common_stock") {
    reasons.push(
      securityType === "unknown"
        ? "Common-equity type is not verified by the current reference source."
        : `Security type ${securityType.replaceAll("_", " ")} is outside the common-equity universe.`,
    );
  }
  if (lifecycleStatus !== "active") {
    reasons.push(`Lifecycle status ${lifecycleStatus} is not eligible for candidate discovery.`);
  }
  return {
    eligibility: reasons.length === 0 ? "eligible" : "ineligible",
    reasons,
  };
}

function normalizeSecurity(
  raw: RawSecurityReference,
  sourceKind: MarketUniverseSourceMetadata["sourceKind"],
): SecurityReference | null {
  const symbol = normalizeReferenceSymbol(raw.providerSymbol);
  const referenceUpdatedAt = dateValue(raw.referenceUpdatedAt);
  if (!symbol || !referenceUpdatedAt) return null;
  const securityType = normalizeSecurityType(raw.providerSecurityType, raw.cfi);
  const lifecycle = normalizeLifecycle(
    raw.securityUpdateAction,
    raw.listingStatus,
    raw.tradingStatus,
  );
  const eligibility = eligibilityFor(
    securityType,
    lifecycle.status,
    sourceKind === "security_master",
  );
  return {
    symbol,
    providerSymbol: cleanText(raw.providerSymbol) ?? symbol,
    instrumentId: cleanText(raw.instrumentId),
    listingId: cleanText(raw.listingId),
    issuerName: cleanText(raw.issuerName),
    listingExchange: cleanText(raw.listingExchange),
    primaryExchange: cleanText(raw.primaryExchange),
    securityType,
    providerSecurityType: cleanText(raw.providerSecurityType),
    instrumentClass: cleanText(raw.instrumentClass),
    lifecycleStatus: lifecycle.status,
    lifecycleReason: lifecycle.reason,
    eligibility: eligibility.eligibility,
    eligibilityReasons: eligibility.reasons,
    sector: cleanText(raw.sector),
    industryGroup: cleanText(raw.industryGroup),
    industry: cleanText(raw.industry),
    classificationSource: cleanText(raw.classificationSource),
    referenceUpdatedAt,
  };
}

function preferRawRecord(next: RawSecurityReference, current: RawSecurityReference): boolean {
  const nextPrimary = next.primaryListing === true;
  const currentPrimary = current.primaryListing === true;
  if (nextPrimary !== currentPrimary) return nextPrimary;
  const nextAt = dateValue(next.referenceUpdatedAt)?.getTime() ?? 0;
  const currentAt = dateValue(current.referenceUpdatedAt)?.getTime() ?? 0;
  return nextAt >= currentAt;
}

function emptyLifecycleCounts(): Record<SecurityLifecycleStatus, number> {
  return { active: 0, halted: 0, inactive: 0, delisted: 0, unknown: 0 };
}

export class MarketUniverseRegistry {
  private securities = new Map<string, SecurityReference>();
  private metadata: MarketUniverseSourceMetadata | null = null;
  private refreshedAt: Date | null = null;
  private expiresAt: Date | null = null;
  private lifecycleCounts = emptyLifecycleCounts();
  private eligibleCount = 0;
  private commonEquityVerifiedCount = 0;
  private classificationCoverageCount = 0;
  private eligibleSample: string[] = [];

  replace(
    rawRecords: RawSecurityReference[],
    metadata: MarketUniverseSourceMetadata,
    refreshedAt = new Date(),
  ): void {
    const preferred = new Map<string, RawSecurityReference>();
    rawRecords.forEach((raw) => {
      const symbol = normalizeReferenceSymbol(raw.providerSymbol);
      if (!symbol) return;
      const current = preferred.get(symbol);
      if (!current || preferRawRecord(raw, current)) preferred.set(symbol, raw);
    });

    const next = new Map<string, SecurityReference>();
    preferred.forEach((raw) => {
      const security = normalizeSecurity(raw, metadata.sourceKind);
      if (security) next.set(security.symbol, security);
    });

    this.securities = next;
    this.metadata = metadata;
    this.refreshedAt = refreshedAt;
    this.expiresAt = new Date(
      metadata.sourceTimestamp.getTime()
      + (metadata.maxAgeMs
        ?? (metadata.sourceKind === "security_master"
          ? SECURITY_MASTER_MAX_AGE_MS
          : DEFAULT_REFERENCE_MAX_AGE_MS)),
    );
    this.recalculateCounts();
  }

  private recalculateCounts(): void {
    this.lifecycleCounts = emptyLifecycleCounts();
    this.eligibleCount = 0;
    this.commonEquityVerifiedCount = 0;
    this.classificationCoverageCount = 0;
    const sample: string[] = [];
    this.securities.forEach((security) => {
      this.lifecycleCounts[security.lifecycleStatus] += 1;
      if (security.securityType === "common_stock") this.commonEquityVerifiedCount += 1;
      if (security.sector && security.industryGroup && security.industry) {
        this.classificationCoverageCount += 1;
      }
      if (security.eligibility === "eligible") {
        this.eligibleCount += 1;
        if (sample.length < 8) sample.push(security.symbol);
      }
    });
    this.eligibleSample = sample.sort();
  }

  getSummary(
    now = new Date(),
    refreshState: MarketUniverseRefreshState = this.metadata ? "ready" : "idle",
    lastAttemptAt: Date | null = null,
    overrideReason: string | null = null,
  ): MarketUniverseSummary {
    const sourceTimestamp = this.metadata?.sourceTimestamp ?? null;
    const freshness: ReferenceFreshness = !sourceTimestamp || !this.expiresAt
      ? "missing"
      : now.getTime() <= this.expiresAt.getTime()
        ? "fresh"
        : "stale";
    const totalCount = this.securities.size;
    const eligibleCount = freshness === "fresh" ? this.eligibleCount : 0;
    const ineligibleCount = totalCount - eligibleCount;
    const classificationComplete = eligibleCount > 0
      && this.classificationCoverageCount >= eligibleCount;
    const dataQuality: ReferenceDataQuality = totalCount === 0 || freshness !== "fresh"
      ? "unavailable"
      : classificationComplete
        ? "good"
        : "degraded";
    const reason = overrideReason
      ?? (freshness === "stale"
        ? "The reference snapshot is stale, so all discovered symbols are ineligible until refresh."
        : this.metadata?.reason
          ?? "The reference universe has not completed its first refresh.");

    return {
      provider: "Databento",
      dataset: this.metadata?.dataset ?? "EQUS.MINI",
      source: this.metadata?.source ?? "Databento reference universe",
      deliveryMode: "reference_only",
      refreshState,
      lastAttemptAt,
      refreshedAt: this.refreshedAt,
      sourceTimestamp,
      expiresAt: this.expiresAt,
      freshness,
      dataQuality,
      reason,
      totalCount,
      eligibleCount,
      ineligibleCount,
      commonEquityVerifiedCount: this.commonEquityVerifiedCount,
      classificationCoverageCount: this.classificationCoverageCount,
      lifecycleCounts: { ...this.lifecycleCounts },
      eligibleSample: freshness === "fresh" ? [...this.eligibleSample] : [],
    };
  }

  query(
    query: MarketUniverseQuery = {},
    now = new Date(),
    refreshState: MarketUniverseRefreshState = this.metadata ? "ready" : "idle",
    lastAttemptAt: Date | null = null,
    overrideReason: string | null = null,
  ): MarketUniverseResult {
    const summary = this.getSummary(now, refreshState, lastAttemptAt, overrideReason);
    const search = query.search?.trim().toUpperCase() ?? "";
    const eligibility = query.eligibility ?? "eligible";
    const lifecycle = query.lifecycle ?? "all";
    const limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.trunc(query.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const stale = summary.freshness !== "fresh";

    const items = [...this.securities.values()]
      .map((security): SecurityReference => {
        if (!stale || security.eligibility === "ineligible") return security;
        return {
          ...security,
          eligibility: "ineligible",
          eligibilityReasons: [
            ...security.eligibilityReasons,
            "The reference snapshot is stale.",
          ],
        };
      })
      .filter((security) => (
        (!search
          || security.symbol.includes(search)
          || security.issuerName?.toUpperCase().includes(search))
        && (eligibility === "all" || security.eligibility === eligibility)
        && (lifecycle === "all" || security.lifecycleStatus === lifecycle)
      ))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    return {
      summary,
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  }
}

function redactMessage(message: string): string {
  const key = process.env.DATABENTO_API_KEY;
  const withoutKey = key ? message.replaceAll(key, "[redacted]") : message;
  return withoutKey.replace(/db-[a-z0-9_-]{16,}/gi, "[redacted]").slice(0, 500);
}

export class MarketUniverseService extends EventEmitter {
  private readonly registry = new MarketUniverseRegistry();
  private refreshState: MarketUniverseRefreshState = "idle";
  private lastAttemptAt: Date | null = null;
  private reason: string | null = null;
  private child: ChildProcess | null = null;
  private refreshPromise: Promise<MarketUniverseSummary> | null = null;
  private interval: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    this.interval = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    this.started = false;
  }

  getSummary(now = new Date()): MarketUniverseSummary {
    return this.registry.getSummary(now, this.refreshState, this.lastAttemptAt, this.reason);
  }

  query(query: MarketUniverseQuery = {}, now = new Date()): MarketUniverseResult {
    return this.registry.query(query, now, this.refreshState, this.lastAttemptAt, this.reason);
  }

  refresh(): Promise<MarketUniverseSummary> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private performRefresh(): Promise<MarketUniverseSummary> {
    this.lastAttemptAt = new Date();
    if (!process.env.DATABENTO_API_KEY) {
      this.refreshState = "unavailable";
      this.reason = "DATABENTO_API_KEY is not configured for reference discovery.";
      this.emit("status", this.getSummary());
      return Promise.resolve(this.getSummary());
    }

    this.refreshState = "refreshing";
    this.reason = "Refreshing the low-frequency Databento reference universe.";
    this.emit("status", this.getSummary());

    return new Promise((resolve) => {
      const records: RawSecurityReference[] = [];
      let metadata: MarketUniverseSourceMetadata | null = null;
      let complete = false;
      let settled = false;
      let outputBuffer = "";
      let stderr = "";
      const child = spawn("python3", ["-u", bridgePath], {
        cwd: currentDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      const finish = (error: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.child = null;
        if (!error && complete && metadata && records.length > 0) {
          this.registry.replace(records, metadata, new Date());
          const summary = this.registry.getSummary(new Date(), "ready", this.lastAttemptAt);
          this.refreshState = summary.dataQuality === "good" ? "ready" : "degraded";
          this.reason = metadata.reason;
          logger.info(
            {
              totalCount: summary.totalCount,
              eligibleCount: summary.eligibleCount,
              dataQuality: summary.dataQuality,
              source: summary.source,
            },
            "Refreshed Databento reference universe",
          );
        } else {
          const previous = this.registry.getSummary();
          this.refreshState = previous.totalCount > 0 ? "degraded" : "unavailable";
          this.reason = redactMessage(
            error
              ?? stderr
              ?? "Databento reference refresh ended before a complete snapshot was received.",
          );
          logger.warn({ reason: this.reason }, "Databento reference universe unavailable");
        }
        const summary = this.getSummary();
        this.emit("status", summary);
        resolve(summary);
      };

      const applyLine = (line: string): void => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as BridgeEvent;
          if (event.type === "meta") {
            const sourceTimestamp = new Date(event.sourceTimestamp);
            if (Number.isNaN(sourceTimestamp.getTime())) {
              throw new Error("Databento reference bridge returned an invalid source timestamp.");
            }
            metadata = {
              dataset: event.dataset,
              source: event.source,
              sourceKind: event.sourceKind,
              sourceTimestamp,
              maxAgeMs: event.maxAgeMs,
              reason: event.reason,
            };
          } else if (event.type === "security") {
            records.push(event);
          } else if (event.type === "complete") {
            complete = event.recordCount === records.length;
          } else if (event.type === "error") {
            finish(event.message);
          }
        } catch (error) {
          finish(error instanceof Error ? error.message : "Invalid reference bridge event.");
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        outputBuffer += chunk.toString("utf8");
        const lines = outputBuffer.split("\n");
        outputBuffer = lines.pop() ?? "";
        lines.forEach(applyLine);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-1_000);
      });
      child.on("error", (error) => finish(error.message));
      child.on("close", (code) => {
        if (outputBuffer.trim()) applyLine(outputBuffer);
        finish(
          code === 0
            ? null
            : `Databento reference bridge exited with code ${code ?? "unknown"}. ${stderr}`,
        );
      });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish("Databento reference refresh timed out.");
      }, REFRESH_TIMEOUT_MS);
    });
  }
}

export const marketUniverse = new MarketUniverseService();