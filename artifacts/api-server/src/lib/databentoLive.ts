import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addAlphaRadarDynamics,
  calculateAlphaRadar,
  createEmptyAlphaRadar,
  type AlphaRadarHistoryPoint,
  type AlphaRadarScanMode,
  type AlphaRadarSnapshot,
} from "./alphaRadar";
import {
  marketEventIsFresh,
  marketFeedStateFor,
  shouldResetAnalysisWindow,
  type MarketFeedState,
} from "./marketFeed";
import { logger } from "./logger";

export type RadarConnectionState =
  | "not_configured"
  | "connecting"
  | "connected"
  | "streaming"
  | "error"
  | "stopped";

export type RadarReconnectState = "idle" | "scheduled" | "reconnecting" | "exhausted";
export type RadarFreshness = "fresh" | "stale" | "insufficient" | "quiet";
export type RadarSignal = {
  score: number | null;
  dataTimestamp: Date | null;
  freshness: RadarFreshness;
  detail: string;
};
export type RadarSnapshot = {
  score: number | null;
  status: "neutral" | "watch" | "breakout_setup" | "data_stale" | "insufficient";
  dataTimestamp: Date | null;
  freshness: RadarFreshness;
  sampleCount: number;
  windowSeconds: number;
  momentum: RadarSignal & { changePercent: number | null };
  volumeIntensity: RadarSignal & {
    recentVolume: number | null;
    baselineVolume: number | null;
    ratio: number | null;
  };
  pressure: RadarSignal & {
    buyVolume: number | null;
    sellVolume: number | null;
    classifiedTrades: number;
  };
  spread: RadarSignal & {
    spread: number | null;
    spreadBps: number | null;
  };
  activityFlags: Array<{
    type: "elevated_volume" | "elevated_trades" | "wide_spread" | "unbalanced_pressure" | "quiet";
    label: string;
    detail: string;
  }>;
};

export type RadarStatus = {
  configured: boolean;
  connectionState: RadarConnectionState;
  marketFeedState: MarketFeedState;
  provider: string;
  dataset: string;
  symbol: string;
  startedAt: Date | null;
  lastUpdatedAt: Date | null;
  lastHeartbeatAt: Date | null;
  reconnectState: RadarReconnectState;
  reconnectAttempt: number;
  nextReconnectAt: Date | null;
  alphaRadar: AlphaRadarSnapshot;
  error: string | null;
  market: {
    latestPrice: number | null;
    bidPrice: number | null;
    askPrice: number | null;
    bidSize: number | null;
    askSize: number | null;
    lastTradeSize: number | null;
    sessionVolume: number | null;
    lastTradeAt: Date | null;
  };
  recentTrades: Array<{
    price: number;
    size: number;
    timestamp: Date;
    side: string | null;
  }>;
  radar: RadarSnapshot;
  streams: Array<{
    schema: "mbp-1" | "ohlcv-1s";
    state: "waiting" | "receiving" | "error";
    eventCount: number;
    lastEventAt: Date | null;
  }>;
};

type BridgeEvent =
  | { type: "ready" }
  | {
      type: "mbp";
      timestamp: string;
      bidPrice: number | null;
      askPrice: number | null;
      bidSize: number | null;
      askSize: number | null;
      trade:
        | {
            price: number;
            size: number;
            timestamp: string;
            side: string | null;
          }
        | null;
    }
  | { type: "ohlcv"; timestamp: string; close: number | null; volume: number | null }
  | { type: "error"; message: string };

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(currentDir, "databento_live_bridge.py");
const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 30_000;
const ROLLING_WINDOW_MS = 5 * 60 * 1_000;
const RECENT_WINDOW_MS = 60 * 1_000;
const MAX_QUOTE_OBSERVATIONS = 2;
const MAX_TRADE_BUCKETS = Math.ceil(ROLLING_WINDOW_MS / 1_000) + 1;
const STALE_AFTER_MS = 15_000;
const QUIET_AFTER_MS = 60_000;
const MAX_EVENT_FUTURE_DRIFT_MS = 5_000;
const MIN_MOMENTUM_COVERAGE_MS = 5_000;
const MIN_BASELINE_COVERAGE_MS = 2 * RECENT_WINDOW_MS;
const MAX_ALPHA_OBSERVATIONS = 2_000;
const NORMAL_SCAN_INTERVAL_MS = 5_000;
const PRE_OPEN_SCAN_INTERVAL_MS = 3_000;
const OPENING_SCAN_INTERVAL_MS = 1_000;
const EVENT_SCAN_MIN_GAP_MS = 750;
const ALPHA_HISTORY_WINDOW_MS = 90_000;
const RAPID_MIDPOINT_CHANGE_PERCENT = 0.03;
const SPREAD_CHANGE_BPS = 1;
const DEPTH_PRESSURE_CHANGE_PERCENT = 20;
const VOLUME_SPIKE_MULTIPLIER = 3;

type QuoteObservation = {
  timestamp: Date;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
};

type TradeObservation = {
  timestamp: Date;
  price: number;
  size: number;
  side: string | null;
};
type BarObservation = {
  timestamp: Date;
  close: number | null;
  volume: number | null;
};
type TradeBucket = {
  firstTimestamp: Date;
  timestamp: Date;
  firstPrice: number;
  lastPrice: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  classifiedTrades: number;
  lastClassifiedTimestamp: Date | null;
};

type AlphaScanProfile = {
  scanMode: AlphaRadarScanMode;
  scanIntervalMs: number;
};

function redactMessage(message: string): string {
  const key = process.env.DATABENTO_API_KEY;
  const withoutKey = key ? message.replaceAll(key, "[redacted]") : message;
  return withoutKey.replace(/db-[a-z0-9_-]{16,}/gi, "[redacted]").slice(0, 320);
}

function blankStatus(): RadarStatus {
  const configured = Boolean(process.env.DATABENTO_API_KEY);
  return {
    configured,
    connectionState: configured ? "stopped" : "not_configured",
    marketFeedState: "offline",
    provider: "Databento",
    dataset: "EQUS.MINI",
    symbol: "NVDA",
    startedAt: null,
    lastUpdatedAt: null,
    lastHeartbeatAt: null,
    reconnectState: "idle",
    reconnectAttempt: 0,
    nextReconnectAt: null,
    alphaRadar: createEmptyAlphaRadar(new Date()),
    error: configured ? null : "DATABENTO_API_KEY is not configured.",
    market: {
      latestPrice: null,
      bidPrice: null,
      askPrice: null,
      bidSize: null,
      askSize: null,
      lastTradeSize: null,
      sessionVolume: null,
      lastTradeAt: null,
    },
    recentTrades: [],
    radar: blankRadarSnapshot(),
    streams: [
      { schema: "mbp-1", state: "waiting", eventCount: 0, lastEventAt: null },
      { schema: "ohlcv-1s", state: "waiting", eventCount: 0, lastEventAt: null },
    ],
  };
}

function blankSignal(detail: string): RadarSignal {
  return {
    score: null,
    dataTimestamp: null,
    freshness: "insufficient",
    detail,
  };
}

function blankRadarSnapshot(): RadarSnapshot {
  return {
    score: null,
    status: "insufficient",
    dataTimestamp: null,
    freshness: "insufficient",
    sampleCount: 0,
    windowSeconds: 60,
    momentum: { ...blankSignal("Waiting for enough price observations."), changePercent: null },
    volumeIntensity: {
      ...blankSignal("Waiting for enough trades to compare recent activity."),
      recentVolume: null,
      baselineVolume: null,
      ratio: null,
    },
    pressure: {
      ...blankSignal("Waiting for trades with a classified aggressor side."),
      buyVolume: null,
      sellVolume: null,
      classifiedTrades: 0,
    },
    spread: {
      ...blankSignal("Waiting for bid and ask observations."),
      spread: null,
      spreadBps: null,
    },
    activityFlags: [],
  };
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function freshnessFor(timestamp: Date | null, now: Date, hasEnoughData: boolean): RadarFreshness {
  if (!hasEnoughData || !timestamp) return "insufficient";
  const age = now.getTime() - timestamp.getTime();
  if (age > QUIET_AFTER_MS) return "quiet";
  if (age > STALE_AFTER_MS) return "stale";
  return "fresh";
}

function observedAt(value: string, now: Date): Date | null {
  const timestamp = new Date(value);
  const milliseconds = timestamp.getTime();
  if (
    Number.isNaN(milliseconds) ||
    milliseconds > now.getTime() + MAX_EVENT_FUTURE_DRIFT_MS ||
    milliseconds < now.getTime() - ROLLING_WINDOW_MS
  ) {
    return null;
  }
  return timestamp;
}

function retainObservations<T extends { timestamp: Date }>(observations: T[]): T[] {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  return observations
    .filter((observation) => observation.timestamp.getTime() >= cutoff)
    .slice(-MAX_ALPHA_OBSERVATIONS);
}

export function scanProfileAt(now: Date): AlphaScanProfile {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = valueFor("weekday");
  const minutes = Number(valueFor("hour")) * 60 + Number(valueFor("minute"));
  const isWeekday = weekday !== "Sat" && weekday !== "Sun";

  if (isWeekday && minutes >= 9 * 60 + 25 && minutes < 9 * 60 + 30) {
    return { scanMode: "pre_open", scanIntervalMs: PRE_OPEN_SCAN_INTERVAL_MS };
  }
  if (isWeekday && minutes >= 9 * 60 + 30 && minutes < 10 * 60) {
    return { scanMode: "opening", scanIntervalMs: OPENING_SCAN_INTERVAL_MS };
  }
  return { scanMode: "normal", scanIntervalMs: NORMAL_SCAN_INTERVAL_MS };
}

function quoteMidpoint(quote: QuoteObservation): number | null {
  if (
    quote.bidPrice === null
    || quote.askPrice === null
    || quote.bidPrice <= 0
    || quote.askPrice <= 0
  ) {
    return null;
  }
  return (quote.bidPrice + quote.askPrice) / 2;
}

function quoteSpreadBps(quote: QuoteObservation): number | null {
  const midpoint = quoteMidpoint(quote);
  if (!midpoint || quote.bidPrice === null || quote.askPrice === null) return null;
  return ((quote.askPrice - quote.bidPrice) / midpoint) * 10_000;
}

function quoteDepthPressure(quote: QuoteObservation): number | null {
  if (quote.bidSize === null || quote.askSize === null) return null;
  const total = quote.bidSize + quote.askSize;
  return total > 0 ? ((quote.bidSize - quote.askSize) / total) * 100 : null;
}

export class DatabentoLiveService extends EventEmitter {
  private child: ChildProcess | null = null;
  private outputBuffer = "";
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private status = blankStatus();
  private quotes: QuoteObservation[] = [];
  private trades: TradeObservation[] = [];
  private bars: BarObservation[] = [];
  private quoteWindow: QuoteObservation[] = [];
  private tradeBuckets = new Map<number, TradeBucket>();
  private analysisWindowNeedsReset = false;
  private analysisWindowStartedAt: Date | null = null;
  private scanSchedulerActive = false;
  private lastAlphaScanAt: Date | null = null;
  private alphaHistory: AlphaRadarHistoryPoint[] = [];
  private pendingScanReason = "scheduled_scan";
  private pendingScanEventTriggered = false;

  getStatus(): RadarStatus {
    const now = new Date();
    const marketFeedState = this.marketFeedStateAt(now);
    const alphaRadar =
      marketFeedState === "streaming"
        ? this.status.alphaRadar
        : addAlphaRadarDynamics(
          calculateAlphaRadar({
            now,
            connectionState: "stopped",
            quotes: this.quotes,
            trades: this.trades,
            bars: this.bars,
          }),
          this.alphaHistory,
          {
            lastScannedAt: now,
            scanIntervalMs: scanProfileAt(now).scanIntervalMs,
            scanMode: scanProfileAt(now).scanMode,
            triggerReason: "freshness_safety_check",
            eventTriggered: false,
          },
        );
    return {
      ...this.status,
      marketFeedState,
      alphaRadar,
      radar: this.calculateRadar(now),
    };
  }

  start(): RadarStatus {
    return this.launch(false);
  }

  stop(): RadarStatus {
    this.stopping = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.clearScanTimer();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.resetObservations();
    this.status = {
      ...this.status,
      connectionState: "stopped",
      reconnectState: "idle",
      reconnectAttempt: 0,
      nextReconnectAt: null,
      error: null,
      radar: blankRadarSnapshot(),
      streams: this.status.streams.map((stream) => ({ ...stream, state: "waiting" as const })),
    };
    this.analysisWindowNeedsReset = false;
    this.scanSchedulerActive = false;
    this.publish();
    return this.getStatus();
  }

  private launch(isReconnect: boolean): RadarStatus {
    if (this.child || this.status.connectionState === "connecting") {
      return this.status;
    }

    if (!process.env.DATABENTO_API_KEY) {
      this.clearReconnectTimer();
      this.clearHeartbeatTimer();
      this.status = { ...blankStatus() };
      this.publish();
      return this.status;
    }

    this.stopping = false;
    this.clearReconnectTimer();
    const now = new Date();
    if (!isReconnect) {
      this.resetObservations();
      this.analysisWindowNeedsReset = false;
    } else {
      this.analysisWindowNeedsReset = true;
    }
    this.status = isReconnect
      ? {
          ...this.status,
          configured: true,
          connectionState: "connecting",
          lastHeartbeatAt: now,
          reconnectState: "reconnecting",
          nextReconnectAt: null,
          error: null,
          streams: this.status.streams.map((stream) => ({ ...stream, state: "waiting" as const })),
        }
      : {
          ...blankStatus(),
          configured: true,
          connectionState: "connecting",
          startedAt: now,
          lastHeartbeatAt: now,
          error: null,
        };
    this.startHeartbeat();
    this.startScanScheduler();
    this.publish();

    const child = spawn("python3", ["-u", bridgePath], {
      env: {
        ...process.env,
        RADAR_SYMBOL: this.status.symbol,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.consumeOutput(chunk.toString());
    });
    child.stderr?.on("data", () => {
      // The bridge intentionally does not write raw diagnostics to the public API.
      // If it does, keep the bytes out of logs and present a generic connection error.
    });
    child.on("error", () => {
      if (this.child === child) {
        this.child = null;
      }
      this.fail("Unable to launch the Databento live bridge.", true);
    });
    child.on("close", (code) => {
      if (this.child === child) {
        this.child = null;
      }
      if (!this.stopping && !this.reconnectTimer) {
        this.fail(
          this.status.error ??
            (code === 0
              ? "The Databento live bridge stopped unexpectedly."
              : "The Databento live bridge exited before streaming data."),
          true,
        );
      }
    });

    return this.getStatus();
  }

  private consumeOutput(chunk: string): void {
    this.outputBuffer += chunk;
    const lines = this.outputBuffer.split("\n");
    this.outputBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as BridgeEvent;
        this.applyEvent(event);
      } catch {
        this.fail("The Databento bridge returned an unreadable status update.");
      }
    }
  }

  private applyEvent(event: BridgeEvent): void {
    const now = new Date();
    if (event.type === "ready") {
      this.status = {
        ...this.status,
        connectionState: "connected",
        error: null,
        lastHeartbeatAt: now,
        reconnectState: "idle",
        reconnectAttempt: 0,
        nextReconnectAt: null,
      };
      this.publish();
      return;
    }

    if (event.type === "error") {
      this.fail(redactMessage(event.message));
      return;
    }
    const eventTimestamp = observedAt(event.timestamp, now);
    if (!eventTimestamp) {
      return;
    }
    const resetRequired =
      this.analysisWindowNeedsReset
      || shouldResetAnalysisWindow(
        this.status.connectionState,
        this.status.lastUpdatedAt,
        now,
      );
    if (resetRequired) {
      if (!marketEventIsFresh(eventTimestamp, now)) {
        return;
      }
      this.resetObservations();
      this.analysisWindowNeedsReset = false;
      this.analysisWindowStartedAt = eventTimestamp;
    } else if (this.analysisWindowStartedAt === null) {
      if (!marketEventIsFresh(eventTimestamp, now)) {
        return;
      }
      this.analysisWindowStartedAt = eventTimestamp;
    } else if (eventTimestamp.getTime() < this.analysisWindowStartedAt.getTime()) {
      return;
    }

    const streams = this.status.streams.map((stream) =>
      stream.schema === (event.type === "mbp" ? "mbp-1" : "ohlcv-1s")
        ? {
            ...stream,
            state: "receiving" as const,
            eventCount: stream.eventCount + 1,
            lastEventAt: eventTimestamp,
          }
        : stream,
    );
    let scanReason = "market_event";
    let eventTriggered = false;

    if (event.type === "mbp") {
      const previousQuote = this.quotes.at(-1) ?? null;
      const quote = {
        timestamp: eventTimestamp,
        bidPrice: event.bidPrice,
        askPrice: event.askPrice,
        bidSize: event.bidSize,
        askSize: event.askSize,
      };
      const quoteTrigger = this.quoteScanTrigger(previousQuote, quote);
      if (quoteTrigger) {
        scanReason = quoteTrigger;
        eventTriggered = true;
      }
      this.recordQuote(quote);
      const trade = event.trade
        ? (() => {
            const tradeTimestamp = observedAt(event.trade.timestamp, now);
            return tradeTimestamp
              && marketEventIsFresh(tradeTimestamp, now)
              && this.analysisWindowStartedAt !== null
              && tradeTimestamp.getTime() >= this.analysisWindowStartedAt.getTime()
              ? {
                  price: event.trade.price,
                  size: event.trade.size,
                  timestamp: tradeTimestamp,
                  side: event.trade.side,
                }
              : null;
          })()
        : null;
      if (trade) {
        const volumeTriggered = this.volumeScanTrigger(trade.timestamp, trade.size);
        this.recordTrade(trade);
        if (volumeTriggered && !quoteTrigger) {
          scanReason = "volume_spike";
          eventTriggered = true;
        }
      }
      this.trimWindows(now);
      this.status = {
        ...this.status,
        connectionState: "streaming",
        error: null,
        lastUpdatedAt:
          this.status.lastUpdatedAt
          && this.status.lastUpdatedAt.getTime() > eventTimestamp.getTime()
            ? this.status.lastUpdatedAt
            : eventTimestamp,
        lastHeartbeatAt: now,
        streams,
        market: {
          ...this.status.market,
          latestPrice: trade?.price ?? this.status.market.latestPrice,
          bidPrice: event.bidPrice,
          askPrice: event.askPrice,
          bidSize: event.bidSize,
          askSize: event.askSize,
          lastTradeSize: trade?.size ?? this.status.market.lastTradeSize,
          lastTradeAt: trade?.timestamp ?? this.status.market.lastTradeAt,
        },
        recentTrades: trade ? [trade, ...this.status.recentTrades].slice(0, 12) : this.status.recentTrades,
      };
    } else {
      const volumeTriggered = this.barVolumeScanTrigger(eventTimestamp, event.volume ?? 0);
      this.recordBar({
        timestamp: eventTimestamp,
        close: event.close,
        volume: event.volume,
      });
      this.status = {
        ...this.status,
        connectionState: "streaming",
        error: null,
        lastUpdatedAt:
          this.status.lastUpdatedAt
          && this.status.lastUpdatedAt.getTime() > eventTimestamp.getTime()
            ? this.status.lastUpdatedAt
            : eventTimestamp,
        lastHeartbeatAt: now,
        streams,
        market: {
          ...this.status.market,
          latestPrice: event.close ?? this.status.market.latestPrice,
          sessionVolume:
            event.volume === null
              ? this.status.market.sessionVolume
              : (this.status.market.sessionVolume ?? 0) + event.volume,
          lastTradeAt: eventTimestamp,
        },
      };
      if (volumeTriggered) {
        scanReason = "volume_spike";
        eventTriggered = true;
      }
    }
    this.requestAlphaScan(scanReason, eventTriggered);
  }

  private fail(message: string, shouldReconnect = false): void {
    this.analysisWindowNeedsReset = true;
    this.status = {
      ...this.status,
      connectionState: "error",
      error: redactMessage(message),
      lastHeartbeatAt: new Date(),
      streams: this.status.streams.map((stream) => ({ ...stream, state: "error" as const })),
    };
    logger.warn({ reason: this.status.error }, "Databento live stream is unavailable");
    if (shouldReconnect) {
      this.scheduleReconnect();
    } else {
      this.publish();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer || !process.env.DATABENTO_API_KEY) {
      this.publish();
      return;
    }

    const reconnectAttempt = this.status.reconnectAttempt + 1;
    if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      this.status = {
        ...this.status,
        reconnectState: "exhausted",
        nextReconnectAt: null,
        error: `${this.status.error ?? "Databento live stream is unavailable."} Automatic reconnect paused after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
      };
      this.publish();
      return;
    }

    const delay = Math.min(1_000 * 2 ** (reconnectAttempt - 1), MAX_RECONNECT_DELAY_MS);
    this.status = {
      ...this.status,
      reconnectState: "scheduled",
      reconnectAttempt,
      nextReconnectAt: new Date(Date.now() + delay),
    };
    this.publish();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopping) {
        this.launch(true);
      }
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.status.connectionState === "stopped" || this.status.connectionState === "not_configured") {
        return;
      }
      this.status = {
        ...this.status,
        lastHeartbeatAt: new Date(),
        radar: this.calculateRadar(new Date()),
      };
      this.publish();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startScanScheduler(): void {
    this.scanSchedulerActive = true;
    this.runAlphaScan("stream_started", false);
    this.scheduleNextScan();
  }

  private clearScanTimer(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  private scheduleNextScan(delayMs?: number): void {
    if (!this.scanSchedulerActive) return;
    this.clearScanTimer();
    const profile = scanProfileAt(new Date());
    const delay = delayMs ?? profile.scanIntervalMs;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      const reason = this.pendingScanReason;
      const eventTriggered = this.pendingScanEventTriggered;
      this.pendingScanReason = "scheduled_scan";
      this.pendingScanEventTriggered = false;
      this.runAlphaScan(reason, eventTriggered);
      this.scheduleNextScan();
    }, delay);
  }

  private requestAlphaScan(reason: string, eventTriggered: boolean): void {
    if (!this.scanSchedulerActive) {
      this.runAlphaScan(reason, eventTriggered);
      return;
    }
    const now = new Date();
    const lastScanMs = this.lastAlphaScanAt?.getTime() ?? 0;
    const elapsedMs = now.getTime() - lastScanMs;
    if (!eventTriggered) {
      return;
    }
    this.pendingScanReason = reason;
    this.pendingScanEventTriggered = true;
    if (!this.lastAlphaScanAt || elapsedMs >= EVENT_SCAN_MIN_GAP_MS) {
      this.pendingScanReason = "scheduled_scan";
      this.pendingScanEventTriggered = false;
      this.runAlphaScan(reason, true);
      this.scheduleNextScan();
      return;
    }
    this.scheduleNextScan(Math.max(1, EVENT_SCAN_MIN_GAP_MS - elapsedMs));
  }

  private runAlphaScan(triggerReason: string, eventTriggered: boolean): void {
    const now = new Date();
    const profile = scanProfileAt(now);
    const calculated = calculateAlphaRadar({
      now,
      connectionState: this.status.connectionState,
      quotes: this.quotes,
      trades: this.trades,
      bars: this.bars,
    });
    const alphaRadar = addAlphaRadarDynamics(calculated, this.alphaHistory, {
      lastScannedAt: now,
      scanIntervalMs: profile.scanIntervalMs,
      scanMode: profile.scanMode,
      triggerReason,
      eventTriggered,
    });
    if (
      alphaRadar.scoreState === "available"
      && alphaRadar.dataQuality === "good"
      && alphaRadar.score !== null
      && alphaRadar.momentum.score !== null
      && alphaRadar.volumeIntensity.score !== null
      && alphaRadar.orderFlowPressure.score !== null
    ) {
      this.alphaHistory = [
        ...this.alphaHistory,
        {
          generatedAt: now,
          score: alphaRadar.score,
          momentumScore: alphaRadar.momentum.score,
          volumeScore: alphaRadar.volumeIntensity.score,
          orderFlowScore: alphaRadar.orderFlowPressure.score,
        },
      ].filter((point) => point.generatedAt.getTime() >= now.getTime() - ALPHA_HISTORY_WINDOW_MS);
    } else {
      this.alphaHistory = [];
    }
    this.lastAlphaScanAt = now;
    this.status = {
      ...this.status,
      alphaRadar,
      radar: this.calculateRadar(now),
    };
    this.publish();
  }

  private quoteScanTrigger(previous: QuoteObservation | null, current: QuoteObservation): string | null {
    if (!previous) return null;
    const previousMidpoint = quoteMidpoint(previous);
    const currentMidpoint = quoteMidpoint(current);
    if (previousMidpoint && currentMidpoint) {
      const changePercent = Math.abs(((currentMidpoint - previousMidpoint) / previousMidpoint) * 100);
      if (changePercent >= RAPID_MIDPOINT_CHANGE_PERCENT) return "rapid_midpoint_change";
    }
    const previousSpread = quoteSpreadBps(previous);
    const currentSpread = quoteSpreadBps(current);
    if (
      previousSpread !== null
      && currentSpread !== null
      && Math.abs(currentSpread - previousSpread) >= SPREAD_CHANGE_BPS
    ) {
      return "spread_shift";
    }
    const previousPressure = quoteDepthPressure(previous);
    const currentPressure = quoteDepthPressure(current);
    if (
      previousPressure !== null
      && currentPressure !== null
      && Math.abs(currentPressure - previousPressure) >= DEPTH_PRESSURE_CHANGE_PERCENT
    ) {
      return "order_flow_shift";
    }
    return null;
  }

  private volumeScanTrigger(timestamp: Date, volume: number): boolean {
    if (volume <= 0) return false;
    const priorVolume = this.trades
      .filter((trade) => trade.timestamp.getTime() < timestamp.getTime())
      .filter((trade) => trade.timestamp.getTime() >= timestamp.getTime() - 30_000)
      .map((trade) => trade.size);
    const average = priorVolume.length > 0
      ? priorVolume.reduce((total, value) => total + value, 0) / priorVolume.length
      : 0;
    return average > 0 && volume >= average * VOLUME_SPIKE_MULTIPLIER;
  }

  private barVolumeScanTrigger(timestamp: Date, volume: number): boolean {
    if (volume <= 0) return false;
    const priorVolume = this.bars
      .filter((bar) => bar.timestamp.getTime() < timestamp.getTime())
      .filter((bar) => bar.timestamp.getTime() >= timestamp.getTime() - 30_000)
      .map((bar) => bar.volume ?? 0)
      .filter((value) => value > 0);
    const average = priorVolume.length > 0
      ? priorVolume.reduce((total, value) => total + value, 0) / priorVolume.length
      : 0;
    return average > 0 && volume >= average * VOLUME_SPIKE_MULTIPLIER;
  }

  private publish(): void {
    this.emit("status", this.getStatus());
  }

  private recordQuote(quote: QuoteObservation): void {
    this.quotes = retainObservations([...this.quotes, quote]);
    this.quoteWindow = [...this.quoteWindow, quote]
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
      .slice(0, MAX_QUOTE_OBSERVATIONS);
  }

  private recordTrade(trade: TradeObservation): void {
    this.trades = retainObservations([...this.trades, trade]);
    const bucketKey = Math.floor(trade.timestamp.getTime() / 1_000) * 1_000;
    const current = this.tradeBuckets.get(bucketKey);
    if (!current) {
      this.tradeBuckets.set(bucketKey, {
        firstTimestamp: trade.timestamp,
        timestamp: trade.timestamp,
        firstPrice: trade.price,
        lastPrice: trade.price,
        volume: trade.size,
        buyVolume: trade.side === "B" ? trade.size : 0,
        sellVolume: trade.side === "A" ? trade.size : 0,
        tradeCount: 1,
        classifiedTrades: trade.side === "B" || trade.side === "A" ? 1 : 0,
        lastClassifiedTimestamp: trade.side === "B" || trade.side === "A" ? trade.timestamp : null,
      });
      return;
    }

    current.volume += trade.size;
    current.tradeCount += 1;
    if (trade.side === "B") {
      current.buyVolume += trade.size;
      current.classifiedTrades += 1;
      if (
        !current.lastClassifiedTimestamp ||
        trade.timestamp.getTime() >= current.lastClassifiedTimestamp.getTime()
      ) {
        current.lastClassifiedTimestamp = trade.timestamp;
      }
    } else if (trade.side === "A") {
      current.sellVolume += trade.size;
      current.classifiedTrades += 1;
      if (
        !current.lastClassifiedTimestamp ||
        trade.timestamp.getTime() >= current.lastClassifiedTimestamp.getTime()
      ) {
        current.lastClassifiedTimestamp = trade.timestamp;
      }
    }
    if (trade.timestamp.getTime() < current.firstTimestamp.getTime()) {
      current.firstTimestamp = trade.timestamp;
      current.firstPrice = trade.price;
    }
    if (trade.timestamp.getTime() >= current.timestamp.getTime()) {
      current.timestamp = trade.timestamp;
      current.lastPrice = trade.price;
    }
  }

  private recordBar(bar: BarObservation): void {
    this.bars = retainObservations([...this.bars, bar]);
  }

  private resetObservations(): void {
    this.quotes = [];
    this.trades = [];
    this.bars = [];
    this.quoteWindow = [];
    this.tradeBuckets.clear();
    this.analysisWindowStartedAt = null;
    this.alphaHistory = [];
    this.lastAlphaScanAt = null;
    this.status = {
      ...this.status,
      alphaRadar: createEmptyAlphaRadar(new Date()),
    };
  }

  private marketFeedStateAt(now: Date): MarketFeedState {
    const derived = marketFeedStateFor(
      this.status.connectionState,
      this.status.lastUpdatedAt,
      now,
    );
    return this.analysisWindowNeedsReset && derived === "streaming"
      ? "stale"
      : derived;
  }

  private trimWindows(now: Date): void {
    const cutoff = now.getTime() - ROLLING_WINDOW_MS;
    this.quoteWindow = this.quoteWindow
      .filter((quote) => quote.timestamp.getTime() >= cutoff)
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
      .slice(0, MAX_QUOTE_OBSERVATIONS);
    for (const [bucketKey, bucket] of this.tradeBuckets) {
      if (bucket.timestamp.getTime() < cutoff) {
        this.tradeBuckets.delete(bucketKey);
      }
    }
    if (this.tradeBuckets.size > MAX_TRADE_BUCKETS) {
      const oldestBucketKeys = [...this.tradeBuckets.keys()]
        .sort((left, right) => left - right)
        .slice(0, this.tradeBuckets.size - MAX_TRADE_BUCKETS);
      oldestBucketKeys.forEach((bucketKey) => this.tradeBuckets.delete(bucketKey));
    }
  }

  private calculateRadar(now: Date): RadarSnapshot {
    this.trimWindows(now);
    const marketFeedState = this.marketFeedStateAt(now);
    const scoringAllowed =
      this.status.connectionState === "streaming"
      && marketFeedState === "streaming";
    const bucketsByTime = [...this.tradeBuckets.values()].sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
    const quotesByTime = [...this.quoteWindow].sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
    const latestTrade = bucketsByTime.at(-1) ?? null;
    const latestQuote = quotesByTime.at(-1) ?? null;
    const latestTimestamp =
      [latestTrade?.timestamp, latestQuote?.timestamp]
        .filter((timestamp): timestamp is Date => Boolean(timestamp))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const recentCutoff = now.getTime() - RECENT_WINDOW_MS;
    const recentBuckets = bucketsByTime.filter((bucket) => bucket.timestamp.getTime() >= recentCutoff);
    const baselineBuckets = bucketsByTime.filter(
      (bucket) =>
        bucket.timestamp.getTime() < recentCutoff &&
        bucket.timestamp.getTime() >= now.getTime() - 5 * RECENT_WINDOW_MS,
    );
    const recentTradeCount = recentBuckets.reduce((total, bucket) => total + bucket.tradeCount, 0);
    const baselineTradeCount = baselineBuckets.reduce((total, bucket) => total + bucket.tradeCount, 0);
    const sampleCount =
      this.quoteWindow.length + bucketsByTime.reduce((total, bucket) => total + bucket.tradeCount, 0);
    const overallFreshness = freshnessFor(latestTimestamp, now, sampleCount >= 3);

    const prices = recentBuckets.filter((bucket) => bucket.firstPrice > 0 && bucket.lastPrice > 0);
    const newestPrice = prices.at(-1)?.lastPrice ?? null;
    const oldestRecentPrice = prices[0]?.firstPrice ?? null;
    const momentumCoverage =
      prices.length >= 2 ? prices.at(-1)!.timestamp.getTime() - prices[0]!.firstTimestamp.getTime() : 0;
    const changePercent =
      newestPrice !== null &&
      oldestRecentPrice !== null &&
      oldestRecentPrice > 0 &&
      momentumCoverage >= MIN_MOMENTUM_COVERAGE_MS
        ? round(((newestPrice - oldestRecentPrice) / oldestRecentPrice) * 100, 4)
        : null;
    const rawMomentumScore = changePercent === null ? null : clamp(50 + (changePercent / 0.5) * 50);
    const momentumTimestamp = prices.at(-1)?.timestamp ?? null;
    const momentumFreshness = freshnessFor(
      momentumTimestamp,
      now,
      prices.length >= 2 && momentumCoverage >= MIN_MOMENTUM_COVERAGE_MS,
    );
    const candidateMomentumScore =
      scoringAllowed && momentumFreshness === "fresh" ? rawMomentumScore : null;

    const recentVolume = recentBuckets.reduce((total, bucket) => total + bucket.volume, 0);
    const baselineCoverage =
      baselineBuckets.length >= 2
        ? baselineBuckets.at(-1)!.timestamp.getTime() - baselineBuckets[0]!.firstTimestamp.getTime()
        : 0;
    const rawBaselineVolume =
      baselineCoverage >= MIN_BASELINE_COVERAGE_MS
        ? baselineBuckets.reduce((total, bucket) => total + bucket.volume, 0) / (baselineCoverage / RECENT_WINDOW_MS)
        : null;
    const baselineVolume = rawBaselineVolume === null ? null : round(rawBaselineVolume, 2);
    const baselineTradeRate =
      baselineCoverage >= MIN_BASELINE_COVERAGE_MS
        ? baselineTradeCount / (baselineCoverage / RECENT_WINDOW_MS)
        : null;
    const volumeRatio =
      baselineVolume !== null && baselineVolume > 0 ? round(recentVolume / baselineVolume, 3) : null;
    const rawVolumeScore = volumeRatio === null ? null : clamp(((volumeRatio - 0.5) / 2.5) * 100);
    const volumeTimestamp = recentBuckets.at(-1)?.timestamp ?? null;
    const volumeFreshness = freshnessFor(volumeTimestamp, now, recentTradeCount >= 2);
    const candidateVolumeScore =
      scoringAllowed && volumeFreshness === "fresh" ? rawVolumeScore : null;

    const buyVolume = recentBuckets.reduce((total, bucket) => total + bucket.buyVolume, 0);
    const sellVolume = recentBuckets.reduce((total, bucket) => total + bucket.sellVolume, 0);
    const classifiedTrades = recentBuckets.reduce((total, bucket) => total + bucket.classifiedTrades, 0);
    const classifiedVolume = buyVolume + sellVolume;
    const rawPressureScore =
      classifiedVolume > 0 ? round((buyVolume / classifiedVolume) * 100, 2) : null;
    const pressureTimestamp =
      recentBuckets
        .map((bucket) => bucket.lastClassifiedTimestamp)
        .filter((timestamp): timestamp is Date => timestamp !== null)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const pressureFreshness = freshnessFor(pressureTimestamp, now, classifiedTrades >= 2);
    const candidatePressureScore =
      scoringAllowed && pressureFreshness === "fresh" ? rawPressureScore : null;

    const quote = latestQuote;
    const spread =
      quote?.bidPrice !== null &&
      quote?.askPrice !== null &&
      quote?.bidPrice !== undefined &&
      quote?.askPrice !== undefined &&
      quote.askPrice >= quote.bidPrice
        ? round(quote.askPrice - quote.bidPrice, 4)
        : null;
    const midpoint =
      quote?.bidPrice !== null &&
      quote?.askPrice !== null &&
      quote?.bidPrice !== undefined &&
      quote?.askPrice !== undefined
        ? (quote.bidPrice + quote.askPrice) / 2
        : null;
    const spreadBps =
      spread !== null && midpoint && midpoint > 0 ? round((spread / midpoint) * 10_000, 3) : null;
    const rawSpreadScore = spreadBps === null ? null : clamp(100 - spreadBps * 20);
    const spreadTimestamp = quote?.timestamp ?? null;
    const spreadFreshness = freshnessFor(spreadTimestamp, now, spread !== null);
    const candidateSpreadScore =
      scoringAllowed && spreadFreshness === "fresh" ? rawSpreadScore : null;

    const components = [
      { score: candidateMomentumScore, weight: 0.3 },
      { score: candidateVolumeScore, weight: 0.25 },
      { score: candidatePressureScore, weight: 0.25 },
      { score: candidateSpreadScore, weight: 0.2 },
    ].filter((component): component is { score: number; weight: number } => component.score !== null);
    const score =
      components.length >= 2
        ? Math.round(components.reduce((total, component) => total + component.score * component.weight, 0) /
            components.reduce((total, component) => total + component.weight, 0))
        : null;
    const hasEnoughData = sampleCount >= 3 && components.length === 4;
    const snapshotScoreEligible =
      scoringAllowed && hasEnoughData && overallFreshness === "fresh";
    const momentumScore = snapshotScoreEligible ? candidateMomentumScore : null;
    const volumeScore = snapshotScoreEligible ? candidateVolumeScore : null;
    const pressureScore = snapshotScoreEligible ? candidatePressureScore : null;
    const spreadScore = snapshotScoreEligible ? candidateSpreadScore : null;
    const finalScore = snapshotScoreEligible ? score : null;
    const status =
      finalScore === null
        ? latestTimestamp !== null
          && (
            !scoringAllowed
            || overallFreshness === "stale"
            || overallFreshness === "quiet"
          )
          ? "data_stale"
          : "insufficient"
        : finalScore >= 70 && (volumeScore ?? 0) >= 60 && (momentumScore ?? 50) >= 55
        ? "breakout_setup"
        : finalScore >= 55
          ? "watch"
          : "neutral";

    const activityFlags: RadarSnapshot["activityFlags"] = [];
    if (snapshotScoreEligible && volumeRatio !== null && volumeRatio >= 2) {
      activityFlags.push({
        type: "elevated_volume",
        label: "Elevated trade volume",
        detail: `Recent 60s volume is ${volumeRatio.toFixed(1)}× the prior-window average.`,
      });
    }
    if (
      snapshotScoreEligible &&
      baselineCoverage >= MIN_BASELINE_COVERAGE_MS &&
      recentTradeCount >= 2 &&
      baselineTradeRate !== null &&
      recentTradeCount >= baselineTradeRate * 2
    ) {
      activityFlags.push({
        type: "elevated_trades",
        label: "Higher trade count",
        detail: `${recentTradeCount} trades arrived in 60 seconds versus ${baselineTradeRate.toFixed(1)} per minute across the comparison window.`,
      });
    }
    if (snapshotScoreEligible && spreadBps !== null && spreadBps >= 10) {
      activityFlags.push({
        type: "wide_spread",
        label: "Wider quoted spread",
        detail: `The latest quoted spread is ${spreadBps.toFixed(1)} basis points.`,
      });
    }
    if (
      snapshotScoreEligible
      && pressureScore !== null
      && Math.abs(pressureScore - 50) >= 25
    ) {
      activityFlags.push({
        type: "unbalanced_pressure",
        label: "One-sided classified flow",
        detail: `${pressureScore >= 50 ? "Buy" : "Sell"}-classified volume is ${Math.max(pressureScore, 100 - pressureScore).toFixed(0)}% of classified volume.`,
      });
    }
    return {
      score: finalScore,
      status,
      dataTimestamp: latestTimestamp,
      freshness: overallFreshness,
      sampleCount,
      windowSeconds: 60,
      momentum: {
        score: momentumScore,
        changePercent,
        dataTimestamp: momentumTimestamp,
        freshness: momentumFreshness,
        detail:
          changePercent === null
            ? "Need two recent trade prices at least 5 seconds apart."
            : `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% over the recent price window.`,
      },
      volumeIntensity: {
        score: volumeScore,
        recentVolume: recentTradeCount > 0 ? recentVolume : null,
        baselineVolume,
        ratio: volumeRatio,
        dataTimestamp: volumeTimestamp,
        freshness: volumeFreshness,
        detail:
          volumeRatio === null
            ? "Need recent activity and at least two minutes of comparison coverage."
            : `${volumeRatio.toFixed(1)}× recent volume versus the comparison average.`,
      },
      pressure: {
        score: pressureScore,
        buyVolume: classifiedVolume > 0 ? buyVolume : null,
        sellVolume: classifiedVolume > 0 ? sellVolume : null,
        classifiedTrades,
        dataTimestamp: pressureTimestamp,
        freshness: pressureFreshness,
        detail:
          pressureScore === null
            ? "Trade side was not available for enough observations."
            : `${pressureScore.toFixed(0)}% buy-classified volume / ${(100 - pressureScore).toFixed(0)}% sell-classified.`,
      },
      spread: {
        score: spreadScore,
        spread,
        spreadBps,
        dataTimestamp: spreadTimestamp,
        freshness: spreadFreshness,
        detail:
          spreadBps === null
            ? "Need a valid bid and ask."
            : `${spread?.toFixed(2)} wide (${spreadBps.toFixed(1)} bps).`,
      },
      activityFlags,
    };
  }
}

export const databentoLive = new DatabentoLiveService();