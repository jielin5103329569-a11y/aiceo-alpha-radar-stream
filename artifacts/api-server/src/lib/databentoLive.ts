import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addAlphaRadarDynamics,
  appendSignalHistoryEntry,
  calculateAlphaRadar,
  createEmptyAlphaRadar,
  unavailablePostBreakout,
  updatePostBreakoutMonitoring,
  updatePreBreakoutDetection,
  type AlphaRadarHistoryPoint,
  type AlphaRadarScanMode,
  type AlphaRadarSignalHistoryEntry,
  type AlphaRadarSnapshot,
  type PostBreakoutStateMachine,
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
import { aiIndustryStockPool } from "./aiIndustryStockPool";
import { AI_INDUSTRY_TAXONOMY } from "./aiIndustryTaxonomy";
import {
  buildOpportunityCenter,
  type CatalystRadarSnapshot,
  type OpportunityCenterSnapshot,
} from "./catalystRadar";
import { secEdgarCatalyst } from "./secEdgarCatalyst";
import {
  buildSectorPriority,
  type SectorPrioritySnapshot,
} from "./sectorPriority";
import {
  buildOpeningReadiness,
  type OpeningReadinessSnapshot,
} from "./openingReadiness";
import { signalValidation } from "./signalValidation";
import {
  SHADOW_MODEL_VERSION,
  SHADOW_SCAN_PROFILE,
  SHADOW_SCAN_WINDOW,
  SHADOW_STRATEGY_VERSION,
  shadowCohortKey,
  normalizeSignedPercentFeature,
  evaluateShadowStage,
  evaluateShadowPreBreakout,
} from "./shadowLearningCore";
import { shadowLearning } from "./shadowLearning";
import {
  buildDataGovernanceSnapshot,
  type DataGovernanceSnapshot,
} from "./dataGovernance";

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
export type LiveNetworkState = "healthy" | "degraded" | "blocked";
export type LiveBackpressureState = "normal" | "active" | "blocked";
export type LiveRecoveryState =
  | "not_started"
  | "awaiting_heartbeat"
  | "awaiting_market_event"
  | "rebuilding_window"
  | "running"
  | "reconnecting"
  | "stopped";

/**
 * Observability for the bridge path only. These values never become market
 * evidence: a healthy transport or heartbeat still needs a separate fresh
 * market event and scoring window before it can be alert-ready.
 */
export type LiveNetworkHealth = {
  transportState: "offline" | "connecting" | "connected" | "streaming" | "error";
  heartbeatAt: Date | null;
  heartbeatAgeMs: number | null;
  heartbeatFresh: boolean;
  marketEventAt: Date | null;
  marketEventAgeMs: number | null;
  marketEventFresh: boolean;
  lastTransportLatencyMs: number | null;
  lastProcessingLatencyMs: number | null;
  lastEndToEndLatencyMs: number | null;
  jitterMs: number | null;
  latencyState: LiveNetworkState;
  latencyReason: string;
  queue: {
    depth: number;
    highWatermark: number;
    capacity: number;
    state: LiveBackpressureState;
    enqueued: number;
    processed: number;
    rejected: number;
  };
  integrity: {
    state: LiveNetworkState;
    duplicateEvents: number;
    outOfOrderEvents: number;
    malformedEvents: number;
    lastEventKey: string | null;
    reason: string;
  };
  recovery: {
    generation: number;
    state: LiveRecoveryState;
    windowResetRequired: boolean;
    lastResetAt: Date | null;
    recoveredAt: Date | null;
    reason: string;
  };
  marketEventPathHealthy: boolean;
  alertReady: boolean;
  reason: string;
};
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
export type ProtectedMarketWindowSegment = "quote" | "trade" | "volume" | "heartbeat";
export type ProtectedMarketWindowSettlement = {
  scanId: string | null;
  settledAt: Date | null;
  quote: boolean;
  trade: boolean;
  volume: boolean;
  heartbeat: boolean;
  complete: boolean;
  missingSegments: ProtectedMarketWindowSegment[];
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
  /** Transport, queue, and integrity health; never itself market evidence. */
  network: LiveNetworkHealth;
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
  /** One universe-owned identifier shared by all five protected-symbol settlements. */
  scanId: string | null;
  /** Explicit quote/trade/volume/heartbeat settlement for this universe scan. */
  marketWindowSettlement: ProtectedMarketWindowSettlement;
  /** Unique server-process identifier for ordering status snapshots across restarts. */
  statusEpoch: string;
  /** Strictly monotonic snapshot revision within statusEpoch; distinct from market-event time. */
  statusRevision: number;
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
  /** Independent real-time transport and event-path health. */
  network: LiveNetworkHealth;
  scanHealth: ProtectedScanHealth;
  /** Read-only proof of the existing raw → feature → structure → stage → decision path. */
  governance: DataGovernanceSnapshot;
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
  sectorPriority?: SectorPrioritySnapshot;
  /** Aggregate-only read-only explanation of the existing opening readiness gates. */
  openingReadiness: OpeningReadinessSnapshot | null;
};

export type RadarSymbolStatus = {
  scanId: string | null;
  symbol: string;
  connectionState: RadarConnectionState;
  marketFeedState: MarketFeedState;
  lastUpdatedAt: Date | null;
  alphaRadar: AlphaRadarSnapshot;
  signalHistory: AlphaRadarSignalHistoryEntry[];
  market: RadarStatus["market"];
  liveIngestion: LiveIngestionDiagnostics;
  network: LiveNetworkHealth;
  scanHealth: ProtectedScanHealth;
  marketWindowSettlement: ProtectedMarketWindowSettlement;
  governance: DataGovernanceSnapshot;
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

export type SignedMarketLeaderEnvelope = {
  version: "market-leader-intake.v1";
  producerId: "ai-industry-leader-probe";
  issuedAt: string;
  nonce: string;
  payload: {
    symbol: string;
    observedAt: string;
    source: "databento_live";
    schema: "mbp-1" | "ohlcv-1s";
    subscriptionVerified: boolean;
    completeMarketFields: boolean;
    fresh: boolean;
    minimumLiquiditySatisfied: boolean;
    independentEvidenceCount: number;
  };
  signature: string;
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

export type EngineeringScannerHealth = {
  symbol: string;
  schedulerState: ProtectedScanSchedulerState;
};

export type DatabentoLifelineSymbolHealth = {
  symbol: string;
  connectionState: RadarConnectionState;
  transportState: "offline" | "connecting" | "connected" | "streaming" | "error";
  reconnectState: RadarReconnectState;
  reconnectAttempt: number;
  heartbeatAt: Date | null;
  heartbeatAgeMs: number | null;
  heartbeatFresh: boolean;
  lastMarketEventAt: Date | null;
  marketEventAgeMs: number | null;
  marketEventFresh: boolean;
  schedulerState: ProtectedScanSchedulerState;
  recoveryPhase: "stopped" | "starting" | "reconnecting" | "awaiting_live_event" | "rebuilding_window" | "running";
  recoveryWindowState: "not_started" | "awaiting_event" | "rebuilding" | "fresh_input";
  reason: string;
};

type BridgeEvent =
  | { type: "ready" }
  | { type: "heartbeat"; source: "databento_live"; emittedAt: string }
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
type BridgeMarketEvent = Extract<BridgeEvent, { type: "mbp" | "ohlcv" }>;
type BridgeQueueEntry = { generation: number; event: BridgeEvent };

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(currentDir, "databento_live_bridge.py");
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;
const HEARTBEAT_WATCHDOG_DELAY_MS = HEARTBEAT_INTERVAL_MS * 2;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 30_000;
const EXHAUSTION_REARM_DELAY_MS = 5 * 60 * 1_000;
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
const MAX_BRIDGE_OUTPUT_BUFFER_BYTES = 1_000_000;
const MAX_BRIDGE_EVENT_QUEUE = 256;
const BRIDGE_EVENT_BATCH_SIZE = 64;
const NETWORK_LATENCY_WARNING_MS = 2_000;
const NETWORK_LATENCY_BLOCK_MS = 10_000;
const NETWORK_PROCESSING_BLOCK_MS = 5_000;
const NETWORK_JITTER_BLOCK_MS = 5_000;
const MAX_NETWORK_LATENCY_SAMPLES = 64;

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

function blankNetworkHealth(): LiveNetworkHealth {
  return {
    transportState: "offline",
    heartbeatAt: null,
    heartbeatAgeMs: null,
    heartbeatFresh: false,
    marketEventAt: null,
    marketEventAgeMs: null,
    marketEventFresh: false,
    lastTransportLatencyMs: null,
    lastProcessingLatencyMs: null,
    lastEndToEndLatencyMs: null,
    jitterMs: null,
    latencyState: "blocked",
    latencyReason: "No live market event has traversed the bridge.",
    queue: {
      depth: 0,
      highWatermark: 0,
      capacity: MAX_BRIDGE_EVENT_QUEUE,
      state: "normal",
      enqueued: 0,
      processed: 0,
      rejected: 0,
    },
    integrity: {
      state: "blocked",
      duplicateEvents: 0,
      outOfOrderEvents: 0,
      malformedEvents: 0,
      lastEventKey: null,
      reason: "No verified event has established an ordered live window.",
    },
    recovery: {
      generation: 0,
      state: "not_started",
      windowResetRequired: true,
      lastResetAt: null,
      recoveredAt: null,
      reason: "Awaiting a new verified transport session and market-event window.",
    },
    marketEventPathHealthy: false,
    alertReady: false,
    reason: "No live network path is ready. Connection or heartbeat alone cannot produce market evidence.",
  };
}

function blankStatus(symbol = "NVDA"): RadarStatus {
  const configured = Boolean(process.env.DATABENTO_API_KEY);
  const emptyAlphaRadar = createEmptyAlphaRadar(new Date(), symbol);
  const liveIngestion = blankLiveIngestionDiagnostics(symbol, configured);
  const network = blankNetworkHealth();
  const scanHealth: ProtectedScanHealth = {
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
  };
  return {
    scanId: null,
    marketWindowSettlement: {
      scanId: null,
      settledAt: null,
      quote: false,
      trade: false,
      volume: false,
      heartbeat: false,
      complete: false,
      missingSegments: ["quote", "trade", "volume", "heartbeat"],
    },
    statusEpoch: "uninitialized",
    statusRevision: 0,
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
    liveIngestion,
    network,
    scanHealth,
    governance: buildDataGovernanceSnapshot({
      now: new Date(),
      connectionState: configured ? "stopped" : "not_configured",
      marketFeedState: "offline",
      latestMarketEventAt: null,
      subscriptionVerified: configured,
      realMarketEventReceived: false,
      enteredScoringWindow: false,
      marketDataGateReady: false,
      reference: { state: "unavailable", source: null, observedAt: null, reason: "Reference data has not been evaluated." },
      alphaRadar: emptyAlphaRadar,
    }),
    openingReadiness: null,
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
    network: blankNetworkHealth(),
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

function qualityAlignmentScore(alphaRadar: AlphaRadarSnapshot): number | null {
  switch (alphaRadar.multiTimeframe.alignment) {
    case "aligned":
      return 100;
    case "mixed":
      return 60;
    case "conflicted":
      return 20;
    default:
      return null;
  }
}

function counterEvidenceResilienceScore(alphaRadar: AlphaRadarSnapshot): number | null {
  switch (alphaRadar.counterEvidence.strength) {
    case "none":
      return 100;
    case "moderate":
      return 50;
    case "strong":
      return 0;
    default:
      return null;
  }
}

function freshnessFor(timestamp: Date | null, now: Date, hasEnoughData: boolean): RadarFreshness {
  if (!hasEnoughData || !timestamp) return "insufficient";
  const age = now.getTime() - timestamp.getTime();
  if (age > QUIET_AFTER_MS) return "quiet";
  if (age > STALE_AFTER_MS) return "stale";
  return "fresh";
}

export function heartbeatWatchdogWasDelayed(
  previousCheckAt: number | null,
  now: number,
): boolean {
  return previousCheckAt !== null
    && now - previousCheckAt > HEARTBEAT_WATCHDOG_DELAY_MS;
}

export function heartbeatIsFreshWithWatchdogGrace(
  heartbeatAt: Date | null,
  now: Date,
  previousCheckAt: number | null,
  graceUntil: number | null,
): boolean {
  if (!heartbeatAt) return false;
  const nowMs = now.getTime();
  return nowMs - heartbeatAt.getTime() <= HEARTBEAT_TIMEOUT_MS
    || heartbeatWatchdogWasDelayed(previousCheckAt, nowMs)
    || (graceUntil !== null && nowMs < graceUntil);
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

type DatabentoLiveServiceOptions = {
  universeScheduled?: boolean;
  requestUniverseScan?: (reason: string, eventTriggered: boolean) => void;
};

export class DatabentoLiveService extends EventEmitter {
  private readonly universeScheduled: boolean;
  private readonly universeScanRequest: ((reason: string, eventTriggered: boolean) => void) | null;

  constructor(
    private readonly configuredSymbol = "NVDA",
    options: DatabentoLiveServiceOptions = {},
  ) {
    super();
    this.universeScheduled = options.universeScheduled ?? false;
    this.universeScanRequest = options.requestUniverseScan ?? null;
    this.status = blankStatus(configuredSymbol);
  }

  private child: ChildProcess | null = null;
  private outputBuffer = "";
  private bridgeEventQueue: BridgeQueueEntry[] = [];
  private drainingBridgeEvents = false;
  private bridgeTransportStartedAt: Date | null = null;
  private activeBridgeGeneration = 0;
  private readonly observedEventKeys = new Set<string>();
  private readonly lastAcceptedEventTimestampBySchema = new Map<BridgeMarketEvent["schema"], number>();
  private readonly endToEndLatencySamples: number[] = [];
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatWatchdogLastCheckedAt: number | null = null;
  private heartbeatWatchdogGraceUntil: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private exhaustionRearmTimer: NodeJS.Timeout | null = null;
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
  private postBreakoutMachine: PostBreakoutStateMachine = {
    active: false,
    state: "unavailable",
    breakoutPrice: null,
    highSinceBreakout: null,
    consecutiveWeakScans: 0,
    consecutiveReversalScans: 0,
    lastTransitionAt: null,
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
      alphaRadar = {
        ...invalidDetection.snapshot,
        postBreakout: unavailablePostBreakout(
          now,
          "Post-breakout monitoring is unavailable because the live market feed is not streaming; a new confirmed live breakout is required after recovery.",
        ),
      };
      this.preBreakoutMachine = invalidDetection.machine;
      this.postBreakoutMachine = {
        active: false,
        state: "unavailable",
        breakoutPrice: null,
        highSinceBreakout: null,
        consecutiveWeakScans: 0,
        consecutiveReversalScans: 0,
        lastTransitionAt: null,
      };
      this.recordSignalHistory(
        this.status.alphaRadar,
        alphaRadar,
        now,
        "Live confirmation evidence became unavailable.",
      );
      this.status = { ...this.status, alphaRadar };
    }
    const eventPathNetwork = this.currentNetworkHealth(now);
    const observedLiveIngestion = this.currentLiveIngestionDiagnostics(
      alphaRadar,
      marketFeedState,
      eventPathNetwork,
      now,
    );
    const scanHealth = this.currentScanHealth(
      alphaRadar,
      marketFeedState,
      observedLiveIngestion,
      eventPathNetwork,
      now,
    );
    const completeScoringWindow =
      observedLiveIngestion.conditions.subscriptionVerified
      && observedLiveIngestion.conditions.realMarketEventReceived
      && observedLiveIngestion.conditions.enteredScoringWindow
      && observedLiveIngestion.conditions.quoteFresh
      && observedLiveIngestion.conditions.tradeFresh
      && observedLiveIngestion.conditions.volumeFresh
      && observedLiveIngestion.conditions.scoringEligible
      && observedLiveIngestion.conditions.triggerEvidenceAvailable;
    const statusAlertReady =
      eventPathNetwork.alertReady
      && scanHealth.marketDataGateReady
      && completeScoringWindow;
    const network = statusAlertReady === eventPathNetwork.alertReady
      ? eventPathNetwork
      : {
          ...eventPathNetwork,
          alertReady: false,
          reason: `The live event path is healthy, but the protected scoring-window gate is closed: ${scanHealth.reason}`,
        };
    const liveIngestion = {
      ...observedLiveIngestion,
      network,
    };
    const governance = this.currentGovernance(alphaRadar, marketFeedState, liveIngestion, scanHealth, now);
    return {
      ...this.status,
      marketFeedState,
      alphaRadar,
      signalHistory: [...this.signalHistory],
      radar: this.calculateRadar(now),
      liveIngestion,
      network,
      scanHealth,
      governance,
    };
  }

  setUniverseScanSchedule(active: boolean, nextScanAt: Date | null): void {
    if (!this.universeScheduled) return;
    this.scanSchedulerActive = active;
    this.nextScheduledScanAt = nextScanAt;
  }

  settleUniverseScan(
    scanId: string,
    triggerReason: string,
    eventTriggered: boolean,
    forceUniverseOffline: boolean,
    settledAt: Date,
  ): RadarStatus {
    this.status = { ...this.status, scanId };
    if (!forceUniverseOffline) {
      this.runAlphaScan(triggerReason, eventTriggered, scanId, false, settledAt);
    }

    const current = { ...this.getStatus(), scanId };
    const quote = current.liveIngestion.conditions.quoteFresh;
    const trade = current.liveIngestion.conditions.tradeFresh;
    const volume = current.liveIngestion.conditions.volumeFresh;
    const heartbeat =
      !forceUniverseOffline
      && current.network.heartbeatFresh
      && (current.connectionState === "connected" || current.connectionState === "streaming");
    const missingSegments = ([
      ["quote", quote],
      ["trade", trade],
      ["volume", volume],
      ["heartbeat", heartbeat],
    ] as const)
      .filter(([, ready]) => !ready)
      .map(([segment]) => segment);
    const marketWindowSettlement: ProtectedMarketWindowSettlement = {
      scanId,
      settledAt,
      quote,
      trade,
      volume,
      heartbeat,
      complete: missingSegments.length === 0,
      missingSegments,
    };

    if (!forceUniverseOffline) {
      return {
        ...current,
        marketWindowSettlement,
      };
    }

    const unavailableAlpha = createEmptyAlphaRadar(settledAt, this.configuredSymbol);
    const alphaRadar: AlphaRadarSnapshot = {
      ...unavailableAlpha,
      scan: {
        ...unavailableAlpha.scan,
        lastScannedAt: null,
        triggerReason: "universe_transport_gate",
        eventTriggered: false,
      },
      changeIndicators: {
        ...unavailableAlpha.changeIndicators,
        volumeAcceleration: null,
      },
    };
    const network: LiveNetworkHealth = {
      ...current.network,
      marketEventPathHealthy: false,
      alertReady: false,
      reason: "The shared protected-universe transport gate is offline; no symbol may retain alert readiness.",
    };
    const liveIngestion: LiveIngestionDiagnostics = {
      ...current.liveIngestion,
      network,
      acceptanceState: "offline",
      conditions: {
        ...current.liveIngestion.conditions,
        scoringEligible: false,
        triggerEvidenceAvailable: false,
      },
      triggerEvidence: {
        ...current.liveIngestion.triggerEvidence,
        eventTriggered: false,
        triggerReason: "universe_transport_gate",
        scanAt: null,
        missingEvidence: marketWindowSettlement.missingSegments.map(
          (segment) => `Missing fresh ${segment} segment for shared scan ${scanId}.`,
        ),
      },
      scoringStatus: {
        scoreState: alphaRadar.scoreState,
        status: alphaRadar.status,
        score: null,
        freshness: alphaRadar.momentum.freshness,
        dataQuality: alphaRadar.dataQuality,
        gateReason: "universe_transport_offline",
      },
      reason: "A connection or transport-heartbeat failure in the protected universe forces all five symbols offline for this shared scan.",
    };
    const scanHealth: ProtectedScanHealth = {
      ...current.scanHealth,
      marketDataState: "offline",
      marketDataGateReady: false,
      degradation: "offline",
      reason: "A connection or transport-heartbeat failure forces the complete protected universe offline for this scan.",
    };
    return {
      ...current,
      scanId,
      marketFeedState: "offline",
      alphaRadar,
      signalHistory: [],
      radar: blankRadarSnapshot(),
      liveIngestion,
      network,
      scanHealth,
      marketWindowSettlement,
      governance: buildDataGovernanceSnapshot({
        now: settledAt,
        connectionState: "stopped",
        marketFeedState: "offline",
        latestMarketEventAt: null,
        subscriptionVerified: current.liveIngestion.conditions.subscriptionVerified,
        realMarketEventReceived: false,
        enteredScoringWindow: false,
        marketDataGateReady: false,
        reference: {
          state: "unavailable",
          source: null,
          observedAt: null,
          reason: "Reference classification is not market evidence.",
        },
        alphaRadar,
      }),
    };
  }

  /**
   * A deliberately side-effect-free scheduler projection for infrastructure
   * observability. Unlike getStatus(), it never recalculates a signal,
   * persists a transition, emits an event, or changes a ranking machine.
   */
  getEngineeringScannerHealth(now = new Date()): EngineeringScannerHealth {
    const scanLagMs = this.nextScheduledScanAt === null
      ? null
      : Math.max(0, now.getTime() - this.nextScheduledScanAt.getTime());
    return {
      symbol: this.configuredSymbol,
      schedulerState: !this.scanSchedulerActive
        ? "inactive"
        : scanLagMs !== null && scanLagMs > 0
          ? "delayed"
          : "scheduled",
    };
  }

  /**
   * Side-effect-free runtime projection for the backend lifeline. It reads
   * stored transport/event timestamps and scheduler ownership only; unlike
   * getStatus(), it cannot advance Alpha ranking or any signal state machine.
   */
  getLifelineHealth(now = new Date()): DatabentoLifelineSymbolHealth {
    const heartbeatAt = this.status.lastHeartbeatAt;
    const heartbeatAgeMs = heartbeatAt === null
      ? null
      : Math.max(0, now.getTime() - heartbeatAt.getTime());
    const lastMarketEventAt = this.status.liveIngestion.lastMarketEventAt;
    const marketEventAgeMs = lastMarketEventAt === null
      ? null
      : Math.max(0, now.getTime() - lastMarketEventAt.getTime());
    const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= HEARTBEAT_INTERVAL_MS * 3;
    const marketEventFresh = marketEventAgeMs !== null && marketEventAgeMs <= STALE_AFTER_MS;
    const schedulerState = this.getEngineeringScannerHealth(now).schedulerState;
    const transportState =
      this.status.connectionState === "not_configured" || this.status.connectionState === "stopped"
        ? "offline"
        : this.status.connectionState;
    const recoveryPhase: DatabentoLifelineSymbolHealth["recoveryPhase"] =
      transportState === "offline"
        ? "stopped"
        : transportState === "error" || this.status.reconnectState !== "idle"
          ? "reconnecting"
          : transportState === "connecting"
            ? "starting"
            : !lastMarketEventAt
              ? "awaiting_live_event"
              : !marketEventFresh || this.status.liveIngestion.currentWindowMarketEventCount === 0
                ? "rebuilding_window"
                : "running";
    const recoveryWindowState: DatabentoLifelineSymbolHealth["recoveryWindowState"] =
      recoveryPhase === "stopped" || recoveryPhase === "starting" || recoveryPhase === "reconnecting"
        ? "not_started"
        : !lastMarketEventAt
          ? "awaiting_event"
          : !marketEventFresh || this.status.liveIngestion.currentWindowMarketEventCount === 0
            ? "rebuilding"
            : "fresh_input";
    const reason =
      recoveryPhase === "stopped"
        ? "The server-side bridge is stopped or not configured. No heartbeat or cached observation is treated as live."
        : recoveryPhase === "starting"
          ? "The server-side bridge is starting. Production scanning and alerts remain gated until real market records arrive."
          : recoveryPhase === "reconnecting"
            ? "The provider connection is recovering with bounded backoff. The prior analysis window is not trusted."
            : recoveryPhase === "awaiting_live_event"
              ? "Transport is present but no verified market event has arrived. Heartbeats do not satisfy market evidence."
              : recoveryPhase === "rebuilding_window"
                ? "The recovery window is rebuilding from new verified market events. Prior observations cannot restore freshness."
                : "Transport, heartbeat, and a recent market event are present; independent scan and AlertMonitor gates still decide eligibility.";
    return {
      symbol: this.configuredSymbol,
      connectionState: this.status.connectionState,
      transportState,
      reconnectState: this.status.reconnectState,
      reconnectAttempt: this.status.reconnectAttempt,
      heartbeatAt,
      heartbeatAgeMs,
      heartbeatFresh,
      lastMarketEventAt,
      marketEventAgeMs,
      marketEventFresh,
      schedulerState,
      recoveryPhase,
      recoveryWindowState,
      reason,
    };
  }

  private currentGovernance(
    alphaRadar: AlphaRadarSnapshot,
    marketFeedState: MarketFeedState,
    liveIngestion: LiveIngestionDiagnostics,
    scanHealth: ProtectedScanHealth,
    now: Date,
  ): DataGovernanceSnapshot {
    return buildDataGovernanceSnapshot({
      now,
      connectionState: this.status.connectionState,
      marketFeedState,
      latestMarketEventAt: liveIngestion.lastMarketEventAt,
      subscriptionVerified: liveIngestion.conditions.subscriptionVerified,
      realMarketEventReceived: liveIngestion.conditions.realMarketEventReceived,
      enteredScoringWindow: liveIngestion.enteredScoringWindow,
      marketDataGateReady: scanHealth.marketDataGateReady,
      reference: {
        state: "unavailable",
        source: null,
        observedAt: null,
        reason: "Reference classification is not market evidence.",
      },
      alphaRadar,
    });
  }

  private currentScanHealth(
    alphaRadar: AlphaRadarSnapshot,
    marketFeedState: MarketFeedState,
    liveIngestion: LiveIngestionDiagnostics,
    network: LiveNetworkHealth,
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
      && network.marketEventPathHealthy
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

  private currentNetworkHealth(now: Date): LiveNetworkHealth {
    const stored = this.status.network;
    const heartbeatAt = this.status.lastHeartbeatAt;
    const heartbeatAgeMs = heartbeatAt === null
      ? null
      : Math.max(0, now.getTime() - heartbeatAt.getTime());
    const marketEventAt = this.status.liveIngestion.lastMarketEventAt;
    const marketEventAgeMs = marketEventAt === null
      ? null
      : Math.max(0, now.getTime() - marketEventAt.getTime());
    const transportState =
      this.status.connectionState === "not_configured" || this.status.connectionState === "stopped"
        ? "offline"
        : this.status.connectionState;
    const heartbeatFresh = heartbeatIsFreshWithWatchdogGrace(
      heartbeatAt,
      now,
      this.heartbeatWatchdogLastCheckedAt,
      this.heartbeatWatchdogGraceUntil,
    );
    const marketEventFresh = marketEventAgeMs !== null && marketEventAgeMs <= STALE_AFTER_MS;
    const queueState: LiveBackpressureState =
      stored.queue.state === "blocked"
        ? "blocked"
        : this.bridgeEventQueue.length >= Math.ceil(MAX_BRIDGE_EVENT_QUEUE * 0.75)
          ? "active"
          : "normal";
    const integrityState = stored.integrity.state;
    const latencyState = stored.latencyState;
    const marketEventPathHealthy =
      transportState === "streaming"
      && marketEventFresh
      && latencyState === "healthy"
      && queueState === "normal"
      && integrityState === "healthy"
      && !this.analysisWindowNeedsReset;
    const recoveryState: LiveRecoveryState =
      transportState === "offline"
        ? "stopped"
        : transportState === "error" || this.status.reconnectState !== "idle"
          ? "reconnecting"
          : !heartbeatAt
            ? "awaiting_heartbeat"
            : !marketEventAt
              ? "awaiting_market_event"
              : this.analysisWindowNeedsReset || !marketEventPathHealthy
                ? "rebuilding_window"
                : "running";
    const alertReady =
      marketEventPathHealthy
      && heartbeatFresh
      && this.status.liveIngestion.currentWindowMarketEventCount > 0;
    const reason =
      transportState === "offline"
        ? "Transport is offline. Cached events, local heartbeats, and prior windows are not live market evidence."
        : recoveryState === "reconnecting"
          ? "Transport recovery is bounded and in progress; the prior market window is withheld."
          : !heartbeatFresh
            ? "The bridge has not emitted a timely transport heartbeat."
            : !marketEventFresh
              ? "No fresh verified market event is available; heartbeat freshness does not refresh market data."
              : queueState !== "normal"
                ? queueState === "blocked"
                  ? "The bounded bridge queue overflowed; no alert readiness is allowed until a new clean window is rebuilt."
                  : "The bridge queue is under backpressure; alert readiness is withheld until it drains."
                : latencyState !== "healthy"
                  ? stored.latencyReason
                  : integrityState !== "healthy"
                    ? stored.integrity.reason
                    : this.analysisWindowNeedsReset
                      ? "A new ordered market-event window must be rebuilt after recovery or integrity loss."
                      : alertReady
                        ? "Transport, heartbeat, ordered event delivery, and bounded processing are healthy. Separate scanner and Alert gates still apply."
                        : "The event path is healthy but the current market window is still building.";
    return {
      ...stored,
      transportState,
      heartbeatAt,
      heartbeatAgeMs,
      heartbeatFresh,
      marketEventAt,
      marketEventAgeMs,
      marketEventFresh,
      queue: {
        ...stored.queue,
        depth: this.bridgeEventQueue.length,
        state: queueState,
      },
      recovery: {
        ...stored.recovery,
        state: recoveryState,
        windowResetRequired: this.analysisWindowNeedsReset,
        reason,
      },
      marketEventPathHealthy,
      alertReady,
      reason,
    };
  }

  private currentLiveIngestionDiagnostics(
    alphaRadar: AlphaRadarSnapshot,
    marketFeedState: MarketFeedState,
    network: LiveNetworkHealth,
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
      network,
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
    this.clearExhaustionRearmTimer();
    this.clearHeartbeatTimer();
    this.stopScanScheduler();
    this.retireActiveBridge();
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

  private retireActiveBridge(): number {
    const discardedCount = this.bridgeEventQueue.length;
    this.activeBridgeGeneration += 1;
    this.outputBuffer = "";
    this.bridgeEventQueue = [];
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    return discardedCount;
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
    this.clearExhaustionRearmTimer();
    const now = new Date();
    this.bridgeTransportStartedAt = now;
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
          lastHeartbeatAt: null,
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
          lastHeartbeatAt: null,
          error: null,
        };
    this.startHeartbeat();
    if (!this.universeScheduled) {
      this.startScanScheduler();
    }
    this.publish();

    const child = spawn("python3", ["-u", bridgePath], {
      env: {
        ...process.env,
        RADAR_SYMBOL: this.status.symbol,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const bridgeGeneration = this.activeBridgeGeneration + 1;
    this.activeBridgeGeneration = bridgeGeneration;
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.consumeOutput(child, bridgeGeneration, chunk.toString());
    });
    child.stderr?.on("data", () => {
      // The bridge intentionally does not write raw diagnostics to the public API.
      // If it does, keep the bytes out of logs and present a generic connection error.
    });
    child.on("error", () => {
      if (this.child !== child || bridgeGeneration !== this.activeBridgeGeneration) return;
      this.fail("Unable to launch the Databento live bridge.", true);
    });
    child.on("close", (code) => {
      if (this.child !== child || bridgeGeneration !== this.activeBridgeGeneration) return;
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

  private consumeOutput(child: ChildProcess, generation: number, chunk: string): void {
    if (this.child !== child || generation !== this.activeBridgeGeneration) {
      return;
    }
    this.outputBuffer += chunk;
    if (Buffer.byteLength(this.outputBuffer, "utf8") > MAX_BRIDGE_OUTPUT_BUFFER_BYTES) {
      this.outputBuffer = "";
      this.recordRejectedBridgeEvents(
        1,
        "The bridge output buffer exceeded its bounded capacity before complete events could be processed.",
      );
      this.fail("Databento bridge output exceeded the bounded processing buffer.", true);
      return;
    }
    const lines = this.outputBuffer.split("\n");
    this.outputBuffer = lines.pop() ?? "";
    const parsedEvents: BridgeEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        parsedEvents.push(JSON.parse(line) as BridgeEvent);
      } catch {
        this.recordMalformedBridgeEvent();
        this.fail("The Databento bridge returned an unreadable status update.", true);
        return;
      }
    }
    this.enqueueBridgeEvents(parsedEvents, generation);
  }

  private enqueueBridgeEvents(events: BridgeEvent[], generation = this.activeBridgeGeneration): void {
    if (events.length === 0) return;
    if (generation !== this.activeBridgeGeneration) {
      this.recordRejectedBridgeEvents(
        events.length,
        "Events from a retired bridge generation were discarded before they could affect the active market window.",
      );
      return;
    }
    const available = MAX_BRIDGE_EVENT_QUEUE - this.bridgeEventQueue.length;
    if (events.length > available) {
      this.recordRejectedBridgeEvents(
        events.length + this.bridgeEventQueue.length,
        "The bounded bridge event queue reached capacity; events were rejected explicitly and the live window was invalidated.",
      );
      this.bridgeEventQueue = [];
      this.fail("Databento bridge event queue exceeded its bounded capacity.", true);
      return;
    }
    this.bridgeEventQueue.push(...events.map((event) => ({ generation, event })));
    this.status = {
      ...this.status,
      network: {
        ...this.status.network,
        queue: {
          ...this.status.network.queue,
          depth: this.bridgeEventQueue.length,
          highWatermark: Math.max(this.status.network.queue.highWatermark, this.bridgeEventQueue.length),
          enqueued: this.status.network.queue.enqueued + events.length,
          state: this.bridgeEventQueue.length >= Math.ceil(MAX_BRIDGE_EVENT_QUEUE * 0.75)
            ? "active"
            : this.status.network.queue.state,
        },
      },
    };
    this.drainBridgeEvents();
  }

  private drainBridgeEvents(): void {
    if (this.drainingBridgeEvents) return;
    this.drainingBridgeEvents = true;
    try {
      let processed = 0;
      while (this.bridgeEventQueue.length > 0 && processed < BRIDGE_EVENT_BATCH_SIZE) {
        const entry = this.bridgeEventQueue.shift();
        if (!entry) break;
        if (entry.generation !== this.activeBridgeGeneration) {
          this.recordRejectedBridgeEvents(
            1,
            "A queued event belonged to a retired bridge generation and was discarded.",
          );
          continue;
        }
        this.applyEvent(entry.event);
        processed += 1;
        this.status = {
          ...this.status,
          network: {
            ...this.status.network,
            queue: {
              ...this.status.network.queue,
              depth: this.bridgeEventQueue.length,
              processed: this.status.network.queue.processed + 1,
              state: this.status.network.queue.state === "blocked"
                ? "blocked"
                : this.bridgeEventQueue.length >= Math.ceil(MAX_BRIDGE_EVENT_QUEUE * 0.75)
                  ? "active"
                  : "normal",
            },
          },
        };
      }
    } finally {
      this.drainingBridgeEvents = false;
    }
    if (this.bridgeEventQueue.length > 0) {
      setImmediate(() => this.drainBridgeEvents());
    }
  }

  private recordMalformedBridgeEvent(): void {
    this.status = {
      ...this.status,
      network: {
        ...this.status.network,
        integrity: {
          ...this.status.network.integrity,
          state: "blocked",
          malformedEvents: this.status.network.integrity.malformedEvents + 1,
          reason: "The bridge emitted an unreadable event. The current analysis window is no longer trusted.",
        },
      },
    };
    this.analysisWindowNeedsReset = true;
  }

  private recordRejectedBridgeEvents(count: number, reason: string): void {
    this.status = {
      ...this.status,
      network: {
        ...this.status.network,
        queue: {
          ...this.status.network.queue,
          state: "blocked",
          rejected: this.status.network.queue.rejected + count,
        },
        integrity: {
          ...this.status.network.integrity,
          state: "blocked",
          reason,
        },
      },
    };
    this.analysisWindowNeedsReset = true;
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

  private bridgeEventKey(event: BridgeMarketEvent): string {
    if (event.type === "mbp") {
      return [
        event.schema,
        event.timestamp,
        event.bidPrice,
        event.askPrice,
        event.bidSize,
        event.askSize,
        event.trade?.price ?? null,
        event.trade?.size ?? null,
        event.trade?.timestamp ?? null,
        event.trade?.side ?? null,
      ].join("|");
    }
    return [event.schema, event.timestamp, event.close, event.volume].join("|");
  }

  private rejectIntegrityEvent(kind: "duplicate" | "out_of_order", eventKey: string): void {
    const current = this.status.network.integrity;
    const reason = kind === "duplicate"
      ? "A duplicate bridge event was detected. The event was rejected and a new ordered window is required."
      : "An out-of-order bridge event was detected. The event was rejected and a new ordered window is required.";
    this.status = {
      ...this.status,
      network: {
        ...this.status.network,
        integrity: {
          ...current,
          state: "blocked",
          duplicateEvents: current.duplicateEvents + (kind === "duplicate" ? 1 : 0),
          outOfOrderEvents: current.outOfOrderEvents + (kind === "out_of_order" ? 1 : 0),
          lastEventKey: eventKey,
          reason,
        },
      },
    };
    this.analysisWindowNeedsReset = true;
  }

  private acceptOrderedBridgeEvent(
    event: BridgeMarketEvent,
    eventTimestamp: Date,
    receiveTimestamp: Date | null,
    ingestedAt: Date,
    now: Date,
  ): boolean {
    const eventKey = this.bridgeEventKey(event);
    if (this.observedEventKeys.has(eventKey)) {
      this.rejectIntegrityEvent("duplicate", eventKey);
      return false;
    }
    const lastAcceptedForSchema = this.lastAcceptedEventTimestampBySchema.get(event.schema);
    if (lastAcceptedForSchema !== undefined && eventTimestamp.getTime() < lastAcceptedForSchema) {
      this.rejectIntegrityEvent("out_of_order", eventKey);
      return false;
    }

    this.observedEventKeys.add(eventKey);
    if (this.observedEventKeys.size > MAX_ALPHA_OBSERVATIONS) {
      const oldest = this.observedEventKeys.values().next().value;
      if (oldest) this.observedEventKeys.delete(oldest);
    }
    this.lastAcceptedEventTimestampBySchema.set(event.schema, eventTimestamp.getTime());

    const transportLatencyMs = receiveTimestamp === null
      ? null
      : Math.max(0, receiveTimestamp.getTime() - eventTimestamp.getTime());
    const processingLatencyMs = Math.max(0, now.getTime() - ingestedAt.getTime());
    const endToEndLatencyMs = Math.max(0, now.getTime() - eventTimestamp.getTime());
    // Jitter measures delivery-path variance, not the normal event-time span
    // while a rolling market window is being built.
    const pathLatencyForJitter = transportLatencyMs ?? processingLatencyMs;
    const previousPathLatency = this.endToEndLatencySamples.at(-1) ?? null;
    const jitterMs = previousPathLatency === null
      ? null
      : Math.abs(pathLatencyForJitter - previousPathLatency);
    this.endToEndLatencySamples.push(pathLatencyForJitter);
    if (this.endToEndLatencySamples.length > MAX_NETWORK_LATENCY_SAMPLES) {
      this.endToEndLatencySamples.splice(0, this.endToEndLatencySamples.length - MAX_NETWORK_LATENCY_SAMPLES);
    }
    const latencyBlocked =
      endToEndLatencyMs > NETWORK_LATENCY_BLOCK_MS
      || (transportLatencyMs !== null && transportLatencyMs > NETWORK_LATENCY_BLOCK_MS)
      || processingLatencyMs > NETWORK_PROCESSING_BLOCK_MS
      || (jitterMs !== null && jitterMs > NETWORK_JITTER_BLOCK_MS);
    const latencyDegraded =
      !latencyBlocked
      && (
        endToEndLatencyMs > NETWORK_LATENCY_WARNING_MS
        || (transportLatencyMs !== null && transportLatencyMs > NETWORK_LATENCY_WARNING_MS)
        || processingLatencyMs > NETWORK_LATENCY_WARNING_MS
      );
    const latencyState: LiveNetworkState = latencyBlocked
      ? "blocked"
      : latencyDegraded
        ? "degraded"
        : "healthy";
    const latencyReason = latencyBlocked
      ? "Event transport, processing, end-to-end latency, or jitter exceeded a fail-closed network threshold."
      : latencyDegraded
        ? "Event latency is elevated; production alert readiness is withheld until transport stabilizes."
        : "Event transport and processing latency are within the bounded real-time threshold.";
    this.status = {
      ...this.status,
      network: {
        ...this.status.network,
        lastTransportLatencyMs: transportLatencyMs,
        lastProcessingLatencyMs: processingLatencyMs,
        lastEndToEndLatencyMs: endToEndLatencyMs,
        jitterMs,
        latencyState,
        latencyReason,
        integrity: {
          ...this.status.network.integrity,
          state: "healthy",
          lastEventKey: eventKey,
          reason: "Verified bridge events are ordered and unique within the current recovery generation.",
        },
      },
    };
    if (latencyBlocked) {
      this.analysisWindowNeedsReset = true;
      return false;
    }
    return true;
  }

  private applyEvent(event: BridgeEvent): void {
    const now = new Date();
    if (event.type === "ready") {
      this.clearExhaustionRearmTimer();
      this.status = {
        ...this.status,
        connectionState: "connected",
        error: null,
        reconnectState: "idle",
        reconnectAttempt: 0,
        nextReconnectAt: null,
        network: {
          ...this.status.network,
          transportState: "connected",
        },
      };
      this.publish();
      return;
    }

    if (event.type === "heartbeat") {
      const emittedAt = observedAt(event.emittedAt, now);
      if (event.source !== "databento_live" || !emittedAt) return;
      this.status = {
        ...this.status,
        // The authenticated local bridge pulse is fresh when this process
        // receives it. Market-event freshness remains an independent gate, so
        // a heartbeat can never refresh prices or restore alert readiness.
        lastHeartbeatAt: now,
      };
      this.publish();
      return;
    }

    if (event.type === "error") {
      this.fail(redactMessage(event.message), true);
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
    if (!this.acceptOrderedBridgeEvent(event, eventTimestamp, receiveTimestamp, ingestedAt, now)) {
      this.publish();
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
    if (!this.universeScheduled) {
      this.stopScanScheduler();
    }
    this.analysisWindowNeedsReset = true;
    const discardedCount = this.retireActiveBridge();
    if (discardedCount > 0) {
      this.recordRejectedBridgeEvents(
        discardedCount,
        "Queued events from a failed bridge generation were discarded before reconnect.",
      );
    }
    this.status = {
      ...this.status,
      connectionState: "error",
      error: redactMessage(message),
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
        nextReconnectAt: new Date(Date.now() + EXHAUSTION_REARM_DELAY_MS),
        error: `${this.status.error ?? "Databento live stream is unavailable."} Automatic reconnect exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts; a new bounded recovery cycle is scheduled after the cooldown.`,
      };
      this.scheduleExhaustionRearm();
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
    this.heartbeatWatchdogLastCheckedAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.status.connectionState === "stopped" || this.status.connectionState === "not_configured") {
        return;
      }
      const now = Date.now();
      const watchdogWasDelayed = heartbeatWatchdogWasDelayed(
        this.heartbeatWatchdogLastCheckedAt,
        now,
      );
      this.heartbeatWatchdogLastCheckedAt = now;
      if (watchdogWasDelayed) {
        this.heartbeatWatchdogGraceUntil = now + HEARTBEAT_INTERVAL_MS;
      }
      const heartbeatReference = this.status.lastHeartbeatAt ?? this.bridgeTransportStartedAt;
      if (
        this.child
        && heartbeatReference
        && now - heartbeatReference.getTime() > HEARTBEAT_TIMEOUT_MS
        && !watchdogWasDelayed
        && (
          this.heartbeatWatchdogGraceUntil === null
          || now >= this.heartbeatWatchdogGraceUntil
        )
      ) {
        this.fail("Databento bridge transport heartbeat timed out.", true);
        return;
      }
      this.status = {
        ...this.status,
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
    this.heartbeatWatchdogLastCheckedAt = null;
    this.heartbeatWatchdogGraceUntil = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * A failed connection burst must be bounded, but a permanently running API
   * still needs a deterministic recovery path. This timer starts a fresh
   * bounded burst after a quiet cooldown; it never treats the timer itself as
   * market evidence and the normal live-event gates remain unchanged.
   */
  private scheduleExhaustionRearm(): void {
    if (this.stopping || this.exhaustionRearmTimer || !process.env.DATABENTO_API_KEY) {
      return;
    }
    this.exhaustionRearmTimer = setTimeout(() => {
      this.exhaustionRearmTimer = null;
      if (this.stopping || !process.env.DATABENTO_API_KEY) return;
      this.status = {
        ...this.status,
        reconnectState: "scheduled",
        reconnectAttempt: 0,
        nextReconnectAt: null,
        error: null,
      };
      this.publish();
      this.launch(true);
    }, EXHAUSTION_REARM_DELAY_MS);
    this.exhaustionRearmTimer.unref();
  }

  private clearExhaustionRearmTimer(): void {
    if (this.exhaustionRearmTimer) {
      clearTimeout(this.exhaustionRearmTimer);
      this.exhaustionRearmTimer = null;
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
    if (this.universeScheduled) {
      // Every accepted live event keeps the universe-owned cycle scheduler
      // armed. Ordinary quote/trade/bar flow remains coalesced behind the
      // existing timer; only its reason/evidence flag is updated. This also
      // repairs a missing timer without minting a per-symbol scan identity.
      this.universeScanRequest?.(reason, eventTriggered);
      return;
    }
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

  private runAlphaScan(
    triggerReason: string,
    eventTriggered: boolean,
    scanId: string | null = this.status.scanId,
    publishStatus = true,
    scanAt = new Date(),
  ): void {
    // A scheduler tick is activity, not market evidence. Do not record a
    // completed scan while the bridge is still connecting, reconnecting, or
    // otherwise not streaming. The next armed tick will retry after a real
    // market event moves the service into the streaming state.
    if (this.scanInProgress || this.status.connectionState !== "streaming") return;
    this.scanInProgress = true;
    try {
    const now = scanAt;
    const profile = scanProfileAt(now);
    const calculated = calculateAlphaRadar({
      now,
      connectionState: this.status.connectionState,
      quotes: this.quotes,
      trades: this.trades,
      bars: this.bars,
    });
    const calculatedDynamics = addAlphaRadarDynamics(calculated, this.alphaHistory, {
      lastScannedAt: now,
      scanIntervalMs: profile.scanIntervalMs,
      scanMode: profile.scanMode,
      triggerReason,
      eventTriggered,
    });
    const dynamicSnapshot: AlphaRadarSnapshot =
      calculated.diagnostics.fresh_volume > 0
        ? calculatedDynamics
        : {
            ...calculatedDynamics,
            changeIndicators: {
              ...calculatedDynamics.changeIndicators,
              volumeAcceleration: null,
            },
          };
    const detection = updatePreBreakoutDetection(
      dynamicSnapshot,
      this.preBreakoutMachine,
      now,
    );
    const postBreakout = updatePostBreakoutMonitoring(
      detection.snapshot,
      this.postBreakoutMachine,
      {
        now,
        connectionState: this.status.connectionState,
        quotes: this.quotes,
        trades: this.trades,
        bars: this.bars,
      },
    );
    const alphaRadar = postBreakout.snapshot;
    const governance = buildDataGovernanceSnapshot({
      now,
      connectionState: this.status.connectionState,
      marketFeedState: this.marketFeedStateAt(now),
      latestMarketEventAt: this.status.liveIngestion.lastMarketEventAt,
      subscriptionVerified: this.status.liveIngestion.conditions.subscriptionVerified,
      realMarketEventReceived: this.status.liveIngestion.conditions.realMarketEventReceived,
      enteredScoringWindow: this.status.liveIngestion.enteredScoringWindow,
      marketDataGateReady: this.currentScanHealth(
        alphaRadar,
        this.marketFeedStateAt(now),
        this.status.liveIngestion,
        this.currentNetworkHealth(now),
        now,
      ).marketDataGateReady,
      reference: { state: "unavailable", source: null, observedAt: null, reason: "Reference classification is not market evidence." },
      alphaRadar,
    });
    this.preBreakoutMachine = detection.machine;
    this.postBreakoutMachine = postBreakout.machine;
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
      scanId,
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
        lifecycleSnapshot: {
          learningStage: alphaRadar.postBreakout.active ? "post_breakout" : "pre_breakout",
          postBreakoutState: alphaRadar.postBreakout.state,
          postBreakoutActive: alphaRadar.postBreakout.active,
          dataFresh: true,
        },
      });
      this.capturePostBreakoutShadowStages(alphaRadar);
    }
    if (publishStatus) {
      this.publish();
    }
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
    this.observedEventKeys.clear();
    this.lastAcceptedEventTimestampBySchema.clear();
    this.endToEndLatencySamples.splice(0);
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
    this.postBreakoutMachine = {
      active: false,
      state: "unavailable",
      breakoutPrice: null,
      highSinceBreakout: null,
      consecutiveWeakScans: 0,
      consecutiveReversalScans: 0,
      lastTransitionAt: null,
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
      network: {
        ...this.status.network,
        lastTransportLatencyMs: null,
        lastProcessingLatencyMs: null,
        lastEndToEndLatencyMs: null,
        jitterMs: null,
        latencyState: "blocked",
        latencyReason: "The previous network window was retired. A new low-latency verified event must rebuild it.",
        queue: {
          ...this.status.network.queue,
          depth: this.bridgeEventQueue.length,
          state: "normal",
        },
        integrity: {
          ...this.status.network.integrity,
          state: "healthy",
          lastEventKey: null,
          reason: "A new recovery generation is awaiting an ordered verified market event.",
        },
        recovery: {
          ...this.status.network.recovery,
          generation: this.status.network.recovery.generation + 1,
          state: "awaiting_market_event",
          windowResetRequired: true,
          lastResetAt: now,
          recoveredAt: null,
          reason: "Prior observations were retired. This generation cannot reuse their freshness or alert eligibility.",
        },
      },
    };
  }

  /**
   * Records verified breakout and post-breakout observations in the shadow
   * archive only. It is intentionally called after the live snapshot has been
   * published and never feeds a score, scan decision, alert gate, or push path.
   */
  private capturePostBreakoutShadowStages(alphaRadar: AlphaRadarSnapshot): void {
    const post = alphaRadar.postBreakout;
    const triggerPrice = this.status.market.latestPrice;
    const occurredAt = post.lastTransitionAt;
    if (
      !post.active
      || !post.dataFresh
      || !occurredAt
      || triggerPrice === null
      || triggerPrice <= 0
      || alphaRadar.scoreState !== "available"
      || alphaRadar.dataQuality !== "good"
      || !alphaRadar.momentum.available
      || !alphaRadar.volumeIntensity.available
      || !alphaRadar.orderFlowPressure.available
      || !alphaRadar.spread.available
    ) return;

    const reference = marketUniverse
      .query({ search: this.configuredSymbol, eligibility: "all", limit: 20 })
      .items
      .find((item) => item.symbol === this.configuredSymbol);
    const postFlow = normalizeSignedPercentFeature(post.activeBuyPressure);
    const l1Tilt = normalizeSignedPercentFeature(post.l1BidPressure);
    const tradePersistence = normalizeSignedPercentFeature(post.tradeRateChange);
    const state = alphaRadar.preBreakout.state;
    const common = {
      strategyVersion: SHADOW_STRATEGY_VERSION,
      scanWindow: SHADOW_SCAN_WINDOW,
      scanProfile: "fresh-streaming-verified-breakout-sidecar",
      modelVersion: SHADOW_MODEL_VERSION,
      candidateSource: "fresh-production-snapshot-sidecar",
      symbol: this.configuredSymbol,
      sector: reference?.sector ?? null,
      occurredAt,
      triggerPrice,
      direction: "upside" as const,
      state,
      freshnessSnapshot: {
        marketFeedState: this.marketFeedStateAt(occurredAt),
        dataQuality: alphaRadar.dataQuality,
        scoreState: alphaRadar.scoreState,
        streaming: this.status.connectionState === "streaming",
        complete: true,
        eligible: true,
      },
      cohortKey: shadowCohortKey({
        symbol: this.configuredSymbol,
        occurredAt,
        state,
        sector: reference?.sector ?? null,
      }),
      cohortEligibilitySnapshot: {
        baselineSignalType: "state_transition" as const,
        baselineState: state,
        matchingWindowSeconds: 60,
        requiredEvidenceKeys: ["verified_post_breakout", "fresh_volume", "fresh_order_flow"],
        dataFreshRequired: true as const,
      },
    };
    const trueBreakoutEvidence = [
      { key: "verified_post_breakout", label: "Verified structure break", satisfied: post.active, detail: post.reason },
      { key: "fresh_volume", label: "Fresh volume confirmation", satisfied: alphaRadar.volumeIntensity.available, detail: alphaRadar.volumeIntensity.source },
      { key: "fresh_order_flow", label: "Fresh aggressive trade direction", satisfied: postFlow !== null, detail: "Derived from fresh post-breakout trade direction." },
      { key: "fresh_l1", label: "Fresh L1 bid/ask tilt", satisfied: l1Tilt !== null, detail: "Derived from fresh best-bid/best-ask observations." },
      { key: "fresh_trade_persistence", label: "Fresh post-breakout trade persistence", satisfied: tradePersistence !== null, detail: "Derived from fresh post-breakout trade rate." },
    ];
    if (post.state === "trend_continuation") {
      const candidate = evaluateShadowStage({
        ...common,
        signalType: "shadow_true_breakout",
        learningStage: "true_breakout",
        evidenceSnapshot: trueBreakoutEvidence,
        inputSummary: {
          alphaScore: alphaRadar.score,
          confidence: alphaRadar.confidence,
          velocity30s: alphaRadar.alphaVelocity.rate30s,
          velocity60s: alphaRadar.alphaVelocity.rate60s,
          momentumAcceleration: alphaRadar.changeIndicators.momentumAcceleration,
          volumeAcceleration: alphaRadar.changeIndicators.volumeAcceleration,
          orderFlowShift: alphaRadar.changeIndicators.orderFlowShift,
          spreadTightening: alphaRadar.changeIndicators.spreadTightening,
          evidenceCount: trueBreakoutEvidence.filter((item) => item.satisfied).length,
          stageFeatures: {
            structure_breakout: 100,
            breakout_volume_confirmation: alphaRadar.volumeIntensity.score,
            aggressive_trade_direction: postFlow,
            l1_bid_ask_tilt: l1Tilt,
            post_breakout_trade_persistence: tradePersistence,
            multi_timeframe_alignment: qualityAlignmentScore(alphaRadar),
            counter_evidence_resilience: counterEvidenceResilienceScore(alphaRadar),
            data_confidence: alphaRadar.dataConfidence.score,
          },
        },
      });
      if (candidate) void shadowLearning.captureObservation(candidate);
    }

    const postEvidence = [
      ...trueBreakoutEvidence,
      { key: "post_breakout_state", label: "Post-breakout state", satisfied: true, detail: post.state },
    ];
    const supportIntegrity = post.state === "trend_continuation"
      ? 100
      : post.state === "take_profit_watch"
        ? 50
        : 0;
    const postCandidate = evaluateShadowStage({
      ...common,
      signalType: "shadow_post_breakout",
      learningStage: "post_breakout",
      evidenceSnapshot: postEvidence,
      inputSummary: {
        alphaScore: alphaRadar.score,
        confidence: alphaRadar.confidence,
        velocity30s: alphaRadar.alphaVelocity.rate30s,
        velocity60s: alphaRadar.alphaVelocity.rate60s,
        momentumAcceleration: alphaRadar.changeIndicators.momentumAcceleration,
        volumeAcceleration: alphaRadar.changeIndicators.volumeAcceleration,
        orderFlowShift: alphaRadar.changeIndicators.orderFlowShift,
        spreadTightening: alphaRadar.changeIndicators.spreadTightening,
        evidenceCount: postEvidence.filter((item) => item.satisfied).length,
        stageFeatures: {
          post_breakout_active_flow: postFlow,
          volume_trade_speed: alphaRadar.volumeIntensity.score,
          new_high_quality: post.highSinceBreakout === null ? null : (triggerPrice >= post.highSinceBreakout ? 100 : 50),
          price_volume_divergence: null,
          breakout_support_integrity: supportIntegrity,
            multi_timeframe_alignment: qualityAlignmentScore(alphaRadar),
            counter_evidence_resilience: counterEvidenceResilienceScore(alphaRadar),
            data_confidence: alphaRadar.dataConfidence.score,
        },
      },
    });
    if (postCandidate) void shadowLearning.captureObservation(postCandidate);
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
      "latent",
      "breakout_critical",
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
      state: toState as "watch" | "latent" | "breakout_critical" | "confirmed",
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
      learningStage: "pre_breakout",
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
        stageFeatures: {
          relative_strength_improvement: next.momentum.score,
          price_structure: null,
          volatility_contraction: next.spread.score,
          dense_trading_zone: null,
          sell_pressure_decay: next.orderFlowPressure.score,
          active_buy_improvement: next.orderFlowPressure.score,
          volume_structure: next.volumeIntensity.score,
          breakout_distance: null,
          multi_timeframe_alignment: qualityAlignmentScore(next),
          counter_evidence_resilience: counterEvidenceResilienceScore(next),
          data_confidence: next.dataConfidence.score,
        },
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
    if (derived !== "streaming") return derived;
    const network = this.currentNetworkHealth(now);
    return this.analysisWindowNeedsReset || !network.marketEventPathHealthy
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
    scanId: status.scanId,
    symbol: status.symbol,
    connectionState: status.connectionState,
    marketFeedState: status.marketFeedState,
    lastUpdatedAt: status.lastUpdatedAt,
    alphaRadar: status.alphaRadar,
    signalHistory: status.signalHistory,
    market: status.market,
    liveIngestion: status.liveIngestion,
    network: status.network,
    scanHealth: status.scanHealth,
    marketWindowSettlement: status.marketWindowSettlement,
    governance: status.governance,
    streams: status.streams,
    error: status.error,
  };
}

function preBreakoutRank(state: AlphaRadarSnapshot["preBreakout"]["state"]): number {
  return {
    unavailable: 0,
    watch: 1,
    latent: 2,
    breakout_critical: 3,
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
  signingSecret?: () => string | undefined;
  maximumScans?: number;
};

const FOCUSED_SCAN_DEFAULT_CAPACITY = 3;
const FOCUSED_SCAN_CANDIDATE_HISTORY_LIMIT = 12;
const FOCUSED_SCAN_COOLDOWN_MS = 5 * 60_000;
const FOCUSED_SCAN_LEADER_MAX_AGE_MS = 15_000;
const MARKET_LEADER_ENVELOPE_VERSION = "market-leader-intake.v1";
const MARKET_LEADER_PRODUCER_ID = "ai-industry-leader-probe";
const MARKET_LEADER_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MARKET_LEADER_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MARKET_LEADER_REPLAY_LIMIT = 4_096;
const MARKET_LEADER_SIGNING_DOMAIN = "alpha-radar:market-leader-intake:v1";

function marketLeaderSigningSecret(): string | undefined {
  return process.env.MARKET_LEADER_INTAKE_SIGNING_SECRET;
}

function usableMarketLeaderSigningSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}

function canonicalMarketLeaderPayload(
  envelope: Omit<SignedMarketLeaderEnvelope, "signature">,
): string {
  const { payload } = envelope;
  return [
    MARKET_LEADER_SIGNING_DOMAIN,
    envelope.version,
    envelope.producerId,
    envelope.issuedAt,
    envelope.nonce,
    payload.symbol,
    payload.observedAt,
    payload.source,
    payload.schema,
    payload.subscriptionVerified ? "1" : "0",
    payload.completeMarketFields ? "1" : "0",
    payload.fresh ? "1" : "0",
    payload.minimumLiquiditySatisfied ? "1" : "0",
    String(payload.independentEvidenceCount),
  ].join("\n");
}

export function createSignedMarketLeaderEnvelope(
  leader: VerifiedMarketLeader,
  input: {
    secret: string;
    issuedAt?: Date;
    nonce?: string;
  },
): SignedMarketLeaderEnvelope {
  if (!usableMarketLeaderSigningSecret(input.secret)) {
    throw new Error("Market-leader signing is unavailable.");
  }
  const unsigned: Omit<SignedMarketLeaderEnvelope, "signature"> = {
    version: MARKET_LEADER_ENVELOPE_VERSION,
    producerId: MARKET_LEADER_PRODUCER_ID,
    issuedAt: (input.issuedAt ?? new Date()).toISOString(),
    nonce: input.nonce ?? randomUUID(),
    payload: {
      symbol: leader.symbol,
      observedAt: leader.observedAt.toISOString(),
      source: leader.source,
      schema: leader.schema,
      subscriptionVerified: leader.subscriptionVerified,
      completeMarketFields: leader.completeMarketFields,
      fresh: leader.fresh,
      minimumLiquiditySatisfied: leader.minimumLiquiditySatisfied,
      independentEvidenceCount: leader.independentEvidenceCount,
    },
  };
  if (!MARKET_LEADER_NONCE_PATTERN.test(unsigned.nonce)) {
    throw new Error("Market-leader signing nonce is invalid.");
  }
  return {
    ...unsigned,
    signature: createHmac("sha256", input.secret)
      .update(canonicalMarketLeaderPayload(unsigned), "utf8")
      .digest("base64url"),
  };
}

function signedMarketLeaderCandidateFacts(
  envelope: unknown,
  now: Date,
): Pick<FocusedScanCandidate, "symbol" | "observedAt" | "independentEvidenceCount" | "updatedAt"> {
  const candidate = envelope && typeof envelope === "object"
    ? envelope as { payload?: Record<string, unknown> }
    : null;
  const payload = candidate?.payload;
  const rawSymbol = payload?.symbol;
  const rawObservedAt = payload?.observedAt;
  const observedAt = typeof rawObservedAt === "string" ? new Date(rawObservedAt) : null;
  return {
    symbol: typeof rawSymbol === "string" && rawSymbol.trim()
      ? rawSymbol.trim().toUpperCase().slice(0, 20)
      : "UNKNOWN",
    observedAt: observedAt && !Number.isNaN(observedAt.getTime()) ? observedAt : null,
    independentEvidenceCount: typeof payload?.independentEvidenceCount === "number"
      && Number.isFinite(payload.independentEvidenceCount)
      ? payload.independentEvidenceCount
      : 0,
    updatedAt: now,
  };
}

/**
 * Keeps optional dynamic bridges separate from the protected five-symbol radar.
 * Candidates arrive only from an internal, verified live-leader source; this
 * coordinator intentionally has no HTTP mutation endpoint.
 */
export class FocusedScanCoordinator extends EventEmitter {
  private readonly referenceUniverse: Pick<typeof marketUniverse, "query">;
  private readonly createService: (symbol: string) => FocusedScanLiveService;
  private readonly apiKeyAvailable: () => boolean;
  private readonly signingSecret: () => string | undefined;
  private readonly maximumScans: number;
  private readonly active = new Map<string, ActiveFocusedScan>();
  private readonly candidateHistory = new Map<string, FocusedScanCandidate>();
  private readonly cooldowns = new Map<string, Date>();
  private readonly verifiedNonces = new Map<string, number>();

  constructor(options: FocusedScanCoordinatorOptions = {}) {
    super();
    this.referenceUniverse = options.referenceUniverse ?? marketUniverse;
    this.createService = options.createService ?? ((symbol) => new DatabentoLiveService(symbol));
    this.apiKeyAvailable = options.apiKeyAvailable ?? (() => Boolean(process.env.DATABENTO_API_KEY));
    this.signingSecret = options.signingSecret ?? marketLeaderSigningSecret;
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

  /**
   * These statuses are deliberately not published as protected symbol radars.
   * The sector hierarchy may inspect them independently, and still applies
   * every per-symbol live-event, health, freshness, and classification gate.
   */
  getSectorSymbols(): RadarSymbolStatus[] {
    return [...this.active.values()]
      .map((scan) => toSymbolStatus(scan.service.getStatus()))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  routeVerifiedMarketLeader(
    envelope: SignedMarketLeaderEnvelope | unknown,
    protectedStatuses: RadarStatus[],
    now = new Date(),
  ): FocusedScanCandidate {
    const verification = this.verifySignedLeader(envelope, now);
    if (!verification.accepted || !verification.leader) {
      return this.recordCandidate({
        ...signedMarketLeaderCandidateFacts(envelope, now),
        state: "rejected",
        reason: verification.reason,
      });
    }
    const leader = verification.leader;
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

  private verifySignedLeader(
    value: unknown,
    now: Date,
  ): { accepted: boolean; leader: VerifiedMarketLeader | null; reason: string } {
    const secret = this.signingSecret();
    if (!usableMarketLeaderSigningSecret(secret)) {
      return {
        accepted: false,
        leader: null,
        reason: "Market-leader intake authentication is unavailable; unsigned fallback is prohibited.",
      };
    }
    if (!value || typeof value !== "object") {
      return { accepted: false, leader: null, reason: "Market-leader payload is unsigned or malformed." };
    }
    const envelope = value as Partial<SignedMarketLeaderEnvelope>;
    const payload = envelope.payload as Partial<SignedMarketLeaderEnvelope["payload"]> | undefined;
    if (
      envelope.version !== MARKET_LEADER_ENVELOPE_VERSION
      || envelope.producerId !== MARKET_LEADER_PRODUCER_ID
      || typeof envelope.issuedAt !== "string"
      || typeof envelope.nonce !== "string"
      || !MARKET_LEADER_NONCE_PATTERN.test(envelope.nonce)
      || typeof envelope.signature !== "string"
      || !MARKET_LEADER_SIGNATURE_PATTERN.test(envelope.signature)
      || !payload
      || typeof payload.symbol !== "string"
      || typeof payload.observedAt !== "string"
      || payload.source !== "databento_live"
      || !["mbp-1", "ohlcv-1s"].includes(String(payload.schema))
      || typeof payload.subscriptionVerified !== "boolean"
      || typeof payload.completeMarketFields !== "boolean"
      || typeof payload.fresh !== "boolean"
      || typeof payload.minimumLiquiditySatisfied !== "boolean"
      || typeof payload.independentEvidenceCount !== "number"
      || !Number.isSafeInteger(payload.independentEvidenceCount)
      || payload.independentEvidenceCount < 0
    ) {
      return { accepted: false, leader: null, reason: "Market-leader signed envelope is malformed." };
    }
    const issuedAt = new Date(envelope.issuedAt);
    const observedAt = new Date(payload.observedAt);
    if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(observedAt.getTime())) {
      return { accepted: false, leader: null, reason: "Market-leader signed envelope contains an invalid timestamp." };
    }
    const issuedAgeMs = now.getTime() - issuedAt.getTime();
    const observedAgeMs = now.getTime() - observedAt.getTime();
    if (
      issuedAgeMs < 0
      || issuedAgeMs > FOCUSED_SCAN_LEADER_MAX_AGE_MS
      || observedAgeMs < 0
      || observedAgeMs > FOCUSED_SCAN_LEADER_MAX_AGE_MS
      || Math.abs(issuedAt.getTime() - observedAt.getTime()) > FOCUSED_SCAN_LEADER_MAX_AGE_MS
    ) {
      return { accepted: false, leader: null, reason: "Market-leader signed envelope is expired or from the future." };
    }
    const unsigned: Omit<SignedMarketLeaderEnvelope, "signature"> = {
      version: MARKET_LEADER_ENVELOPE_VERSION,
      producerId: MARKET_LEADER_PRODUCER_ID,
      issuedAt: envelope.issuedAt,
      nonce: envelope.nonce,
      payload: {
        symbol: payload.symbol,
        observedAt: payload.observedAt,
        source: payload.source,
        schema: payload.schema as VerifiedMarketLeader["schema"],
        subscriptionVerified: payload.subscriptionVerified,
        completeMarketFields: payload.completeMarketFields,
        fresh: payload.fresh,
        minimumLiquiditySatisfied: payload.minimumLiquiditySatisfied,
        independentEvidenceCount: payload.independentEvidenceCount,
      },
    };
    const expected = createHmac("sha256", secret)
      .update(canonicalMarketLeaderPayload(unsigned), "utf8")
      .digest();
    const supplied = Buffer.from(envelope.signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return { accepted: false, leader: null, reason: "Market-leader signature verification failed." };
    }
    this.pruneVerifiedNonces(now);
    const replayKey = `${envelope.producerId}:${envelope.nonce}`;
    if (this.verifiedNonces.has(replayKey)) {
      return { accepted: false, leader: null, reason: "Market-leader signed envelope was already processed." };
    }
    if (this.verifiedNonces.size >= MARKET_LEADER_REPLAY_LIMIT) {
      return { accepted: false, leader: null, reason: "Market-leader replay protection is at capacity." };
    }
    this.verifiedNonces.set(replayKey, issuedAt.getTime() + FOCUSED_SCAN_LEADER_MAX_AGE_MS);
    return {
      accepted: true,
      leader: {
        symbol: payload.symbol,
        observedAt,
        source: payload.source,
        schema: payload.schema as VerifiedMarketLeader["schema"],
        subscriptionVerified: payload.subscriptionVerified,
        completeMarketFields: payload.completeMarketFields,
        fresh: payload.fresh,
        minimumLiquiditySatisfied: payload.minimumLiquiditySatisfied,
        independentEvidenceCount: payload.independentEvidenceCount,
      },
      reason: "Market-leader producer identity, signature, freshness, and nonce are verified.",
    };
  }

  private pruneVerifiedNonces(now: Date): void {
    for (const [key, expiresAt] of this.verifiedNonces) {
      if (expiresAt < now.getTime()) this.verifiedNonces.delete(key);
    }
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

type AiIndustryLeaderProbeLiveService = {
  getStatus(): RadarStatus;
  start(): RadarStatus;
  stop(): RadarStatus;
  on(event: "status", listener: () => void): unknown;
};

export type AiIndustryLeaderProbeCoordinatorOptions = {
  symbols?: readonly string[];
  createService?: (symbol: string) => AiIndustryLeaderProbeLiveService;
  apiKeyAvailable?: () => boolean;
  signingSecret?: () => string | undefined;
  probeDwellMs?: number;
  symbolSupported?: (symbol: string) => boolean;
};

const AI_INDUSTRY_LEADER_PROBE_CAPACITY = 1;
const AI_INDUSTRY_LEADER_PROBE_DWELL_MS = 2 * 60_000;
const AI_INDUSTRY_LEADER_PROBE_ROUTE_COOLDOWN_MS = 5 * 60_000;

/**
 * Bounded producer for the optional AI discovery pool. It probes at most one
 * non-protected taxonomy member at a time, then delegates leader admission to
 * the existing independent Focused Scan gate. It is never a protected radar.
 */
export class AiIndustryLeaderProbeCoordinator extends EventEmitter {
  private readonly symbols: string[];
  private readonly createService: (symbol: string) => AiIndustryLeaderProbeLiveService;
  private readonly apiKeyAvailable: () => boolean;
  private readonly signingSecret: () => string | undefined;
  private readonly probeDwellMs: number;
  private readonly symbolSupported: (symbol: string) => boolean;
  private active: { symbol: string; service: AiIndustryLeaderProbeLiveService; startedAt: Date } | null = null;
  private readonly routedAt = new Map<string, Date>();
  private cursor = 0;
  private started = false;

  constructor(options: AiIndustryLeaderProbeCoordinatorOptions = {}) {
    super();
    this.symbolSupported = options.symbolSupported
      ?? ((symbol) => MONITORED_SYMBOLS.includes(symbol as (typeof MONITORED_SYMBOLS)[number]));
    this.symbols = [...new Set(options.symbols ?? AI_INDUSTRY_TAXONOMY.map((entry) => entry.symbol))]
      .filter((symbol) => !MONITORED_SYMBOLS.includes(symbol as (typeof MONITORED_SYMBOLS)[number]))
      .filter((symbol) => this.symbolSupported(symbol))
      .sort();
    this.createService = options.createService ?? ((symbol) => new DatabentoLiveService(symbol));
    this.apiKeyAvailable = options.apiKeyAvailable ?? (() => Boolean(process.env.DATABENTO_API_KEY));
    this.signingSecret = options.signingSecret ?? marketLeaderSigningSecret;
    this.probeDwellMs = Math.max(30_000, options.probeDwellMs ?? AI_INDUSTRY_LEADER_PROBE_DWELL_MS);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.active?.service.stop();
    this.active = null;
  }

  observe(
    protectedStatuses: RadarStatus[],
    admitLeader: (leader: SignedMarketLeaderEnvelope, protectedStatuses: RadarStatus[]) => FocusedScanCandidate,
    now = new Date(),
  ): void {
    if (!this.started || !this.apiKeyAvailable() || this.symbols.length === 0) return;
    if (!this.active) this.startNext(now);
    const active = this.active;
    if (!active) return;
    const status = active.service.getStatus();
    const confirmed =
      status.connectionState === "streaming"
      && status.marketFeedState === "streaming"
      && status.alphaRadar.preBreakout.dataFresh
      && status.alphaRadar.preBreakout.state === "confirmed"
      && status.alphaRadar.preBreakout.confirmation.status === "confirmed";
    if (!confirmed) {
      if (now.getTime() - active.startedAt.getTime() >= this.probeDwellMs) this.rotate();
      return;
    }

    const completeMarketFields =
      status.market.latestPrice !== null
      && status.market.bidPrice !== null
      && status.market.askPrice !== null
      && status.market.sessionVolume !== null;
    const secret = this.signingSecret();
    if (!usableMarketLeaderSigningSecret(secret)) {
      this.rotate();
      return;
    }
    const leader: VerifiedMarketLeader = {
      symbol: active.symbol,
      observedAt: status.lastUpdatedAt ?? now,
      source: "databento_live",
      schema: "mbp-1",
      subscriptionVerified: status.configured,
      completeMarketFields,
      fresh: true,
      minimumLiquiditySatisfied: (status.market.sessionVolume ?? 0) > 0,
      independentEvidenceCount: 2,
    };
    const signedLeader = createSignedMarketLeaderEnvelope(leader, {
      secret,
      issuedAt: now,
    });
    this.routedAt.set(active.symbol, now);
    admitLeader(signedLeader, protectedStatuses);
    this.rotate();
  }

  private startNext(now: Date): void {
    for (let attempts = 0; attempts < this.symbols.length; attempts += 1) {
      const symbol = this.symbols[this.cursor % this.symbols.length];
      this.cursor = (this.cursor + 1) % this.symbols.length;
      const lastRoutedAt = this.routedAt.get(symbol);
      if (lastRoutedAt && now.getTime() - lastRoutedAt.getTime() < AI_INDUSTRY_LEADER_PROBE_ROUTE_COOLDOWN_MS) {
        continue;
      }
      const service = this.createService(symbol);
      this.active = { symbol, service, startedAt: now };
      service.on("status", () => this.emit("status"));
      service.start();
      return;
    }
  }

  private rotate(): void {
    this.active?.service.stop();
    this.active = null;
  }
}

export class DatabentoUniverseService extends EventEmitter {
  private readonly services: DatabentoLiveService[];
  private readonly focusedScans = new FocusedScanCoordinator();
  private readonly aiIndustryLeaderProbe = new AiIndustryLeaderProbeCoordinator();
  private snapshot: RadarStatus | null = null;
  private snapshotDirty = true;
  private snapshotBuildQueued = false;
  private snapshotBuildInProgress = false;
  private universeScanTimer: NodeJS.Timeout | null = null;
  private universeScanScheduleGeneration = 0;
  private universeScanSchedulerActive = false;
  private universeScanInProgress = false;
  private lastUniverseScanAt: Date | null = null;
  private pendingUniverseScanReason = "scheduled_scan";
  private pendingUniverseScanEventTriggered = false;
  private currentScanId = randomUUID();
  private settledStatuses: RadarStatus[];
  private readonly statusEpoch = randomUUID();
  private statusRevision = 0;
  private rankingMachine: AlphaRadarRankingMachine = {
    order: [],
    pendingOrder: null,
    pendingObservationCount: 0,
    lastInputSignature: null,
  };
  private sectorRankingMachine: AlphaRadarRankingMachine = {
    order: [],
    pendingOrder: null,
    pendingObservationCount: 0,
    lastInputSignature: null,
  };

  constructor() {
    super();
    this.services = MONITORED_SYMBOLS.map((symbol) => new DatabentoLiveService(symbol, {
      universeScheduled: true,
      requestUniverseScan: (reason, eventTriggered) => {
        this.requestUniverseScan(reason, eventTriggered);
      },
    }));
    const initialSettlementAt = new Date();
    this.settledStatuses = this.services.map((service) => service.settleUniverseScan(
      this.currentScanId,
      "initial_universe_settlement",
      false,
      true,
      initialSettlementAt,
    ));
    this.services.forEach((service) => {
      service.on("status", (status: RadarStatus) => this.handleServiceStatus(status));
    });
    this.focusedScans.on("status", () => this.markSnapshotDirty());
    this.aiIndustryLeaderProbe.on("status", () => this.markSnapshotDirty());
    marketUniverse.on("status", () => this.markSnapshotDirty());
    secEdgarCatalyst.on("status", () => this.markSnapshotDirty());
  }

  private handleServiceStatus(status: RadarStatus): void {
    if (!this.universeScanSchedulerActive) return;
    const transportFailed =
      status.connectionState === "error"
      || status.connectionState === "stopped"
      || status.connectionState === "not_configured"
      || (
        status.lastHeartbeatAt !== null
        && !status.network.heartbeatFresh
      );
    if (transportFailed) {
      this.requestUniverseScan("universe_transport_failure", false, true);
    }
  }

  private clearUniverseScanTimer(): void {
    this.universeScanScheduleGeneration += 1;
    if (this.universeScanTimer) {
      clearTimeout(this.universeScanTimer);
      this.universeScanTimer = null;
    }
    this.services.forEach((service) => service.setUniverseScanSchedule(
      this.universeScanSchedulerActive,
      null,
    ));
  }

  private scheduleNextUniverseScan(delayMs?: number): void {
    if (!this.universeScanSchedulerActive) return;
    this.clearUniverseScanTimer();
    const delay = delayMs ?? scanProfileAt(new Date()).scanIntervalMs;
    const generation = this.universeScanScheduleGeneration;
    const nextScanAt = new Date(Date.now() + delay);
    this.services.forEach((service) => service.setUniverseScanSchedule(true, nextScanAt));
    this.universeScanTimer = setTimeout(() => {
      if (
        !this.universeScanSchedulerActive
        || generation !== this.universeScanScheduleGeneration
      ) {
        return;
      }
      this.universeScanTimer = null;
      const reason = this.pendingUniverseScanReason;
      const eventTriggered = this.pendingUniverseScanEventTriggered;
      this.pendingUniverseScanReason = "scheduled_scan";
      this.pendingUniverseScanEventTriggered = false;
      this.runUniverseScan(reason, eventTriggered);
    }, delay);
  }

  private requestUniverseScan(
    reason: string,
    eventTriggered: boolean,
    immediate = false,
  ): void {
    if (!this.universeScanSchedulerActive) return;
    if (immediate) {
      this.runUniverseScan(reason, eventTriggered, false);
      return;
    }
    this.pendingUniverseScanReason = reason;
    this.pendingUniverseScanEventTriggered ||= eventTriggered;
    if (!this.universeScanTimer) {
      this.scheduleNextUniverseScan();
    }
  }

  private runUniverseScan(
    triggerReason: string,
    eventTriggered: boolean,
    mintSnapshot = true,
  ): RadarStatus {
    if (this.universeScanInProgress) {
      return this.snapshot ?? this.buildSnapshot();
    }
    this.universeScanInProgress = true;
    try {
      const settledAt = mintSnapshot
        ? new Date()
        : this.lastUniverseScanAt ?? new Date();
      const transportStatuses = this.services.map((service) => service.getStatus());
      const forceUniverseOffline = transportStatuses.some((status) => (
        !status.configured
        || (
          status.connectionState !== "connected"
          && status.connectionState !== "streaming"
        )
        || !status.network.heartbeatFresh
      ));
      const scanId = mintSnapshot ? randomUUID() : this.currentScanId;
      if (mintSnapshot) {
        this.currentScanId = scanId;
        this.lastUniverseScanAt = settledAt;
        this.scheduleNextUniverseScan();
      }
      this.settledStatuses = this.services.map((service) => service.settleUniverseScan(
        scanId,
        triggerReason,
        eventTriggered,
        forceUniverseOffline,
        settledAt,
      ));
      this.snapshotDirty = true;
      const snapshot = this.buildSnapshot();
      this.emit("status", snapshot);
      return snapshot;
    } finally {
      this.universeScanInProgress = false;
    }
  }

  settleSseRecoveryWindow(now = new Date()): RadarStatus {
    const liveStatuses = this.services.map((service) => service.getStatus());
    const completeStreamingWindow = liveStatuses.every((status) => (
      status.marketFeedState === "streaming"
      && (status.connectionState === "connected" || status.connectionState === "streaming")
      && status.network.heartbeatFresh
      && status.liveIngestion.conditions.quoteFresh
      && status.liveIngestion.conditions.tradeFresh
      && status.liveIngestion.conditions.volumeFresh
    ));
    if (!completeStreamingWindow) {
      this.requestUniverseScan("sse_recovery", false);
      return this.getStatus();
    }
    return this.runUniverseScan("sse_recovery", false, true);
  }

  getStatus(): RadarStatus {
    if (!this.snapshot) return this.buildSnapshot();
    if (this.snapshotDirty) this.queueSnapshotBuild();
    return this.snapshot;
  }

  private markSnapshotDirty(): void {
    this.snapshotDirty = true;
    this.queueSnapshotBuild();
  }

  private nextStatusRevision(): number {
    return ++this.statusRevision;
  }

  private queueSnapshotBuild(): void {
    if (this.snapshotBuildQueued || this.snapshotBuildInProgress) return;
    this.snapshotBuildQueued = true;
    queueMicrotask(() => {
      this.snapshotBuildQueued = false;
      if (!this.snapshotDirty || this.snapshotBuildInProgress) return;
      this.emit("status", this.buildSnapshot());
    });
  }

  private buildSnapshot(): RadarStatus {
    if (this.snapshotBuildInProgress) {
      if (this.snapshot) return this.snapshot;
      throw new Error("Radar status snapshot build re-entered before an initial snapshot existed.");
    }
    this.snapshotBuildInProgress = true;
    this.snapshotDirty = false;
    try {
    const statuses = this.settledStatuses;
    const primary = statuses.find((status) => status.symbol === "NVDA") ?? statuses[0];
    const symbolRadars = statuses.map(toSymbolStatus);
    const universeMarketFeedState: MarketFeedState = statuses.some(
      (status) => status.marketFeedState === "streaming",
    )
      ? "streaming"
      : statuses.some((status) => status.marketFeedState === "stale")
        ? "stale"
        : "offline";
    const now = new Date();
    this.aiIndustryLeaderProbe.observe(
      statuses,
      (leader, protectedStatuses) => this.focusedScans.routeVerifiedMarketLeader(leader, protectedStatuses, now),
      now,
    );
    const rankingResult = updateAlphaRadarRanking(symbolRadars, this.rankingMachine, now);
    this.rankingMachine = rankingResult.machine;
    const focusedSectorSymbols = this.focusedScans.getSectorSymbols();
    // Only the bounded, independently verified non-protected focused scans
    // may propose live pool enrichment. Protected radars never feed this path.
    aiIndustryStockPool.considerPrequalifiedLiveCandidates(focusedSectorSymbols.map((status) => ({
      symbol: status.symbol,
      marketFeedState: status.marketFeedState,
      preBreakoutState: status.alphaRadar.preBreakout.state,
      confirmationStatus: status.alphaRadar.preBreakout.confirmation.status,
    })));
    const sectorSymbolsByName = new Map<string, RadarSymbolStatus>();
    [...symbolRadars, ...focusedSectorSymbols].forEach((status) => {
      if (!sectorSymbolsByName.has(status.symbol)) sectorSymbolsByName.set(status.symbol, status);
    });
    const sectorSymbols = [...sectorSymbolsByName.values()];
    const sectorRankingResult = updateAlphaRadarRanking(
      sectorSymbols,
      this.sectorRankingMachine,
      now,
    );
    this.sectorRankingMachine = sectorRankingResult.machine;
    const leader = rankingResult.snapshot.leaderSymbol
      ? symbolRadars.find((status) => status.symbol === rankingResult.snapshot.leaderSymbol)
      : null;

    const marketUniverseSnapshot = marketUniverse.getSummary(now);
    const opportunityData = buildOpportunityCenter(
      statuses.map((status) => ({
        scanId: status.scanId,
        symbol: status.symbol,
        alphaRadar: status.alphaRadar,
        marketFeedState: status.marketFeedState,
        scanHealth: status.scanHealth,
        marketWindowSettlement: status.marketWindowSettlement,
        reference: marketUniverse.getSecurity(status.symbol, now),
      })),
      statuses.map((status) => ({
        symbol: status.symbol,
        reference: marketUniverse.getSecurity(status.symbol, now),
      })),
      now,
    );
    const sectorPriority = buildSectorPriority({
      symbols: symbolRadars,
      additionalLiveSymbols: focusedSectorSymbols,
      alphaRanking: sectorRankingResult.snapshot,
      references: sectorSymbols.map((status) => ({
        symbol: status.symbol,
        reference: marketUniverse.getSecurity(status.symbol, now),
      })),
      catalystRadar: opportunityData.catalystRadar,
      referenceFresh:
        marketUniverseSnapshot.freshness === "fresh"
        && marketUniverseSnapshot.dataQuality === "good",
      now,
    });
    const openingReadiness = buildOpeningReadiness({
      symbols: symbolRadars,
      marketUniverse: marketUniverseSnapshot,
      sectorPriority,
      now,
    });

    const snapshot: RadarStatus = {
      ...primary,
      marketFeedState: universeMarketFeedState,
      statusEpoch: this.statusEpoch,
      statusRevision: this.nextStatusRevision(),
      symbolRadars,
      alphaRanking: rankingResult.snapshot,
      marketUniverse: marketUniverseSnapshot,
      focusedScans: this.focusedScans.getStatus(statuses),
      catalystRadar: opportunityData.catalystRadar,
      opportunityCenter: opportunityData.opportunityCenter,
      sectorPriority,
      openingReadiness,
      preBreakoutLeader: leader
        ? {
            symbol: leader.symbol,
            state: leader.alphaRadar.preBreakout.state,
            confirmationStatus: leader.alphaRadar.preBreakout.confirmation.status,
            alphaVelocity: leader.alphaRadar.alphaVelocity.rate30s,
          }
        : null,
    };
    this.snapshot = snapshot;
    return snapshot;
    } finally {
      this.snapshotBuildInProgress = false;
      if (this.snapshotDirty) this.queueSnapshotBuild();
    }
  }

  /**
   * Governance consumers must use this rather than getStatus(). The status
   * endpoint advances ranking hysteresis as part of its live presentation,
   * while this method is a pure read of scheduler ownership/capacity signals.
   */
  getEngineeringScannerHealth(now = new Date()): EngineeringScannerHealth[] {
    return this.services.map((service) => service.getEngineeringScannerHealth(now));
  }

  getLifelineHealth(now = new Date()): DatabentoLifelineSymbolHealth[] {
    return this.services.map((service) => service.getLifelineHealth(now));
  }

  start(): RadarStatus {
    this.aiIndustryLeaderProbe.start();
    this.universeScanSchedulerActive = true;
    this.services.forEach((service) => service.setUniverseScanSchedule(true, null));
    this.services.forEach((service) => service.start());
    return this.runUniverseScan("stream_started", false);
  }

  stop(): RadarStatus {
    this.universeScanSchedulerActive = false;
    this.clearUniverseScanTimer();
    this.aiIndustryLeaderProbe.stop();
    this.focusedScans.stop();
    this.services.forEach((service) => service.stop());
    const settledAt = new Date();
    this.currentScanId = randomUUID();
    this.settledStatuses = this.services.map((service) => service.settleUniverseScan(
      this.currentScanId,
      "stream_stopped",
      false,
      true,
      settledAt,
    ));
    this.snapshotDirty = true;
    const snapshot = this.buildSnapshot();
    this.emit("status", snapshot);
    return snapshot;
  }

  getFocusedScanStatus(): FocusedScanSnapshot {
    return this.focusedScans.getStatus(this.settledStatuses);
  }

  getCatalystRadar(): CatalystRadarSnapshot {
    return this.getStatus().catalystRadar!;
  }

  getOpportunityCenter(): OpportunityCenterSnapshot {
    return this.getStatus().opportunityCenter!;
  }
}

export const databentoLive = new DatabentoUniverseService();