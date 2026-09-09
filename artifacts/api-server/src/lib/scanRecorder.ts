import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RadarStatus } from "./databentoLive";
import { logger } from "./logger";
import { isTimelySec8K, SEC_8K_TIMELINESS_RULE_VERSION } from "./sec8kTimeliness";

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

function defaultLogDirectory(): string {
  const cwd = process.cwd();
  return cwd.endsWith(join("artifacts", "api-server"))
    ? resolve(cwd, "..", "logs")
    : resolve(cwd, "artifacts", "logs");
}

function pacificCalendarDate(time: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(time);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function buildScanRecord(snapshot: RadarStatus, time = new Date()) {
  const symbols = snapshot.symbolRadars ?? [snapshot];
  const opportunities = new Map(
    (snapshot.opportunityCenter?.opportunities ?? []).map(
      (opportunity) => [opportunity.symbol, opportunity],
    ),
  );
  const catalystEvents = snapshot.catalystRadar?.events ?? [];
  const secStatus = snapshot.catalystRadar?.sourceStatuses.find(
    (source) => source.category === "sec_filing",
  );
  const latestSecEvent = [...catalystEvents]
    .filter((event) => event.formType && event.filedAt)
    .sort((left, right) => (
      (right.filedAt?.getTime() ?? 0) - (left.filedAt?.getTime() ?? 0)
    ))[0];
  const timely8K = catalystEvents.some((event) => (
    event.formType === "8-K"
    && event.dataQuality === "good"
    && event.filedAt
    && isTimelySec8K(event.filedAt, time)
  ));
  const missingSegments = [...new Set(symbols.flatMap(
    (symbol) => symbol.marketWindowSettlement.missingSegments,
  ))];
  const complete = symbols.length === 5
    && symbols.every((symbol) => symbol.marketWindowSettlement.complete);
  const windowFresh = complete
    && symbols.every((symbol) => symbol.marketFeedState === "streaming");
  const alertReady = symbols.some((symbol) => opportunities.get(symbol.symbol)?.alertReady === true);

  return {
    time,
    scanId: snapshot.scanId,
    cycle: snapshot.marketWindowSettlement.settledAt,
    marketFeedState: snapshot.marketFeedState,
    windowFresh,
    complete,
    missingSegments,
    alertReady,
    alertState: alertReady ? "ALERT READY" : "ALERT GATED",
    catalystSourceState: secStatus?.readiness ?? "unavailable",
    timely8K,
    timely8KRuleVersion: SEC_8K_TIMELINESS_RULE_VERSION,
    latestSecFiling: latestSecEvent
      ? {
          form: latestSecEvent.formType,
          filedAt: latestSecEvent.filedAt,
        }
      : "NONE",
    symbols: symbols.map((symbol) => ({
      symbol: symbol.symbol,
      marketFeedState: symbol.marketFeedState,
      windowFresh: symbol.marketFeedState === "streaming"
        && symbol.marketWindowSettlement.complete,
      complete: symbol.marketWindowSettlement.complete,
      missingSegments: symbol.marketWindowSettlement.missingSegments,
      alertReady: opportunities.get(symbol.symbol)?.alertReady === true,
      alertState: opportunities.get(symbol.symbol)?.alertReady === true
        ? "ALERT READY"
        : "ALERT GATED",
    })),
  };
}

export class ScanRecorder {
  private readonly recordedScanIds = new Set<string>();
  private writeQueue = Promise.resolve();
  private listener: ((snapshot: RadarStatus) => void) | null = null;

  constructor(private readonly logDirectory = defaultLogDirectory()) {}

  start(source: {
    on(event: "status", listener: (snapshot: RadarStatus) => void): unknown;
  }): void {
    if (this.listener) return;
    this.listener = (snapshot) => this.record(snapshot);
    source.on("status", this.listener);
  }

  stop(source: {
    off(event: "status", listener: (snapshot: RadarStatus) => void): unknown;
  }): void {
    if (!this.listener) return;
    source.off("status", this.listener);
    this.listener = null;
  }

  record(snapshot: RadarStatus, time = new Date()): void {
    if (!snapshot.scanId || !snapshot.marketWindowSettlement.settledAt) return;
    if (this.recordedScanIds.has(snapshot.scanId)) return;
    this.recordedScanIds.add(snapshot.scanId);
    const path = join(this.logDirectory, `alpha-radar-scans-${pacificCalendarDate(time)}.jsonl`);
    const line = `${JSON.stringify(buildScanRecord(snapshot, time))}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(this.logDirectory, { recursive: true });
        await appendFile(path, line, { encoding: "utf8", flag: "a" });
      })
      .catch((error) => {
        logger.warn({ error, path, scanId: snapshot.scanId }, "Append-only scan recording failed");
      });
  }

  flush(): Promise<void> {
    return this.writeQueue;
  }
}

export const scanRecorder = new ScanRecorder();