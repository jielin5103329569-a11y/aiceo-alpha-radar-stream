import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addAlphaRadarDynamics,
  appendSignalHistoryEntry,
  calculateAlphaRadar,
  createEmptyAlphaRadar,
  updatePreBreakoutDetection,
  type AlphaRadarHistoryPoint,
  type AlphaRadarScanMode,
  type AlphaRadarSignalHistoryEntry,
  type AlphaRadarSnapshot,
  type PreBreakoutStateMachine,
} from "./alphaRadar";
import {
  marketEventIsFresh,
  marketFeedStateFor,
  shouldResetAnalysisWindow,
  type MarketFeedState,
} from "./marketFeed";
import { logger } from "./logger";
import {
  marketUniverse,
  normalizeReferenceSymbol,
  type MarketUniverseSummary,
} from "./marketUniverse";
import {
  buildOpportunityCenter,
  type CatalystRadarSnapshot,
  type OpportunityCenterSnapshot,
} from "./catalystRadar";
import { signalValidation } from "./signalValidation";
import {
  SHADOW_MODEL_VERSION,
  SHADOW_SCAN_PROFILE,
  SHADOW_SCAN_WINDOW,
  SHADOW_STRATEGY_VERSION,
  shadowCohortKey,
  evaluateShadowPreBreakout,
} from "./shadowLearningCore";
import { shadowLearning } from "./shadowLearning";

export type RadarConnectionState =
  | "not_configured"
  | "connecting"
  | "connected"
  | "streaming"
  | "error"
  | "stopped";

export type RadarReconnectState = "idle" | "scheduled" | "reconnecting" | "exhausted";
export type RadarFreshness = "fresh" | "stale" | "insufficient" | "quiet";
export type ProtectedScanSchedulerState = "inactive" | "scheduled" | "delayed";
export type ProtectedScanMarketDataState = "fresh" | "stale" | "offline" | "insufficient";
export type ProtectedScanDegradation =
  | "ready"
  | "offline"
  | "stale_market_data"
  | "scheduler_inactive"
  | "scheduler_delayed"
  | "awaiting_live_event"
  | "insufficient_data";

/**
 * Runtime health of one protected-symbol scanner. A scheduled timer, an HTTP
 * transport heartbeat, and a historical scan are never live market evidence.
 */
export type ProtectedScanHealth = {
  schedulerState: ProtectedScanSchedulerState;
  scanMode: AlphaRadarScanMode;
  scanIntervalMs: number;
  lastScanAt: Date | null;
  lastScanAgeMs: number | null;
  nextScanAt: Date | null;
  scanLagMs: number | null;
  lastMarketEventAt: Date | null;
  lastMarketEventAgeMs: number | null;
  marketDataState: ProtectedScanMarketDataState;
  marketDataGateReady: boolean;
  degradation: ProtectedScanDegradation;
  reason: string;
};
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

export type LiveIngestionEvent = {
  symbol: string;
  schema: "mbp-1" | "ohlcv-1s";
  eventType: "quote" | "trade" | "ohlcv_bar";
  eventTimestamp: Date;
  receiveTimestamp: Date | null;
  ingestedAt: Date;
  price: number | null;
  size: number | null;
  enteredScoringWindow: boolean;
};

export type LiveIngestionDiagnostics = {
  subscription: {
    dataset: string;
    symbol: string;
    symbolType: "raw_symbol";
    schemas: Array<"mbp-1" | "ohlcv-1s">;
    acceptedRecordTypes: string[];
  };
  marketSession: {
    timezone: "America/New_York";
    phase: "pre_market" | "regular" | "after_hours" | "closed";
    filterApplied: false;
    detail: string;
  };
  recentMarketEvents: LiveIngestionEvent[];
  verifiedMarketEventCount: number;
  currentWindowMarketEventCount: number;
  lastMarketEventAt: Date | null;
  lastMarketEventReceivedAt: Date | null;
  lastMarketEventAgeMs: number | null;
  windowStartedAt: Date | null;
  lastWindowEntryAt: Date | null;
  freshnessCounters: {
    quotes: number;
    trades: number;
    prices: number;
    volume: number;
  };
  enteredScoringWindow: boolean;
  acceptanceState:
    | "offline"
    | "awaiting_live_event"
    | "window_building"
    | "scoring_eligible"
    | "stale"
    | "insufficient_sample";
  conditions: {
    subscriptionVerified: boolean;
    realMarketEventReceived: boolean;
    enteredScoringWindow: boolean;
    quoteFresh: boolean;
    tradeFresh: boolean;
    priceFresh: boolean;
    volumeFresh: boolean;
    scoringEligible: boolean;
    triggerEvidenceAvailable: boolean;
  };
  triggerEvidence: {
    eventTriggered: boolean;
    triggerReason: string;
    scanAt: Date | null;
    sourceEventAt: Date | null;
    sourceEventType: LiveIngestionEvent["eventType"] | null;
    sourceReceiveAt: Date | null;
    evidenceCount: number;
    satisfiedEvidence: string[];
    missingEvidence: string[];
  };
  scoringStatus: {
    scoreState: AlphaRadarSnapshot["scoreState"];
    status: AlphaRadarSnapshot["status"];
    score: number | null;
    freshness: AlphaRadarSnapshot["momentum"]["freshness"];
    dataQuality: AlphaRadarSnapshot["dataQuality"];
    gateReason: string;
  };
  reason: string;
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
  signalHistory: AlphaRadarSignalHistoryEntry[];
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
  liveIngestion: LiveIngestionDiagnostics;
  scanHealth: ProtectedScanHealth;
  symbolRadars?: RadarSymbolStatus[];
  alphaRanking?: AlphaRadarRankingSnapshot;
  preBreakoutLeader?: {
    symbol: string;
    state: AlphaRadarSnapshot["preBreakout"]["state"];
    confirmationStatus: AlphaRadarSnapshot["preBreakout"]["confirmation"]["status"];
    alphaVelocity: number | null;
  } | null;
  marketUniverse?: MarketUniverseSummary;
  focusedScans?: FocusedScanSnapshot;
  catalystRadar?: CatalystRadarSnapshot;
  opportunityCenter?: OpportunityCenterSnapshot;
};

export type RadarSymbolStatus = {
  symbol: string;
  connectionState: RadarConnectionState;
  marketFeedState: MarketFeedState;
  lastUpdatedAt: Date | null;
  alphaRadar: AlphaRadarSnapshot;
  signalHistory: AlphaRadarSignalHistoryEntry[];
  market: RadarStatus["market"];
  liveIngestion: LiveIngestionDiagnostics;
  scanHealth: ProtectedScanHealth;
  /** Per-symbol stream states — required for fail-closed stream-receiving gate. */
  streams: RadarStatus["streams"];
  error: string | null;
};

export type DatabentoAuthorizationState = "unavailable" | "unverified" | "available" | "blocked";
export type FocusedScanState = "unavailable" | "blocked" | "ready" | "scanning";
export type FocusedCandidateState = "admitted" | "rejected" | "cooling_down" | "evicted";

export type VerifiedMarketLeader = {
  symbol: string;
  observedAt: Date;
  source: "databento_live";
  schema: "mbp-1" | "ohlcv-1s";
  subscriptionVerified: boolean;
  completeMarketFields: boolean;
  fresh: boolean;
  minimumLiquiditySatisfied: boolean;
  independentEvidenceCount: number;
};

export type FocusedScanCandidate = {
  symbol: string;
  state: FocusedCandidateState;
  reason: string;
  observedAt: Date | null;
  independentEvidenceCount: number;
  updatedAt: Date;
};

export type FocusedScanSnapshot = {
  state: FocusedScanState;
  reason: string;
  authorization: {
    state: DatabentoAuthorizationState;
    reason: string;
    verifiedAt: Date | null;
  };
  reference: {
    available: boolean;
    reason: string;
    eligibleCount: number;
    freshness: MarketUniverseSummary["freshness"];
    dataQuality: MarketUniverseSummary["dataQuality"];
  };
  leaderEvidence: {
    available: boolean;
    reason: string;
  };
  capacity: {
    maximum: number;
    active: number;
    available: number;
  };
  activeScans: Array<{
    symbol: string;
    admittedAt: Date;
    observedAt: Date;
    independentEvidenceCount: number;
    connectionState: RadarConnectionState;
    marketFeedState: MarketFeedState;
    dataFresh: boolean;
    reason: string;
  }>;
  candidates: FocusedScanCandidate[];
};

export type AlphaRankingEligibility = "ranked" | "building" | "ineligible";
export type AlphaRankingTrajectory = "strengthening" | "stable" | "weakening" | "unavailable";
export type AlphaRankingOrderStatus = "stable" | "pending";

export type AlphaRadarRankingEntry = {
  symbol: string;
  rank: number | null;
  eligibility: AlphaRankingEligibility;
  orderStatus: AlphaRankingOrderStatus | null;
  rankingScore: number | null;
  factorContributions: AlphaRadarRankingFactorContributions | null;
  alphaScore: number | null;
  detectionState: AlphaRadarSnapshot["preBreakout"]["state"];
  confirmationStatus: AlphaRadarSnapshot["preBreakout"]["confirmation"]["status"];
  alphaVelocity: number | null;
  confidence: number;
  trajectory: AlphaRankingTrajectory;
  reason: string;
};

export type AlphaRadarRankingFactorContributions = {
  alphaScore: number;
  alphaVelocity: number;
  componentAcceleration: number;
  componentAccelerationAverage: number;
  signalTrajectory: number;
};

export type AlphaRadarRankingSnapshot = {
  generatedAt: Date;
  entries: AlphaRadarRankingEntry[];
  leaderSymbol: string | null;
  reorderPending: boolean;
  pendingObservationCount: number;
  requiredObservationCount: number;
};

export type AlphaRadarRankingMachine = {
  order: string[];
  pendingOrder: string[] | null;
  pendingObservationCount: number;
  lastInputSignature: string | null;
};

type BridgeEvent =
  | { type: "ready" }
  | {
      type: "mbp";
      source: "databento_live";
      schema: "mbp-1";
      timestamp: string;
      receivedAt: string | null;
      ingestedAt: string;
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
  | {
      type: "ohlcv";
      source: "databento_live";
      schema: "ohlcv-1s";
      timestamp: string;
      receivedAt: string | null;
      ingestedAt: string;
      close: number | null;
      volume: number | null;
    }
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

function blankStatus(symbol = "NVDA"): RadarStatus {
  const configured = Boolean(process.env.DATABENTO_API_KEY);
  const emptyAlphaRadar = createEmptyAlphaRadar(new Date(), symbol);
  return {
    configured,
    connectionState: configured ? "stopped" : "not_configured",
    marketFeedState: "offline",
    provider: "Databento",
    dataset: "EQUS.MINI",
    symbol,
    startedAt: null,
    lastUpdatedAt: null,
    lastHeartbeatAt: null,
    reconnectState: "idle",
    reconnectAttempt: 0,
    nextReconnectAt: null,
    alphaRadar: {
      ...emptyAlphaRadar,
      scan: {
        ...emptyAlphaRadar.scan,
        lastScannedAt: null,
      },
    },
    signalHistory: [],
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
    liveIngestion: blankLiveIngestionDiagnostics(symbol, configured),
    scanHealth: {
      schedulerState: "inactive",
      scanMode: "normal",
      scanIntervalMs: NORMAL_SCAN_INTERVAL_MS,
      lastScanAt: null,
      lastScanAgeMs: null,
      nextScanAt: null,
      scanLagMs: null,
      lastMarketEventAt: null,
      lastMarketEventAgeMs: null,
      marketDataState: "offline",
      marketDataGateReady: false,
      degradation: "offline",
      reason: "Scanner is inactive. No scheduled scan, transport state, or cached value is treated as live market evidence.",
    },
  };
}

function blankLiveIngestionDiagnostics(symbol: string, configured: boolean): LiveIngestionDiagnostics {
  return {
    subscription: {
      dataset: "EQUS.MINI",
      symbol,
      symbolType: "raw_symbol",
      schemas: ["mbp-1", "ohlcv-1s"],
      acceptedRecordTypes: ["Mbp* record", "Ohlcv* record"],
    },
    marketSession: marketSessionAt(new Date()),
    recentMarketEvents: [],
    verifiedMarketEventCount: 0,
    currentWindowMarketEventCount: 0,
    lastMarketEventAt: null,
    lastMarketEventReceivedAt: null,
    lastMarketEventAgeMs: null,
    windowStartedAt: null,
    lastWindowEntryAt: null,
    freshnessCounters: {
      quotes: 0,
      trades: 0,
      prices: 0,
      volume: 0,
    },
    enteredScoringWindow: false,
    acceptanceState: configured ? "awaiting_live_event" : "offline",
    conditions: {
      subscriptionVerified: configured,
      realMarketEventReceived: false,
      enteredScoringWindow: false,
      quoteFresh: false,
      tradeFresh: false,
      priceFresh: false,
      volumeFresh: false,
      scoringEligible: false,
      triggerEvidenceAvailable: false,
    },
    triggerEvidence: {
      eventTriggered: false,
      triggerReason: "awaiting_live_event",
      scanAt: null,
      sourceEventAt: null,
      sourceEventType: null,
      sourceReceiveAt: null,
      evidenceCount: 0,
      satisfiedEvidence: [],
      missingEvidence: [],
    },
    scoringStatus: {
      scoreState: "insufficient",
      status: null,
      score: null,
      freshness: "missing",
      dataQuality: "missing",
      gateReason: "feed_not_streaming",
    },
    reason: "Awaiting a real Databento Mbp or Ohlcv market record; transport, SSE, cache, and system messages are excluded.",
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

function marketSessionAt(now: Date): LiveIngestionDiagnostics["marketSession"] {
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
  const phase =
    !isWeekday || minutes < 4 * 60 || minutes >= 20 * 60
      ? "closed"
      : minutes < 9 * 60 + 30
        ? "pre_market"
        : minutes < 16 * 60
          ? "regular"
          : "after_hours";
  return {
    timezone: "America/New_York",
    phase,
    filterApplied: false,
    detail:
      "Session is displayed for acceptance context only. Real Databento Mbp and Ohlcv records are not filtered by session; transport and interval/system messages are never counted.",
  };
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
  constructor(private readonly configuredSymbol = "NVDA") {
    super();
    this.status = blankStatus(configuredSymbol);
  }

  private child: ChildProcess | null = null;
  private outputBuffer = "";
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private status: RadarStatus;
  private quotes: QuoteObservation[] = [];
  private trades: TradeObservation[] = [];
  private bars: BarObservation[] = [];
  private quoteWindow: QuoteObservation[] = [];
  private tradeBuckets = new Map<number, TradeBucket>();
  private analysisWindowNeedsReset = false;
  private analysisWindowStartedAt: Date | null = null;
  private scanSchedulerActive = false;
  private lastAlphaScanAt: Date | null = null;
  private nextScheduledScanAt: Date | null = null;
  private scanScheduleGeneration = 0;
  private scanInProgress = false;
  private alphaHistory: AlphaRadarHistoryPoint[] = [];
  private signalHistory: AlphaRadarSignalHistoryEntry[] = [];
  private preBreakoutMachine: PreBreakoutStateMachine = {
    state: "unavailable",
    pendingState: null,
    pendingCount: 0,
    lastTransitionAt: null,
    lastTransitionEvidenceCount: 0,
    lastTransitionReasons: [],
    confirmationPersistenceScans: 0,
  };
  private pendingScanReason = "scheduled_scan";
  private pendingScanEventTriggered = false;

  getStatus(): RadarStatus {
    const now = new Date();
    const marketFeedState = this.marketFeedStateAt(now);
    let alphaRadar = this.status.alphaRadar;
    if (marketFeedState !== "streaming") {
      const calculatedOfflineSnapshot = addAlphaRadarDynamics(
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
      const invalidSnapshot = {
        ...calculatedOfflineSnapshot,
        scan: {
          ...calculatedOfflineSnapshot.scan,
          lastScannedAt: this.lastAlphaScanAt,
        },
      };
      const invalidDetection = updatePreBreakoutDetection(
        invalidSnapshot,
        this.preBreakoutMachine,
        now,
      );
      alphaRadar = invalidDetection.snapshot;
      this.preBreakoutMachine = invalidDetection.machine;
      this.recordSignalHistory(
        this.status.alphaRadar,
        alphaRadar,
        now,
        "Live confirmation evidence became unavailable.",
      );
      this.status = { ...this.status, alphaRadar };
    }
    const liveIngestion = this.currentLiveIngestionDiagnostics(alphaRadar, marketFeedState, now);
    const scanHealth = this.currentScanHealth(alphaRadar, marketFeedState, liveIngestion, now);
    return {
      ...this.status,
      marketFeedState,
      alphaRadar,
      signalHistory: [...this.signalHistory],
      radar: this.calculateRadar(now),
      liveIngestion,
      scanHealth,
    };
  }

  private currentScanHealth(
    alphaRadar: AlphaRadarSnapshot,
    marketFeedState: MarketFeedState,
    liveIngestion: LiveIngestionDiagnostics,
    now: Date,
  ): ProtectedScanHealth {
    const profile = scanProfileAt(now);
    const lastScanAt = this.lastAlphaScanAt;
    const lastScanAgeMs = lastScanAt === null
      ? null
      : Math.max(0, now.getTime() - lastScanAt.getTime());
    const scanLagMs = this.nextScheduledScanAt === null
      ? null
      : Math.max(0, now.getTime() - this.nextScheduledScanAt.getTime());
    const schedulerState: ProtectedScanSchedulerState =
      !this.scanSchedulerActive
        ? "inactive"
        : scanLagMs !== null && scanLagMs > 0
          ? "delayed"
          : "scheduled";
    const coreComponentsEligible =
      alphaRadar.momentum.scoreEligible
      && alphaRadar.volumeIntensity.scoreEligible
      && alphaRadar.orderFlowPressure.scoreEligible
      && alphaRadar.spread.scoreEligible;
    const verifiedFreshWindow =
      this.status.connectionState === "streaming"
      && marketFeedState === "streaming"
      && liveIngestion.conditions.subscriptionVerified
      && liveIngestion.conditions.realMarketEventReceived
      && liveIngestion.conditions.enteredScoringWindow
      && liveIngestion.conditions.scoringEligible
      && alphaRadar.dataQuality === "good"
      && alphaRadar.score !== null
      && Number.isFinite(alphaRadar.score)
      && alphaRadar.preBreakout.dataFresh
      && coreComponentsEligible;
    const marketDataState: ProtectedScanMarketDataState =
      marketFeedState === "offline"
        ? "offline"
        : !liveIngestion.conditions.realMarketEventReceived
          ? "insufficient"
          : marketFeedState === "stale"
            ? "stale"
            : verifiedFreshWindow
              ? "fresh"
              : "insufficient";
    const marketDataGateReady =
      schedulerState === "scheduled"
      && marketDataState === "fresh";
    const degradation: ProtectedScanDegradation =
      marketDataState === "offline"
        ? "offline"
        : marketDataState === "stale"
          ? "stale_market_data"
          : schedulerState === "inactive"
            ? "scheduler_inactive"
            : schedulerState === "delayed"
              ? "scheduler_delayed"
              : !liveIngestion.conditions.realMarketEventReceived
                ? "awaiting_live_event"
                : !marketDataGateReady
                  ? "insufficient_data"
                  : "ready";
    const reason = {
      ready: "Scheduler is armed and this symbol has a fresh, complete live market-data window. Alert evaluation still requires its separate event-trigger and transition gates.",
      offline: "Feed is offline. Scheduler state, transport heartbeats, cached values, and prior scans cannot claim live market data.",
      scheduler_inactive: "Scanner is not armed. No scan cadence is currently scheduled for this symbol.",
      scheduler_delayed: "The next scheduled scan is overdue. The symbol remains ineligible until the scheduler resumes and every live-data gate passes.",
      stale_market_data: "The last verified market event is outside the freshness window. A scheduled scan does not refresh market evidence.",
      awaiting_live_event: "Scheduler is armed, but no verified Databento market event has reached this symbol's live window.",
      insufficient_data: "Verified live data is incomplete or still rebuilding. Scores and production alerts remain unavailable.",
    }[degradation];
    return {
      schedulerState,
      scanMode: profile.scanMode,
      scanIntervalMs: profile.scanIntervalMs,
      lastScanAt,
      lastScanAgeMs,
      nextScanAt: this.nextScheduledScanAt,
      scanLagMs,
      lastMarketEventAt: liveIngestion.lastMarketEventAt,
      lastMarketEventAgeMs: liveIngestion.lastMarketEventAgeMs,
      marketDataState,
      marketDataGateReady,
      degradation,
      reason,
    };
  }

  private currentLiveIngestionDiagnostics(
    alphaRadar: AlphaRadarSnapshot,
    marketFeedState: MarketFeedState,
    now: Date,
  ): LiveIngestionDiagnostics {
    const stored = this.status.liveIngestion;
    const latestEvent = stored.recentMarketEvents[0] ?? null;
    const lastMarketEventAgeMs = stored.lastMarketEventAt
      ? Math.max(0, now.getTime() - stored.lastMarketEventAt.getTime())
      : null;
    const freshnessCounters = {
      quotes: alphaRadar.diagnostics.fresh_quotes,
      trades: alphaRadar.diagnostics.fresh_trades,
      prices: alphaRadar.diagnostics.fresh_prices,
      volume: alphaRadar.diagnostics.fresh_volume,
    };
    const enteredScoringWindow =
      marketFeedState === "streaming"
      && this.analysisWindowStartedAt !== null
      && stored.currentWindowMarketEventCount > 0;
    const conditions = {
      subscriptionVerified:
        this.status.configured
        && stored.subscription.dataset === "EQUS.MINI"
        && stored.subscription.symbol === this.configuredSymbol
        && stored.subscription.symbolType === "raw_symbol",
      realMarketEventReceived: stored.verifiedMarketEventCount > 0,
      enteredScoringWindow,
      quoteFresh: freshnessCounters.quotes > 0,
      tradeFresh: freshnessCounters.trades > 0,
      priceFresh: freshnessCounters.prices > 0,
      volumeFresh: freshnessCounters.volume > 0,
      scoringEligible: alphaRadar.scoreState === "available",
      triggerEvidenceAvailable: latestEvent !== null && alphaRadar.scan.lastScannedAt !== null,
    };
    const acceptanceState: LiveIngestionDiagnostics["acceptanceState"] =
      marketFeedState === "offline"
        ? "offline"
        : !conditions.realMarketEventReceived
          ? "awaiting_live_event"
          : marketFeedState === "stale"
            ? "stale"
            : conditions.scoringEligible
              ? "scoring_eligible"
              : enteredScoringWindow
                ? "insufficient_sample"
                : "window_building";
    const reason =
      acceptanceState === "offline"
        ? "The live feed is offline. No transport, cache, heartbeat, or stored value can satisfy market-event acceptance."
        : acceptanceState === "awaiting_live_event"
          ? "No eligible Databento Mbp or Ohlcv market record has reached this process. Heartbeats, SSE, cache, simulated data, and interval/system messages are excluded."
          : acceptanceState === "stale"
            ? "The last verified Databento market record is outside the existing 15-second freshness window. Transport and interval/system messages do not extend it."
            : acceptanceState === "scoring_eligible"
              ? "Verified live evidence currently meets the existing scoring gate. This diagnostic records the result; it does not alter scoring."
              : acceptanceState === "insufficient_sample"
                ? "A verified market record entered the active scoring window, but the existing scoring gate still reports Insufficient Sample. No accuracy or score is inferred."
                : "Verified market records are present, but the active scoring window is still rebuilding.";
    return {
      ...stored,
      marketSession: marketSessionAt(now),
      lastMarketEventAgeMs,
      freshnessCounters,
      enteredScoringWindow,
      acceptanceState,
      conditions,
      triggerEvidence: {
        eventTriggered: alphaRadar.scan.eventTriggered,
        triggerReason: alphaRadar.scan.triggerReason,
        scanAt: alphaRadar.scan.lastScannedAt,
        sourceEventAt: latestEvent?.eventTimestamp ?? null,
        sourceEventType: latestEvent?.eventType ?? null,
        sourceReceiveAt: latestEvent?.receiveTimestamp ?? null,
        evidenceCount: alphaRadar.preBreakout.evidenceCount,
        satisfiedEvidence: [...alphaRadar.preBreakout.confirmation.satisfiedEvidence],
        missingEvidence: [...alphaRadar.preBreakout.confirmation.missingEvidence],
      },
      scoringStatus: {
        scoreState: alphaRadar.scoreState,
        status: alphaRadar.status,
        score: alphaRadar.score,
        freshness: alphaRadar.momentum.freshness,
        dataQuality: alphaRadar.dataQuality,
        gateReason: alphaRadar.diagnostics.scoring_gate_reason,
      },
      reason,
      recentMarketEvents: [...stored.recentMarketEvents],
    };
  }

  start(): RadarStatus {
    return this.launch(false);
  }

  stop(): RadarStatus {
    this.stopping = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.stopScanScheduler();
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
      this.status = { ...blankStatus(this.configuredSymbol) };
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
          ...blankStatus(this.configuredSymbol),
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
      this.consumeOutput(child, chunk.toString());
    });
    child.stderr?.on("data", () => {
      // The bridge intentionally does not write raw diagnostics to the public API.
      // If it does, keep the bytes out of logs and present a generic connection error.
    });
    child.on("error", () => {
      if (this.child !== child) return;
      this.child = null;
      this.fail("Unable to launch the Databento live bridge.", true);
    });
    child.on("close", (code) => {
      if (this.child !== child) return;
      this.child = null;
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

  private consumeOutput(child: ChildProcess, chunk: string): void {
    if (this.child !== child) {
      return;
    }
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

  private recordVerifiedMarketEvent(event: LiveIngestionEvent): void {
    const previous = this.status.liveIngestion;
    this.status = {
      ...this.status,
      liveIngestion: {
        ...previous,
        verifiedMarketEventCount: previous.verifiedMarketEventCount + 1,
        currentWindowMarketEventCount:
          previous.currentWindowMarketEventCount + (event.enteredScoringWindow ? 1 : 0),
        lastMarketEventAt: event.eventTimestamp,
        lastMarketEventReceivedAt: event.receiveTimestamp ?? event.ingestedAt,
        windowStartedAt: event.enteredScoringWindow
          ? (this.analysisWindowStartedAt ?? event.eventTimestamp)
          : previous.windowStartedAt,
        lastWindowEntryAt: event.enteredScoringWindow ? event.ingestedAt : previous.lastWindowEntryAt,
        recentMarketEvents: [event, ...previous.recentMarketEvents].slice(0, 12),
      },
    };
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
    if (
      event.source !== "databento_live"
      || (event.type === "mbp" && event.schema !== "mbp-1")
      || (event.type === "ohlcv" && event.schema !== "ohlcv-1s")
    ) {
      return;
    }
    const hasMarketPayload =
      event.type === "mbp"
        ? [
            event.bidPrice,
            event.askPrice,
            event.bidSize,
            event.askSize,
            event.trade?.price ?? null,
            event.trade?.size ?? null,
          ].some((value) => value !== null && Number.isFinite(value))
        : (event.close !== null && Number.isFinite(event.close))
          || (event.volume !== null && Number.isFinite(event.volume));
    if (!hasMarketPayload) {
      return;
    }
    const receiveTimestamp = event.receivedAt ? observedAt(event.receivedAt, now) : null;
    const ingestedAt = observedAt(event.ingestedAt, now) ?? now;
    const liveEvent = {
      symbol: this.configuredSymbol,
      schema: event.schema,
      eventType:
        event.type === "mbp"
          ? event.trade
            ? "trade"
            : "quote"
          : "ohlcv_bar",
      eventTimestamp,
      receiveTimestamp,
      ingestedAt,
      price:
        event.type === "mbp"
          ? event.trade?.price ?? event.bidPrice ?? event.askPrice
          : event.close,
      size: event.type === "mbp" ? event.trade?.size ?? null : event.volume,
    } satisfies Omit<LiveIngestionEvent, "enteredScoringWindow">;
    const resetRequired =
      this.analysisWindowNeedsReset
      || shouldResetAnalysisWindow(
        this.status.connectionState,
        this.status.lastUpdatedAt,
        now,
      );
    if (resetRequired) {
      if (!marketEventIsFresh(eventTimestamp, now)) {
        this.recordVerifiedMarketEvent({ ...liveEvent, enteredScoringWindow: false });
        return;
      }
      this.resetObservations();
      this.analysisWindowNeedsReset = false;
      this.analysisWindowStartedAt = eventTimestamp;
    } else if (this.analysisWindowStartedAt === null) {
      if (!marketEventIsFresh(eventTimestamp, now)) {
        this.recordVerifiedMarketEvent({ ...liveEvent, enteredScoringWindow: false });
        return;
      }
      this.analysisWindowStartedAt = eventTimestamp;
    } else if (eventTimestamp.getTime() < this.analysisWindowStartedAt.getTime()) {
      this.recordVerifiedMarketEvent({ ...liveEvent, enteredScoringWindow: false });
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
    this.recordVerifiedMarketEvent({ ...liveEvent, enteredScoringWindow: true });
    this.requestAlphaScan(scanReason, eventTriggered);
  }

  private fail(message: string, shouldReconnect = false): void {
    this.stopScanScheduler();
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
    this.stopScanScheduler();
    this.scanSchedulerActive = true;
    this.runAlphaScan("stream_started", false);
    this.scheduleNextScan();
  }

  private stopScanScheduler(): void {
    this.scanSchedulerActive = false;
    this.pendingScanReason = "scheduled_scan";
    this.pendingScanEventTriggered = false;
    this.clearScanTimer();
  }

  private clearScanTimer(): void {
    this.scanScheduleGeneration += 1;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.nextScheduledScanAt = null;
  }

  private scheduleNextScan(delayMs?: number): void {
    if (!this.scanSchedulerActive) return;
    this.clearScanTimer();
    const profile = scanProfileAt(new Date());
    const delay = delayMs ?? profile.scanIntervalMs;
    const scheduleGeneration = this.scanScheduleGeneration;
    this.nextScheduledScanAt = new Date(Date.now() + delay);
    this.scanTimer = setTimeout(() => {
      if (!this.scanSchedulerActive || scheduleGeneration !== this.scanScheduleGeneration) {
        return;
      }
      this.scanTimer = null;
      this.nextScheduledScanAt = null;
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
      if (this.status.connectionState === "streaming") {
        this.runAlphaScan(reason, eventTriggered);
      }
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
    // A scheduler tick is activity, not market evidence. Do not record a
    // completed scan while the bridge is still connecting, reconnecting, or
    // otherwise not streaming. The next armed tick will retry after a real
    // market event moves the service into the streaming state.
    if (this.scanInProgress || this.status.connectionState !== "streaming") return;
    this.scanInProgress = true;
    try {
    const now = new Date();
    const profile = scanProfileAt(now);
    const calculated = calculateAlphaRadar({
      now,
      connectionState: this.status.connectionState,
      quotes: this.quotes,
      trades: this.trades,
      bars: this.bars,
    });
    const dynamicSnapshot = addAlphaRadarDynamics(calculated, this.alphaHistory, {
      lastScannedAt: now,
      scanIntervalMs: profile.scanIntervalMs,
      scanMode: profile.scanMode,
      triggerReason,
      eventTriggered,
    });
    const detection = updatePreBreakoutDetection(
      dynamicSnapshot,
      this.preBreakoutMachine,
      now,
    );
    const alphaRadar = detection.snapshot;
    this.preBreakoutMachine = detection.machine;
    const radar = this.calculateRadar(now);
    this.recordSignalHistory(
      this.status.alphaRadar,
      alphaRadar,
      now,
      alphaRadar.preBreakout.confirmation.reason,
      radar,
    );
    if (
      alphaRadar.scoreState === "available"
      && alphaRadar.dataQuality === "good"
      && alphaRadar.score !== null
      && alphaRadar.momentum.score !== null
      && alphaRadar.volumeIntensity.score !== null
      && alphaRadar.orderFlowPressure.score !== null
      && alphaRadar.spread.score !== null
    ) {
      this.alphaHistory = [
        ...this.alphaHistory,
        {
          generatedAt: now,
          score: alphaRadar.score,
          momentumScore: alphaRadar.momentum.score,
          volumeScore: alphaRadar.volumeIntensity.score,
          orderFlowScore: alphaRadar.orderFlowPressure.score,
          spreadScore: alphaRadar.spread.score,
        },
      ].filter((point) => point.generatedAt.getTime() >= now.getTime() - ALPHA_HISTORY_WINDOW_MS);
    } else {
      this.alphaHistory = [];
    }
    this.lastAlphaScanAt = now;
    this.status = {
      ...this.status,
      alphaRadar,
      signalHistory: [...this.signalHistory],
      radar,
    };
    if (
      alphaRadar.preBreakout.dataFresh
      && this.status.market.latestPrice !== null
      && this.status.market.lastTradeAt !== null
      && now.getTime() - this.status.market.lastTradeAt.getTime() <= STALE_AFTER_MS
    ) {
      signalValidation.observePrice(
        this.configuredSymbol,
        this.status.market.latestPrice,
        this.status.market.lastTradeAt,
      );
      shadowLearning.observePrice({
        symbol: this.configuredSymbol,
        observedAt: this.status.market.lastTradeAt,
        price: this.status.market.latestPrice,
        source: "Databento EQUS.MINI live",
        freshness: {
          marketFeedState: this.marketFeedStateAt(now),
          dataQuality: alphaRadar.dataQuality,
          scoreState: alphaRadar.scoreState,
          streaming: this.status.connectionState === "streaming",
          complete: alphaRadar.momentum.available
            && alphaRadar.volumeIntensity.available
            && alphaRadar.orderFlowPressure.available
            && alphaRadar.spread.available,
          eligible: alphaRadar.preBreakout.dataFresh,
        },
      });
    }
    this.publish();
    } finally {
      this.scanInProgress = false;
    }
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
    const now = new Date();
    const previousAlphaRadar = this.status.alphaRadar;
    const unavailableAlphaRadar = createEmptyAlphaRadar(now);
    this.quotes = [];
    this.trades = [];
    this.bars = [];
    this.quoteWindow = [];
    this.tradeBuckets.clear();
    this.analysisWindowStartedAt = null;
    this.alphaHistory = [];
    this.signalHistory = [];
    this.lastAlphaScanAt = null;
    this.preBreakoutMachine = {
      state: "unavailable",
      pendingState: null,
      pendingCount: 0,
      lastTransitionAt: null,
      lastTransitionEvidenceCount: 0,
      lastTransitionReasons: [],
      confirmationPersistenceScans: 0,
    };
    this.recordSignalHistory(
      previousAlphaRadar,
      unavailableAlphaRadar,
      now,
      "The live analysis window was reset; prior confirmation evidence was cleared.",
    );
    this.status = {
      ...this.status,
      alphaRadar: unavailableAlphaRadar,
      signalHistory: [...this.signalHistory],
      liveIngestion: {
        ...this.status.liveIngestion,
        currentWindowMarketEventCount: 0,
        windowStartedAt: null,
      },
    };
  }

  private recordSignalHistory(
    previous: AlphaRadarSnapshot,
    next: AlphaRadarSnapshot,
    occurredAt: Date,
    reason: string,
    radar?: RadarSnapshot,
  ): void {
    const fromState = previous.preBreakout.state;
    const toState = next.preBreakout.state;
    const fromConfirmationStatus = previous.preBreakout.confirmation.status;
    const toConfirmationStatus = next.preBreakout.confirmation.status;
    if (fromState === toState && fromConfirmationStatus === toConfirmationStatus) return;

    const priorLatestEntry = this.signalHistory.at(-1);
    this.signalHistory = appendSignalHistoryEntry(this.signalHistory, {
      occurredAt,
      fromState,
      toState,
      fromConfirmationStatus,
      toConfirmationStatus,
      score: next.score,
      confidence: next.confidence,
      alphaVelocity: next.alphaVelocity.rate30s,
      evidenceCount: next.preBreakout.evidenceCount,
      satisfiedEvidence: [...next.preBreakout.confirmation.satisfiedEvidence],
      missingEvidence: [...next.preBreakout.confirmation.missingEvidence],
      dataFresh: next.preBreakout.dataFresh,
      reason,
    });
    const latestEntry = this.signalHistory.at(-1);
    const entryWasAppended = latestEntry !== priorLatestEntry
      && latestEntry?.occurredAt.getTime() === occurredAt.getTime();
    const persistableStates = new Set([
      "watch",
      "accelerating",
      "pre_breakout",
      "confirmed",
    ]);
    if (
      !entryWasAppended
      || !next.preBreakout.dataFresh
      || !persistableStates.has(toState)
      || this.status.market.latestPrice === null
      || this.status.market.latestPrice <= 0
    ) {
      return;
    }

    const reference = marketUniverse
      .query({ search: this.configuredSymbol, eligibility: "all", limit: 20 })
      .items
      .find((item) => item.symbol === this.configuredSymbol);
    const sectorConfirmation = reference?.sector ? "insufficient" : "unavailable";
    const sectorConfirmationReason = reference?.sector
      ? "A trigger-time sector label exists, but fresh independent peer confirmation is not available."
      : "Trusted trigger-time sector classification and fresh peer confirmation are unavailable.";
    const direction = next.momentum.value === null || next.momentum.value === 0
      ? "neutral"
      : next.momentum.value > 0
        ? "upside"
        : "downside";
    signalValidation.captureSignal({
      symbol: this.configuredSymbol,
      occurredAt,
      fromState,
      state: toState as "watch" | "accelerating" | "pre_breakout" | "confirmed",
      confirmationStatus: toConfirmationStatus,
      signalType: fromState !== toState ? "state_transition" : "confirmation_transition",
      direction,
      triggerPrice: this.status.market.latestPrice,
      alphaScore: next.score,
      signalScore: radar?.score ?? null,
      confidence: next.confidence,
      volumeValue: next.volumeIntensity.value,
      volumeScore: next.volumeIntensity.score,
      velocity30s: next.alphaVelocity.rate30s,
      velocity60s: next.alphaVelocity.rate60s,
      momentumAcceleration: next.changeIndicators.momentumAcceleration,
      volumeAcceleration: next.changeIndicators.volumeAcceleration,
      orderFlowShift: next.changeIndicators.orderFlowShift,
      spreadTightening: next.changeIndicators.spreadTightening,
      sector: reference?.sector ?? null,
      sectorConfirmation,
      sectorConfirmationReason,
      evidenceCount: next.preBreakout.evidenceCount,
      evidenceSummary: next.preBreakout.confirmation.evidence.map((evidence) => ({
        key: evidence.key,
        label: evidence.label,
        satisfied: evidence.satisfied,
        detail: evidence.detail,
      })),
      satisfiedEvidence: [...next.preBreakout.confirmation.satisfiedEvidence],
      missingEvidence: [...next.preBreakout.confirmation.missingEvidence],
      dataFresh: next.preBreakout.dataFresh,
      freshness: {
        marketFeedState: "streaming",
        dataQuality: next.dataQuality,
        scoreState: next.scoreState,
        momentum: next.momentum.freshness,
        volume: next.volumeIntensity.freshness,
        orderFlow: next.orderFlowPressure.freshness,
        spread: next.spread.freshness,
      },
      source: "Databento EQUS.MINI live",
      catalystStatus: "unavailable",
    });
    const shadowCandidate = evaluateShadowPreBreakout({
      strategyVersion: SHADOW_STRATEGY_VERSION,
      scanWindow: SHADOW_SCAN_WINDOW,
      scanProfile: SHADOW_SCAN_PROFILE,
      modelVersion: SHADOW_MODEL_VERSION,
      candidateSource: "fresh-production-snapshot-sidecar",
      signalType: "shadow_pre_breakout",
      symbol: this.configuredSymbol,
      sector: reference?.sector ?? null,
      occurredAt,
      triggerPrice: this.status.market.latestPrice,
      direction,
      state: toState,
      evidenceSnapshot: next.preBreakout.confirmation.evidence.map((evidence) => ({
        key: evidence.key,
        label: evidence.label,
        satisfied: evidence.satisfied,
        detail: evidence.detail,
      })),
      freshnessSnapshot: {
        marketFeedState: this.marketFeedStateAt(occurredAt),
        dataQuality: next.dataQuality,
        scoreState: next.scoreState,
        streaming: this.status.connectionState === "streaming",
        complete: next.momentum.available
          && next.volumeIntensity.available
          && next.orderFlowPressure.available
          && next.spread.available,
        eligible: next.preBreakout.dataFresh,
      },
      inputSummary: {
        alphaScore: next.score,
        confidence: next.confidence,
        velocity30s: next.alphaVelocity.rate30s,
        velocity60s: next.alphaVelocity.rate60s,
        momentumAcceleration: next.changeIndicators.momentumAcceleration,
        volumeAcceleration: next.changeIndicators.volumeAcceleration,
        orderFlowShift: next.changeIndicators.orderFlowShift,
        spreadTightening: next.changeIndicators.spreadTightening,
        evidenceCount: next.preBreakout.evidenceCount,
      },
      cohortKey: shadowCohortKey({
        symbol: this.configuredSymbol,
        occurredAt,
        state: toState,
        sector: reference?.sector ?? null,
      }),
      cohortEligibilitySnapshot: {
        baselineSignalType: "state_transition",
        baselineState: toState,
        matchingWindowSeconds: 60,
        requiredEvidenceKeys: next.preBreakout.confirmation.evidence
          .filter((evidence) => evidence.satisfied)
          .map((evidence) => evidence.key),
        dataFreshRequired: true,
      },
    });
    if (shadowCandidate) void shadowLearning.captureObservation(shadowCandidate);
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

export const MONITORED_SYMBOLS = ["NVDA", "MU", "VRT", "CRDO", "AMD"] as const;

function toSymbolStatus(status: RadarStatus): RadarSymbolStatus {
  return {
    symbol: status.symbol,
    connectionState: status.connectionState,
    marketFeedState: status.marketFeedState,
    lastUpdatedAt: status.lastUpdatedAt,
    alphaRadar: status.alphaRadar,
    signalHistory: status.signalHistory,
    market: status.market,
    liveIngestion: status.liveIngestion,
    scanHealth: status.scanHealth,
    streams: status.streams,
    error: status.error,
  };
}

function preBreakoutRank(state: AlphaRadarSnapshot["preBreakout"]["state"]): number {
  return {
    unavailable: 0,
    watch: 1,
    accelerating: 2,
    pre_breakout: 3,
    confirmed: 4,
  }[state];
}

function confirmationRank(
  status: AlphaRadarSnapshot["preBreakout"]["confirmation"]["status"],
): number {
  return {
    unavailable: 0,
    rejected: 1,
    pending: 2,
    confirmed: 3,
  }[status];
}

const RANKING_CONFIRMATION_OBSERVATIONS = 2;

function clampRanking(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundRanking(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rankingTrajectory(status: RadarSymbolStatus): AlphaRankingTrajectory {
  if (!status.alphaRadar.preBreakout.dataFresh) return "unavailable";
  const freshEntries = status.signalHistory.filter((entry) => entry.dataFresh);
  const first = freshEntries[0];
  if (!first) return "stable";
  const currentStateDelta =
    preBreakoutRank(status.alphaRadar.preBreakout.state) - preBreakoutRank(first.fromState);
  const currentConfirmationDelta =
    confirmationRank(status.alphaRadar.preBreakout.confirmation.status)
    - confirmationRank(first.fromConfirmationStatus);
  const direction = currentStateDelta * 2 + currentConfirmationDelta;
  if (direction > 0) return "strengthening";
  if (direction < 0) return "weakening";
  return "stable";
}

function rankingEligibility(status: RadarSymbolStatus): {
  eligibility: AlphaRankingEligibility;
  reason: string;
} {
  const snapshot = status.alphaRadar;
  if (
    status.connectionState !== "streaming"
    || status.marketFeedState !== "streaming"
    || !snapshot.preBreakout.dataFresh
    || snapshot.scoreState !== "available"
    || snapshot.dataQuality !== "good"
    || snapshot.score === null
    || snapshot.confidence <= 0
  ) {
    return {
      eligibility: "ineligible",
      reason: "No current valid live window is available for ranking.",
    };
  }
  if (snapshot.alphaVelocity.rate30s === null) {
    return {
      eligibility: "building",
      reason: "Fresh score is available; building a 30-second Alpha Velocity window.",
    };
  }
  if (
    [
      snapshot.changeIndicators.momentumAcceleration,
      snapshot.changeIndicators.volumeAcceleration,
      snapshot.changeIndicators.orderFlowShift,
      snapshot.changeIndicators.spreadTightening,
    ].every((value) => value === null)
  ) {
    return {
      eligibility: "building",
      reason: "Fresh score is available; building component acceleration context.",
    };
  }
  return { eligibility: "ranked", reason: "" };
}

function rankingValues(
  status: RadarSymbolStatus,
  trajectory: AlphaRankingTrajectory,
): {
  rankingScore: number;
  factorContributions: AlphaRadarRankingFactorContributions;
} {
  const snapshot = status.alphaRadar;
  const accelerations = [
    snapshot.changeIndicators.momentumAcceleration,
    snapshot.changeIndicators.volumeAcceleration,
    snapshot.changeIndicators.orderFlowShift,
    snapshot.changeIndicators.spreadTightening,
  ].filter((value): value is number => value !== null);
  const accelerationAverage = accelerations.reduce((total, value) => total + value, 0)
    / Math.max(accelerations.length, 1);
  const velocity = snapshot.alphaVelocity.rate30s ?? 0;
  const trajectoryValue = {
    strengthening: 100,
    stable: 50,
    weakening: 10,
    unavailable: 0,
  }[trajectory];
  const factorContributions = {
    alphaScore: roundRanking((snapshot.score ?? 0) * 0.55),
    alphaVelocity: roundRanking(clampRanking(50 + velocity * 2) * 0.2),
    componentAcceleration: roundRanking(
      clampRanking(50 + accelerationAverage * 1.5) * 0.15,
    ),
    componentAccelerationAverage: roundRanking(accelerationAverage),
    signalTrajectory: roundRanking(trajectoryValue * 0.1),
  };
  return {
    rankingScore: roundRanking(
      factorContributions.alphaScore
      + factorContributions.alphaVelocity
      + factorContributions.componentAcceleration
      + factorContributions.signalTrajectory,
    ),
    factorContributions,
  };
}

function rankingReason(
  status: RadarSymbolStatus,
  trajectory: AlphaRankingTrajectory,
  eligibility: AlphaRankingEligibility,
  baseReason: string,
  orderStatus: AlphaRankingOrderStatus | null,
  factorContributions: AlphaRadarRankingFactorContributions | null,
): string {
  if (eligibility !== "ranked") return baseReason;
  const velocity = status.alphaRadar.alphaVelocity.rate30s ?? 0;
  const state = status.alphaRadar.preBreakout.state.replaceAll("_", " ");
  const confirmation = status.alphaRadar.preBreakout.confirmation.status;
  const held = orderStatus === "pending"
    ? " Position is held until another independent scan agrees."
    : "";
  const acceleration = factorContributions?.componentAccelerationAverage ?? 0;
  return `Score ${roundRanking(status.alphaRadar.score ?? 0, 0)}; ${state}; ${confirmation} confirmation; Alpha Velocity ${velocity >= 0 ? "+" : ""}${roundRanking(velocity)}/min; component acceleration ${acceleration >= 0 ? "+" : ""}${roundRanking(acceleration)}/min; ${trajectory} trajectory.${held}`;
}

function rankingInputSignature(symbols: RadarSymbolStatus[]): string {
  return symbols
    .map((status) => {
      const snapshot = status.alphaRadar;
      return [
        status.symbol,
        status.connectionState,
        status.marketFeedState,
        snapshot.scan.lastScannedAt?.toISOString() ?? "never",
        snapshot.score,
        snapshot.alphaVelocity.rate30s,
        snapshot.preBreakout.state,
        snapshot.preBreakout.confirmation.status,
      ].join(":");
    })
    .join("|");
}

function sameOrder(left: string[] | null, right: string[]): boolean {
  return left !== null
    && left.length === right.length
    && left.every((symbol, index) => symbol === right[index]);
}

export function updateAlphaRadarRanking(
  symbols: RadarSymbolStatus[],
  machine: AlphaRadarRankingMachine,
  now: Date,
): { snapshot: AlphaRadarRankingSnapshot; machine: AlphaRadarRankingMachine } {
  const candidates = symbols.map((status) => {
    const readiness = rankingEligibility(status);
    const trajectory = rankingTrajectory(status);
    const values = readiness.eligibility === "ranked"
      ? rankingValues(status, trajectory)
      : null;
    return {
      status,
      eligibility: readiness.eligibility,
      baseReason: readiness.reason,
      trajectory,
      rankingScore: values?.rankingScore ?? null,
      factorContributions: values?.factorContributions ?? null,
    };
  });
  const rawOrder = candidates
    .filter((candidate) => candidate.eligibility === "ranked")
    .sort((left, right) => {
      const scoreDifference = (right.rankingScore ?? Number.NEGATIVE_INFINITY)
        - (left.rankingScore ?? Number.NEGATIVE_INFINITY);
      return scoreDifference !== 0 ? scoreDifference : left.status.symbol.localeCompare(right.status.symbol);
    })
    .map((candidate) => candidate.status.symbol);
  const signature = rankingInputSignature(
    candidates
      .filter((candidate) => candidate.eligibility === "ranked")
      .map((candidate) => candidate.status),
  );
  const previouslyRanked = machine.order.filter((symbol) => rawOrder.includes(symbol));
  const newSymbols = rawOrder.filter((symbol) => !machine.order.includes(symbol));
  const provisionalOrder = [...previouslyRanked, ...newSymbols];
  let nextMachine: AlphaRadarRankingMachine = {
    ...machine,
    lastInputSignature: signature,
  };

  if (machine.order.length === 0) {
    nextMachine = {
      order: rawOrder,
      pendingOrder: null,
      pendingObservationCount: 0,
      lastInputSignature: signature,
    };
  } else if (sameOrder(provisionalOrder, rawOrder)) {
    nextMachine = {
      order: provisionalOrder,
      pendingOrder: null,
      pendingObservationCount: 0,
      lastInputSignature: signature,
    };
  } else if (signature !== machine.lastInputSignature) {
    const pendingObservationCount = sameOrder(machine.pendingOrder, rawOrder)
      ? machine.pendingObservationCount + 1
      : 1;
    if (pendingObservationCount >= RANKING_CONFIRMATION_OBSERVATIONS) {
      nextMachine = {
        order: rawOrder,
        pendingOrder: null,
        pendingObservationCount: 0,
        lastInputSignature: signature,
      };
    } else {
      nextMachine = {
        order: provisionalOrder,
        pendingOrder: rawOrder,
        pendingObservationCount,
        lastInputSignature: signature,
      };
    }
  } else {
    nextMachine = {
      ...machine,
      order: provisionalOrder,
      lastInputSignature: signature,
    };
  }

  const rankBySymbol = new Map(nextMachine.order.map((symbol, index) => [symbol, index + 1]));
  const reorderPending = nextMachine.pendingOrder !== null;
  const rankedEntries = candidates
    .filter((candidate) => candidate.eligibility === "ranked")
    .sort(
      (left, right) =>
        (rankBySymbol.get(left.status.symbol) ?? Number.MAX_SAFE_INTEGER)
        - (rankBySymbol.get(right.status.symbol) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((candidate) => {
      const orderStatus: AlphaRankingOrderStatus = reorderPending ? "pending" : "stable";
      return {
        symbol: candidate.status.symbol,
        rank: rankBySymbol.get(candidate.status.symbol) ?? null,
        eligibility: candidate.eligibility,
        orderStatus,
        rankingScore: candidate.rankingScore,
        factorContributions: candidate.factorContributions,
        alphaScore: candidate.status.alphaRadar.score,
        detectionState: candidate.status.alphaRadar.preBreakout.state,
        confirmationStatus: candidate.status.alphaRadar.preBreakout.confirmation.status,
        alphaVelocity: candidate.status.alphaRadar.alphaVelocity.rate30s,
        confidence: candidate.status.alphaRadar.confidence,
        trajectory: candidate.trajectory,
        reason: rankingReason(
          candidate.status,
          candidate.trajectory,
          candidate.eligibility,
          candidate.baseReason,
          orderStatus,
          candidate.factorContributions,
        ),
      };
    });
  const unavailableEntries = candidates
    .filter((candidate) => candidate.eligibility !== "ranked")
    .map((candidate) => ({
      symbol: candidate.status.symbol,
      rank: null,
      eligibility: candidate.eligibility,
      orderStatus: null,
      rankingScore: null,
      factorContributions: null,
      alphaScore: candidate.status.alphaRadar.score,
      detectionState: candidate.status.alphaRadar.preBreakout.state,
      confirmationStatus: candidate.status.alphaRadar.preBreakout.confirmation.status,
      alphaVelocity: candidate.status.alphaRadar.alphaVelocity.rate30s,
      confidence: candidate.status.alphaRadar.confidence,
      trajectory: candidate.trajectory,
      reason: rankingReason(
        candidate.status,
        candidate.trajectory,
        candidate.eligibility,
        candidate.baseReason,
        null,
        null,
      ),
    }));

  return {
    machine: nextMachine,
    snapshot: {
      generatedAt: now,
      entries: [...rankedEntries, ...unavailableEntries],
      leaderSymbol: rankedEntries[0]?.symbol ?? null,
      reorderPending,
      pendingObservationCount: nextMachine.pendingObservationCount,
      requiredObservationCount: RANKING_CONFIRMATION_OBSERVATIONS,
    },
  };
}

type FocusedScanLiveService = {
  getStatus(): RadarStatus;
  start(): RadarStatus;
  stop(): RadarStatus;
  on(event: "status", listener: () => void): unknown;
};

type ActiveFocusedScan = {
  symbol: string;
  admittedAt: Date;
  leader: VerifiedMarketLeader;
  service: FocusedScanLiveService;
};

export type FocusedScanCoordinatorOptions = {
  referenceUniverse?: Pick<typeof marketUniverse, "query">;
  createService?: (symbol: string) => FocusedScanLiveService;
  apiKeyAvailable?: () => boolean;
  maximumScans?: number;
};

const FOCUSED_SCAN_DEFAULT_CAPACITY = 3;
const FOCUSED_SCAN_CANDIDATE_HISTORY_LIMIT = 12;
const FOCUSED_SCAN_COOLDOWN_MS = 5 * 60_000;
const FOCUSED_SCAN_LEADER_MAX_AGE_MS = 15_000;

/**
 * Keeps optional dynamic bridges separate from the protected five-symbol radar.
 * Candidates arrive only from an internal, verified live-leader source; this
 * coordinator intentionally has no HTTP mutation endpoint.
 */
export class FocusedScanCoordinator extends EventEmitter {
  private readonly referenceUniverse: Pick<typeof marketUniverse, "query">;
  private readonly createService: (symbol: string) => FocusedScanLiveService;
  private readonly apiKeyAvailable: () => boolean;
  private readonly maximumScans: number;
  private readonly active = new Map<string, ActiveFocusedScan>();
  private readonly candidateHistory = new Map<string, FocusedScanCandidate>();
  private readonly cooldowns = new Map<string, Date>();

  constructor(options: FocusedScanCoordinatorOptions = {}) {
    super();
    this.referenceUniverse = options.referenceUniverse ?? marketUniverse;
    this.createService = options.createService ?? ((symbol) => new DatabentoLiveService(symbol));
    this.apiKeyAvailable = options.apiKeyAvailable ?? (() => Boolean(process.env.DATABENTO_API_KEY));
    this.maximumScans = Math.max(
      1,
      Math.min(FOCUSED_SCAN_DEFAULT_CAPACITY, options.maximumScans ?? FOCUSED_SCAN_DEFAULT_CAPACITY),
    );
  }

  getStatus(protectedStatuses: RadarStatus[], now = new Date()): FocusedScanSnapshot {
    const reference = this.referenceStatus();
    const authorization = this.authorizationStatus(protectedStatuses);
    const activeScans = [...this.active.values()]
      .map((scan) => {
        const status = scan.service.getStatus();
        const dataFresh =
          status.connectionState === "streaming"
          && status.marketFeedState === "streaming"
          && status.alphaRadar.preBreakout.dataFresh;
        return {
          symbol: scan.symbol,
          admittedAt: scan.admittedAt,
          observedAt: scan.leader.observedAt,
          independentEvidenceCount: scan.leader.independentEvidenceCount,
          connectionState: status.connectionState,
          marketFeedState: status.marketFeedState,
          dataFresh,
          reason: dataFresh
            ? "Focused bridge has fresh, independently verified market evidence."
            : "Focused bridge is isolated from the protected pool and is not eligible until its own live freshness gate passes.",
        };
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
    const candidates = [...this.candidateHistory.values()]
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, FOCUSED_SCAN_CANDIDATE_HISTORY_LIMIT);
    const leaderEvidenceAvailable = activeScans.length > 0;

    const state: FocusedScanState =
      !reference.available || authorization.state === "unavailable" || authorization.state === "blocked"
        ? "blocked"
        : authorization.state === "unverified"
          ? "unavailable"
          : activeScans.length > 0
            ? "scanning"
            : "unavailable";
    const reason =
      !reference.available
        ? reference.reason
        : authorization.state !== "available"
          ? authorization.reason
          : activeScans.length > 0
            ? `${activeScans.length} focused scan${activeScans.length === 1 ? "" : "s"} run independently of the protected five-symbol pool.`
            : "Automatic focused admission is unavailable because this deployment has no verified Databento market-leader source. Reference data alone never admits a focused scan.";

    return {
      state,
      reason,
      authorization,
      reference,
      leaderEvidence: {
        available: leaderEvidenceAvailable,
        reason: leaderEvidenceAvailable
          ? "At least one internally verified market-leader record is actively routed."
          : "No verified market-leader record is available. Reference-only records, cached values, heartbeats, and synthetic inputs cannot create a focused scan.",
      },
      capacity: {
        maximum: this.maximumScans,
        active: activeScans.length,
        available: Math.max(0, this.maximumScans - activeScans.length),
      },
      activeScans,
      candidates,
    };
  }

  routeVerifiedMarketLeader(
    leader: VerifiedMarketLeader,
    protectedStatuses: RadarStatus[],
    now = new Date(),
  ): FocusedScanCandidate {
    const symbol = normalizeReferenceSymbol(leader.symbol);
    if (!symbol) {
      return this.recordCandidate({
        symbol: String(leader.symbol ?? "").toUpperCase() || "UNKNOWN",
        state: "rejected",
        reason: "Candidate symbol is invalid and cannot be verified against the reference universe.",
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }
    if (MONITORED_SYMBOLS.includes(symbol as (typeof MONITORED_SYMBOLS)[number])) {
      return this.recordCandidate({
        symbol,
        state: "rejected",
        reason: "The protected five-symbol pool is isolated and cannot be routed through focused scans.",
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }

    const reference = this.referenceStatus();
    if (!reference.available) {
      return this.recordCandidate({
        symbol,
        state: "rejected",
        reason: `Reference eligibility is unavailable: ${reference.reason}`,
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }
    const matchingReference = this.referenceUniverse.query({
      search: symbol,
      eligibility: "eligible",
      lifecycle: "active",
      limit: 2,
    }).items.find((item) => item.symbol === symbol);
    if (!matchingReference) {
      return this.recordCandidate({
        symbol,
        state: "rejected",
        reason: "No fresh, verified active common-equity reference record is eligible for this symbol.",
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }

    const authorization = this.authorizationStatus(protectedStatuses);
    if (authorization.state !== "available") {
      return this.recordCandidate({
        symbol,
        state: "rejected",
        reason: `Focused routing is blocked: ${authorization.reason}`,
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }
    if (!this.hasVerifiedLeaderEvidence(leader, now)) {
      return this.recordCandidate({
        symbol,
        state: "rejected",
        reason: "A candidate requires a fresh, complete Databento market record, minimum liquidity, and at least two independent evidence components.",
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }
    if (this.active.has(symbol)) {
      return this.recordCandidate({
        symbol,
        state: "admitted",
        reason: "This eligible candidate is already in the bounded focused-scan pool.",
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }
    const cooldownUntil = this.cooldowns.get(symbol);
    if (cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
      return this.recordCandidate({
        symbol,
        state: "cooling_down",
        reason: `Focused re-admission is delayed until ${cooldownUntil.toISOString()} to prevent candidate churn.`,
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }
    this.cooldowns.delete(symbol);

    if (this.active.size >= this.maximumScans && !this.evictInactiveScan(now)) {
      return this.recordCandidate({
        symbol,
        state: "rejected",
        reason: `Focused-scan capacity is full (${this.maximumScans}); active fresh scans are protected from eviction.`,
        observedAt: leader.observedAt,
        independentEvidenceCount: leader.independentEvidenceCount,
        updatedAt: now,
      });
    }

    const service = this.createService(symbol);
    service.on("status", () => this.emit("status"));
    this.active.set(symbol, { symbol, admittedAt: now, leader: { ...leader, symbol }, service });
    service.start();
    const candidate = this.recordCandidate({
      symbol,
      state: "admitted",
      reason: "Verified reference, Databento authorization, fresh complete market evidence, liquidity, and independent evidence gates passed. The focused bridge remains isolated from protected ranking and scoring.",
      observedAt: leader.observedAt,
      independentEvidenceCount: leader.independentEvidenceCount,
      updatedAt: now,
    });
    this.emit("status");
    return candidate;
  }

  stop(): void {
    this.active.forEach((scan) => scan.service.stop());
    this.active.clear();
    this.emit("status");
  }

  private referenceStatus(): FocusedScanSnapshot["reference"] {
    const summary = this.referenceUniverse.query({ eligibility: "eligible", limit: 1 }).summary;
    const available =
      summary.refreshState === "ready"
      && summary.freshness === "fresh"
      && summary.dataQuality === "good"
      && summary.eligibleCount > 0;
    return {
      available,
      reason: available
        ? "Fresh verified active common-equity reference records are available for candidate eligibility checks."
        : `Reference universe is ${summary.refreshState}/${summary.freshness}/${summary.dataQuality}: ${summary.reason}`,
      eligibleCount: summary.eligibleCount,
      freshness: summary.freshness,
      dataQuality: summary.dataQuality,
    };
  }

  private authorizationStatus(
    protectedStatuses: RadarStatus[],
  ): FocusedScanSnapshot["authorization"] {
    if (!this.apiKeyAvailable()) {
      return {
        state: "unavailable",
        reason: "Databento authorization is unavailable because the server has no configured API key.",
        verifiedAt: null,
      };
    }
    const verified = protectedStatuses.find((status) => (
      status.connectionState === "streaming"
      && status.marketFeedState === "streaming"
      && status.liveIngestion.conditions.subscriptionVerified
    ));
    if (verified) {
      return {
        state: "available",
        reason: "A protected Databento subscription is currently verified by its own live stream.",
        verifiedAt: verified.lastUpdatedAt ?? verified.startedAt,
      };
    }
    const allErrored = protectedStatuses.length > 0
      && protectedStatuses.every((status) => status.connectionState === "error");
    if (allErrored) {
      return {
        state: "blocked",
        reason: "Databento live authorization or subscription capability has not been verified: every protected bridge is currently in an error state.",
        verifiedAt: null,
      };
    }
    return {
      state: "unverified",
      reason: "A Databento API key is configured, but no protected live subscription has yet verified a fresh streaming capability. Focused scans remain unavailable.",
      verifiedAt: null,
    };
  }

  private hasVerifiedLeaderEvidence(leader: VerifiedMarketLeader, now: Date): boolean {
    return leader.source === "databento_live"
      && ["mbp-1", "ohlcv-1s"].includes(leader.schema)
      && leader.subscriptionVerified
      && leader.completeMarketFields
      && leader.fresh
      && leader.minimumLiquiditySatisfied
      && leader.independentEvidenceCount >= 2
      && now.getTime() - leader.observedAt.getTime() >= 0
      && now.getTime() - leader.observedAt.getTime() <= FOCUSED_SCAN_LEADER_MAX_AGE_MS;
  }

  private evictInactiveScan(now: Date): boolean {
    const inactive = [...this.active.values()]
      .map((scan) => ({ scan, status: scan.service.getStatus() }))
      .filter(({ scan, status }) => (
        status.marketFeedState !== "streaming"
        && now.getTime() - scan.admittedAt.getTime() >= FOCUSED_SCAN_COOLDOWN_MS
      ))
      .sort((left, right) => left.scan.admittedAt.getTime() - right.scan.admittedAt.getTime())[0];
    if (!inactive) return false;
    inactive.scan.service.stop();
    this.active.delete(inactive.scan.symbol);
    this.cooldowns.set(
      inactive.scan.symbol,
      new Date(now.getTime() + FOCUSED_SCAN_COOLDOWN_MS),
    );
    this.recordCandidate({
      symbol: inactive.scan.symbol,
      state: "evicted",
      reason: "Evicted only after its isolated live feed became inactive and its minimum focused-scan tenure elapsed.",
      observedAt: inactive.scan.leader.observedAt,
      independentEvidenceCount: inactive.scan.leader.independentEvidenceCount,
      updatedAt: now,
    });
    return true;
  }

  private recordCandidate(candidate: FocusedScanCandidate): FocusedScanCandidate {
    this.candidateHistory.set(candidate.symbol, candidate);
    const overflow = [...this.candidateHistory.values()]
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .slice(0, Math.max(0, this.candidateHistory.size - FOCUSED_SCAN_CANDIDATE_HISTORY_LIMIT));
    overflow.forEach((entry) => this.candidateHistory.delete(entry.symbol));
    return candidate;
  }
}

export class DatabentoUniverseService extends EventEmitter {
  private readonly services = MONITORED_SYMBOLS.map((symbol) => new DatabentoLiveService(symbol));
  private readonly focusedScans = new FocusedScanCoordinator();
  private rankingMachine: AlphaRadarRankingMachine = {
    order: [],
    pendingOrder: null,
    pendingObservationCount: 0,
    lastInputSignature: null,
  };

  constructor() {
    super();
    this.services.forEach((service) => {
      service.on("status", () => this.emit("status", this.getStatus()));
    });
    this.focusedScans.on("status", () => this.emit("status", this.getStatus()));
    marketUniverse.on("status", () => this.emit("status", this.getStatus()));
  }

  getStatus(): RadarStatus {
    const statuses = this.services.map((service) => service.getStatus());
    const primary = statuses.find((status) => status.symbol === "NVDA") ?? statuses[0];
    const symbolRadars = statuses.map(toSymbolStatus);
    const now = new Date();
    const rankingResult = updateAlphaRadarRanking(symbolRadars, this.rankingMachine, now);
    this.rankingMachine = rankingResult.machine;
    const leader = rankingResult.snapshot.leaderSymbol
      ? symbolRadars.find((status) => status.symbol === rankingResult.snapshot.leaderSymbol)
      : null;

    const marketUniverseSnapshot = marketUniverse.getSummary(now);
    const opportunityData = buildOpportunityCenter(
      statuses.map((status) => ({
        symbol: status.symbol,
        alphaRadar: status.alphaRadar,
        marketFeedState: status.marketFeedState,
        scanHealth: status.scanHealth,
        reference: marketUniverse.getSecurity(status.symbol, now),
      })),
      statuses.map((status) => ({
        symbol: status.symbol,
        reference: marketUniverse.getSecurity(status.symbol, now),
      })),
      now,
    );

    return {
      ...primary,
      symbolRadars,
      alphaRanking: rankingResult.snapshot,
      marketUniverse: marketUniverseSnapshot,
      focusedScans: this.focusedScans.getStatus(statuses),
      catalystRadar: opportunityData.catalystRadar,
      opportunityCenter: opportunityData.opportunityCenter,
      preBreakoutLeader: leader
        ? {
            symbol: leader.symbol,
            state: leader.alphaRadar.preBreakout.state,
            confirmationStatus: leader.alphaRadar.preBreakout.confirmation.status,
            alphaVelocity: leader.alphaRadar.alphaVelocity.rate30s,
          }
        : null,
    };
  }

  start(): RadarStatus {
    this.services.forEach((service) => service.start());
    return this.getStatus();
  }

  stop(): RadarStatus {
    this.focusedScans.stop();
    this.services.forEach((service) => service.stop());
    return this.getStatus();
  }

  getFocusedScanStatus(): FocusedScanSnapshot {
    return this.focusedScans.getStatus(this.services.map((service) => service.getStatus()));
  }

  getCatalystRadar(): CatalystRadarSnapshot {
    return this.getStatus().catalystRadar!;
  }

  getOpportunityCenter(): OpportunityCenterSnapshot {
    return this.getStatus().opportunityCenter!;
  }
}

export const databentoLive = new DatabentoUniverseService();