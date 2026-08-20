export type SignalFreshness = "fresh" | "delayed" | "stale" | "missing";
export type SignalDataQuality = "good" | "degraded" | "stale" | "missing";
export type AlphaRadarSignalState = "Neutral" | "Watch" | "Breakout Setup";
export type AlphaRadarScoreState = "available" | "stale" | "insufficient";

export type QuoteObservation = {
  timestamp: Date;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
};

export type TradeObservation = {
  timestamp: Date;
  price: number;
  size: number;
  side: string | null;
};

export type BarObservation = {
  timestamp: Date;
  close: number | null;
  volume: number | null;
};

export type RadarSignalMetric = {
  value: number | null;
  unit: string;
  score: number | null;
  observedAt: Date | null;
  freshnessMs: number | null;
  freshness: SignalFreshness;
  available: boolean;
  scoreEligible: boolean;
  referenceValue: number | null;
  referenceLabel: string | null;
  source: string;
};

export type AlphaRadarDiagnostics = {
  fresh_quotes: number;
  fresh_trades: number;
  fresh_prices: number;
  fresh_volume: number;
  valid_window_age: number | null;
  scoring_gate_reason: string;
};

export type AlphaRadarScanMode = "normal" | "pre_open" | "opening";

export type AlphaRadarScanMetadata = {
  /** Null until this symbol has completed a real local scan in this process. */
  lastScannedAt: Date | null;
  scanIntervalMs: number;
  scanMode: AlphaRadarScanMode;
  triggerReason: string;
  eventTriggered: boolean;
};

export type AlphaVelocity = {
  delta30s: number | null;
  delta60s: number | null;
  rate30s: number | null;
  rate60s: number | null;
};

export type AlphaChangeIndicators = {
  momentumAcceleration: number | null;
  volumeAcceleration: number | null;
  orderFlowShift: number | null;
  spreadTightening: number | null;
};

export type AlphaRadarTimeframeDirection = "supportive" | "weakening" | "mixed" | "unavailable";

export type AlphaRadarTimeframeContext = {
  windowMs: number;
  sampleCount: number;
  score: number | null;
  momentumScore: number | null;
  volumeScore: number | null;
  orderFlowScore: number | null;
  spreadScore: number | null;
  direction: AlphaRadarTimeframeDirection;
  available: boolean;
  reason: string;
};

export type AlphaRadarMultiTimeframeContext = {
  short: AlphaRadarTimeframeContext;
  medium: AlphaRadarTimeframeContext;
  higher: AlphaRadarTimeframeContext;
  alignment: "aligned" | "mixed" | "conflicted" | "unavailable";
  reason: string;
};

export type DataConfidenceState = "high" | "adequate" | "low" | "unavailable";

export type AlphaRadarDataConfidence = {
  score: number | null;
  state: DataConfidenceState;
  completeness: number | null;
  freshness: number | null;
  stability: number | null;
  evidenceConsistency: number | null;
  reason: string;
};

export type AlphaRadarCounterEvidenceKey =
  | "sector_or_market_weakness"
  | "selling_pressure"
  | "price_volume_divergence"
  | "breakout_failure"
  | "structural_support_loss";

export type AlphaRadarCounterEvidence = {
  key: AlphaRadarCounterEvidenceKey;
  label: string;
  available: boolean;
  opposesSignal: boolean;
  detail: string;
};

export type AlphaRadarCounterEvidenceAssessment = {
  strength: "none" | "moderate" | "strong" | "unavailable";
  blocksHighGradeUpgrade: boolean;
  evidence: AlphaRadarCounterEvidence[];
  reasons: string[];
  reason: string;
};

export type PreBreakoutDetectionState =
  | "unavailable"
  | "watch"
  | "latent"
  | "breakout_critical"
  | "confirmed";

export type PreBreakoutConfirmationStatus =
  | "unavailable"
  | "pending"
  | "confirmed"
  | "rejected";

export type PreBreakoutConfirmationEvidenceKey =
  | "price_momentum"
  | "volume_acceleration"
  | "order_flow_pressure"
  | "spread_tightening"
  | "alpha_velocity"
  | "score_strength"
  | "trajectory_persistence";

export type PreBreakoutConfirmationEvidence = {
  key: PreBreakoutConfirmationEvidenceKey;
  label: string;
  satisfied: boolean;
  detail: string;
};

export type PreBreakoutConfirmation = {
  status: PreBreakoutConfirmationStatus;
  evidence: PreBreakoutConfirmationEvidence[];
  satisfiedEvidence: string[];
  missingEvidence: string[];
  persistenceScans: number;
  requiredPersistenceScans: number;
  evaluatedAt: Date;
  reason: string;
};

export type PreBreakoutDetection = {
  state: PreBreakoutDetectionState;
  /** 0–100 score from fresh, observed pre-breakout behavior only. */
  latentScore: number | null;
  /** 0–100 score for the transition from latent behavior toward breakout. */
  breakoutCriticalScore: number | null;
  evidenceCount: number;
  velocityGateSatisfied: boolean;
  reasons: string[];
  deteriorationReasons: string[];
  transitionEvidenceCount: number;
  transitionReasons: string[];
  lastTransitionAt: Date | null;
  lastEvaluatedAt: Date;
  dataFresh: boolean;
  cooldownRemainingMs: number | null;
  confirmation: PreBreakoutConfirmation;
};

export type PreBreakoutStateMachine = {
  state: PreBreakoutDetectionState;
  pendingState: PreBreakoutDetectionState | null;
  pendingCount: number;
  lastTransitionAt: Date | null;
  lastTransitionEvidenceCount: number;
  lastTransitionReasons: string[];
  confirmationPersistenceScans: number;
};

export type PostBreakoutState =
  | "unavailable"
  | "trend_continuation"
  | "take_profit_watch"
  | "trend_reversal_confirmed";

export type PostBreakoutMonitoring = {
  state: PostBreakoutState;
  /** True only after a confirmed Alpha state crosses a real, observed prior high. */
  active: boolean;
  dataFresh: boolean;
  breakoutPrice: number | null;
  highSinceBreakout: number | null;
  drawdownFromHighPercent: number | null;
  latestPrice: number | null;
  activeBuyPressure: number | null;
  l1BidPressure: number | null;
  volumeAcceleration: number | null;
  tradeRateChange: number | null;
  supportReasons: string[];
  deteriorationReasons: string[];
  consecutiveWeakScans: number;
  consecutiveReversalScans: number;
  lastTransitionAt: Date | null;
  lastEvaluatedAt: Date;
  reason: string;
};

export type PostBreakoutStateMachine = {
  active: boolean;
  state: PostBreakoutState;
  breakoutPrice: number | null;
  highSinceBreakout: number | null;
  consecutiveWeakScans: number;
  consecutiveReversalScans: number;
  lastTransitionAt: Date | null;
};

export type AlphaRadarSnapshot = {
  score: number | null;
  status: AlphaRadarSignalState | null;
  scoreState: AlphaRadarScoreState;
  /** Opportunity strength only. Data quality is tracked independently below. */
  confidence: number;
  dataConfidence: AlphaRadarDataConfidence;
  dataQuality: SignalDataQuality;
  generatedAt: Date;
  warnings: string[];
  diagnostics: AlphaRadarDiagnostics;
  scan: AlphaRadarScanMetadata;
  alphaVelocity: AlphaVelocity;
  changeIndicators: AlphaChangeIndicators;
  multiTimeframe: AlphaRadarMultiTimeframeContext;
  counterEvidence: AlphaRadarCounterEvidenceAssessment;
  preBreakoutWatch: boolean;
  preBreakout: PreBreakoutDetection;
  postBreakout: PostBreakoutMonitoring;
  momentum: RadarSignalMetric;
  spread: RadarSignalMetric;
  volumeIntensity: RadarSignalMetric;
  orderFlowPressure: RadarSignalMetric;
  unusualActivity: RadarSignalMetric & { detected: boolean };
};

export type AlphaRadarInput = {
  now: Date;
  connectionState: string;
  quotes: QuoteObservation[];
  trades: TradeObservation[];
  bars: BarObservation[];
};

export type AlphaRadarHistoryPoint = {
  generatedAt: Date;
  score: number;
  momentumScore: number;
  volumeScore: number;
  orderFlowScore: number;
  spreadScore: number;
};

export type AlphaRadarSignalHistoryEntry = {
  occurredAt: Date;
  fromState: PreBreakoutDetectionState;
  toState: PreBreakoutDetectionState;
  fromConfirmationStatus: PreBreakoutConfirmationStatus;
  toConfirmationStatus: PreBreakoutConfirmationStatus;
  score: number | null;
  confidence: number;
  alphaVelocity: number | null;
  evidenceCount: number;
  satisfiedEvidence: string[];
  missingEvidence: string[];
  dataFresh: boolean;
  reason: string;
};

export type AlphaRadarScanContext = {
  lastScannedAt: Date;
  scanIntervalMs: number;
  scanMode: AlphaRadarScanMode;
  triggerReason: string;
  eventTriggered: boolean;
};

const PRE_BREAKOUT_CONFIRMATION_SCANS = 2;
const PRE_BREAKOUT_COOLDOWN_MS = 10_000;
const MULTI_FACTOR_CONFIRMATION_SCANS = 3;
export const MAX_SIGNAL_HISTORY_ENTRIES = 24;

const SHORT_WINDOW_MS = 30_000;
const MEDIUM_CONTEXT_WINDOW_MS = 60_000;
const BASELINE_WINDOW_MS = 300_000;
const FRESH_MS = 15_000;
const DELAYED_MS = 60_000;
const MIN_VOLUME_OBSERVATIONS = 2;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function validDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function sortedRecent<T extends { timestamp: Date }>(items: T[]): T[] {
  return items
    .filter((item) => validDate(item.timestamp))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

function observationIsFresh(timestamp: Date, now: Date): boolean {
  if (!validDate(timestamp)) return false;
  const ageMs = now.getTime() - timestamp.getTime();
  return ageMs >= 0 && ageMs <= FRESH_MS;
}

function observationIsInRollingWindow(timestamp: Date, now: Date): boolean {
  if (!validDate(timestamp)) return false;
  const ageMs = now.getTime() - timestamp.getTime();
  return ageMs >= 0 && ageMs <= BASELINE_WINDOW_MS;
}

function metricFreshness(observedAt: Date | null, now: Date): Pick<RadarSignalMetric, "freshness" | "freshnessMs"> {
  if (!observedAt || !validDate(observedAt)) {
    return { freshness: "missing", freshnessMs: null };
  }
  const freshnessMs = Math.max(0, now.getTime() - observedAt.getTime());
  if (freshnessMs <= FRESH_MS) return { freshness: "fresh", freshnessMs };
  if (freshnessMs <= DELAYED_MS) return { freshness: "delayed", freshnessMs };
  return { freshness: "stale", freshnessMs };
}

function unavailableMetric(unit: string, source: string, now: Date): RadarSignalMetric {
  return {
    value: null,
    unit,
    score: null,
    observedAt: null,
    ...metricFreshness(null, now),
    available: false,
    scoreEligible: false,
    referenceValue: null,
    referenceLabel: null,
    source,
  };
}

function makeMetric(
  value: number | null,
  unit: string,
  score: number | null,
  observedAt: Date | null,
  source: string,
  now: Date,
  referenceValue: number | null = null,
  referenceLabel: string | null = null,
): RadarSignalMetric {
  const normalizedValue = value === null || !Number.isFinite(value) ? null : round(value);
  const normalizedScore = score === null || !Number.isFinite(score) ? null : round(clamp(score), 0);
  const freshness = metricFreshness(observedAt, now);
  const scoreEligible =
    normalizedValue !== null
    && normalizedScore !== null
    && freshness.freshness === "fresh";

  return {
    value: normalizedValue,
    unit,
    score: scoreEligible ? normalizedScore : null,
    observedAt,
    ...freshness,
    available: normalizedValue !== null,
    scoreEligible,
    referenceValue: referenceValue === null || !Number.isFinite(referenceValue) ? null : round(referenceValue),
    referenceLabel,
    source,
  };
}

function quoteMidpoint(quote: QuoteObservation): number | null {
  if (quote.bidPrice === null || quote.askPrice === null || quote.bidPrice <= 0 || quote.askPrice <= 0) {
    return null;
  }
  return (quote.bidPrice + quote.askPrice) / 2;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function getWindow<T extends { timestamp: Date }>(items: T[], start: number, end: number): T[] {
  return items.filter((item) => {
    const timestamp = item.timestamp.getTime();
    return timestamp > start && timestamp <= end;
  });
}

function emptyAlphaVelocity(): AlphaVelocity {
  return {
    delta30s: null,
    delta60s: null,
    rate30s: null,
    rate60s: null,
  };
}

function emptyChangeIndicators(): AlphaChangeIndicators {
  return {
    momentumAcceleration: null,
    volumeAcceleration: null,
    orderFlowShift: null,
    spreadTightening: null,
  };
}

function unavailableTimeframe(windowMs: number, reason: string): AlphaRadarTimeframeContext {
  return {
    windowMs,
    sampleCount: 0,
    score: null,
    momentumScore: null,
    volumeScore: null,
    orderFlowScore: null,
    spreadScore: null,
    direction: "unavailable",
    available: false,
    reason,
  };
}

function unavailableMultiTimeframe(reason: string): AlphaRadarMultiTimeframeContext {
  return {
    short: unavailableTimeframe(SHORT_WINDOW_MS, reason),
    medium: unavailableTimeframe(MEDIUM_CONTEXT_WINDOW_MS, reason),
    higher: unavailableTimeframe(BASELINE_WINDOW_MS, reason),
    alignment: "unavailable",
    reason,
  };
}

function unavailableDataConfidence(reason: string): AlphaRadarDataConfidence {
  return {
    score: null,
    state: "unavailable",
    completeness: null,
    freshness: null,
    stability: null,
    evidenceConsistency: null,
    reason,
  };
}

function unavailableCounterEvidence(reason: string): AlphaRadarCounterEvidenceAssessment {
  return {
    strength: "unavailable",
    blocksHighGradeUpgrade: true,
    evidence: [],
    reasons: [],
    reason,
  };
}

function unavailableConfirmation(
  now: Date,
  reason = "Confirmation is unavailable until a complete fresh live window is rebuilt.",
): PreBreakoutConfirmation {
  return {
    status: "unavailable",
    evidence: [],
    satisfiedEvidence: [],
    missingEvidence: [
      "Fresh price momentum",
      "Volume acceleration",
      "Order-flow pressure",
      "Spread tightening",
      "Positive Alpha Velocity",
      "Alpha score strength",
      "Persistent multi-scan trajectory",
    ],
    persistenceScans: 0,
    requiredPersistenceScans: MULTI_FACTOR_CONFIRMATION_SCANS,
    evaluatedAt: now,
    reason,
  };
}

function unavailablePreBreakout(now: Date): PreBreakoutDetection {
  return {
    state: "unavailable",
    latentScore: null,
    breakoutCriticalScore: null,
    evidenceCount: 0,
    velocityGateSatisfied: false,
    reasons: [],
    deteriorationReasons: [],
    transitionEvidenceCount: 0,
    transitionReasons: [],
    lastTransitionAt: null,
    lastEvaluatedAt: now,
    dataFresh: false,
    cooldownRemainingMs: null,
    confirmation: unavailableConfirmation(now),
  };
}

export function unavailablePostBreakout(
  now: Date,
  reason = "Post-breakout monitoring is unavailable until a confirmed, fresh live breakout is observed.",
): PostBreakoutMonitoring {
  return {
    state: "unavailable",
    active: false,
    dataFresh: false,
    breakoutPrice: null,
    highSinceBreakout: null,
    drawdownFromHighPercent: null,
    latestPrice: null,
    activeBuyPressure: null,
    l1BidPressure: null,
    volumeAcceleration: null,
    tradeRateChange: null,
    supportReasons: [],
    deteriorationReasons: [],
    consecutiveWeakScans: 0,
    consecutiveReversalScans: 0,
    lastTransitionAt: null,
    lastEvaluatedAt: now,
    reason,
  };
}

export function appendSignalHistoryEntry(
  history: AlphaRadarSignalHistoryEntry[],
  entry: AlphaRadarSignalHistoryEntry,
  maximumEntries = MAX_SIGNAL_HISTORY_ENTRIES,
): AlphaRadarSignalHistoryEntry[] {
  const lastEntry = history.at(-1);
  if (lastEntry && entry.occurredAt.getTime() < lastEntry.occurredAt.getTime()) {
    return history;
  }
  if (
    lastEntry
    && lastEntry.toState === entry.toState
    && lastEntry.toConfirmationStatus === entry.toConfirmationStatus
  ) {
    return history;
  }
  return [...history, entry].slice(-Math.max(1, maximumEntries));
}

function changeRate(current: number, previous: number, elapsedMs: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || elapsedMs <= 0) return null;
  return round(((current - previous) / elapsedMs) * 60_000, 2);
}

function historyPointAtOrBefore(
  history: AlphaRadarHistoryPoint[],
  targetMs: number,
): AlphaRadarHistoryPoint | null {
  return [...history]
    .reverse()
    .find((point) => point.generatedAt.getTime() <= targetMs) ?? null;
}

function averageHistoryValue(points: AlphaRadarHistoryPoint[], key: keyof Omit<AlphaRadarHistoryPoint, "generatedAt">): number | null {
  if (points.length === 0) return null;
  return round(sum(points.map((point) => point[key])) / points.length);
}

function timeframeContext(
  points: AlphaRadarHistoryPoint[],
  nowMs: number,
  windowMs: number,
): AlphaRadarTimeframeContext {
  const inWindow = points.filter((point) => point.generatedAt.getTime() > nowMs - windowMs);
  if (inWindow.length < 2) {
    return unavailableTimeframe(
      windowMs,
      `Awaiting at least two complete live scans across the ${Math.round(windowMs / 1000)}s context window.`,
    );
  }
  const first = inWindow[0];
  const last = inWindow.at(-1)!;
  const scoreDelta = last.score - first.score;
  const componentDeltas = [
    last.momentumScore - first.momentumScore,
    last.volumeScore - first.volumeScore,
    last.orderFlowScore - first.orderFlowScore,
    last.spreadScore - first.spreadScore,
  ];
  const positive = componentDeltas.filter((delta) => delta >= 1).length;
  const negative = componentDeltas.filter((delta) => delta <= -1).length;
  const direction: AlphaRadarTimeframeDirection =
    scoreDelta >= 1 && positive >= negative ? "supportive"
      : scoreDelta <= -1 && negative > positive ? "weakening"
        : "mixed";
  return {
    windowMs,
    sampleCount: inWindow.length,
    score: averageHistoryValue(inWindow, "score"),
    momentumScore: averageHistoryValue(inWindow, "momentumScore"),
    volumeScore: averageHistoryValue(inWindow, "volumeScore"),
    orderFlowScore: averageHistoryValue(inWindow, "orderFlowScore"),
    spreadScore: averageHistoryValue(inWindow, "spreadScore"),
    direction,
    available: true,
    reason: direction === "supportive"
      ? "Existing Alpha components are strengthening across this observed context."
      : direction === "weakening"
        ? "Existing Alpha components are weakening across this observed context."
        : "Existing Alpha components are mixed across this observed context.",
  };
}

function multiTimeframeContext(
  history: AlphaRadarHistoryPoint[],
  current: AlphaRadarHistoryPoint,
): AlphaRadarMultiTimeframeContext {
  const allPoints = [...history, current];
  const nowMs = current.generatedAt.getTime();
  const short = timeframeContext(allPoints, nowMs, SHORT_WINDOW_MS);
  const medium = timeframeContext(allPoints, nowMs, MEDIUM_CONTEXT_WINDOW_MS);
  const higher = timeframeContext(allPoints, nowMs, BASELINE_WINDOW_MS);
  if (!short.available || !medium.available || !higher.available) {
    return {
      short,
      medium,
      higher,
      alignment: "unavailable",
      reason: "A short, medium, or higher observed context is still rebuilding; no high-grade upgrade may rely on a single window.",
    };
  }
  const directions = [short.direction, medium.direction, higher.direction];
  const alignment = (
    short.direction === "supportive"
    && medium.direction !== "weakening"
    && higher.direction !== "weakening"
  )
    ? "aligned"
    : directions.includes("supportive") && directions.includes("weakening")
      ? "conflicted"
      : "mixed";
  return {
    short,
    medium,
    higher,
    alignment,
    reason: alignment === "aligned"
      ? "Short-window strength is not contradicted by the observed medium or higher structure."
      : alignment === "conflicted"
        ? "Observed timeframes disagree; a short-window move cannot independently justify a high-grade upgrade."
        : "Observed timeframes are mixed; additional consistent evidence is required for a high-grade upgrade.",
  };
}

function calculateDataConfidence(
  snapshot: AlphaRadarSnapshot,
  multiTimeframe: AlphaRadarMultiTimeframeContext,
): AlphaRadarDataConfidence {
  const components = [
    snapshot.momentum,
    snapshot.spread,
    snapshot.volumeIntensity,
    snapshot.orderFlowPressure,
  ];
  const completeness = Math.round(
    (components.filter((metric) => metric.available).length / components.length) * 100,
  );
  const freshness = Math.round(
    (components.filter((metric) => metric.freshness === "fresh").length / components.length) * 100,
  );
  if (snapshot.scoreState !== "available" || snapshot.dataQuality !== "good") {
    return unavailableDataConfidence(
      "Data Confidence is unavailable until a complete fresh live score window exists.",
    );
  }
  const stability = multiTimeframe.alignment === "aligned"
    ? 100
    : multiTimeframe.alignment === "mixed"
      ? 60
      : multiTimeframe.alignment === "conflicted"
        ? 25
        : 0;
  const consistency = components.filter((metric) => metric.scoreEligible).length === components.length
    ? 100
    : 0;
  const score = Math.round((completeness * 0.3) + (freshness * 0.3) + (stability * 0.25) + (consistency * 0.15));
  const state: DataConfidenceState = score >= 85 ? "high" : score >= 65 ? "adequate" : "low";
  return {
    score,
    state,
    completeness,
    freshness,
    stability,
    evidenceConsistency: consistency,
    reason: state === "high"
      ? "Complete, fresh, stable, and cross-context-consistent evidence is available."
      : state === "adequate"
        ? "The live window is complete and fresh, but cross-context stability is not yet high."
        : "The live window is present, but evidence stability or agreement is too low for a high-grade upgrade.",
  };
}

function evaluateCounterEvidence(snapshot: AlphaRadarSnapshot): AlphaRadarCounterEvidenceAssessment {
  const sellingPressure = (
    (snapshot.orderFlowPressure.value !== null && snapshot.orderFlowPressure.value <= -10)
    || (snapshot.changeIndicators.orderFlowShift !== null && snapshot.changeIndicators.orderFlowShift <= -1)
  );
  const priceVolumeDivergence = (
    snapshot.changeIndicators.momentumAcceleration !== null
    && snapshot.changeIndicators.momentumAcceleration >= 1
    && snapshot.changeIndicators.volumeAcceleration !== null
    && snapshot.changeIndicators.volumeAcceleration <= -1
  );
  const post = snapshot.postBreakout;
  const breakoutFailureAvailable = post.active && post.breakoutPrice !== null && post.latestPrice !== null;
  const breakoutFailure = breakoutFailureAvailable && post.latestPrice! < post.breakoutPrice!;
  const supportLossAvailable = post.active;
  const supportLoss = supportLossAvailable && (
    post.state === "take_profit_watch" || post.state === "trend_reversal_confirmed"
  );
  const evidence: AlphaRadarCounterEvidence[] = [
    {
      key: "sector_or_market_weakness",
      label: "Sector / market weakening",
      available: false,
      opposesSignal: false,
      detail: "No independent live sector or market-index evidence is available in this symbol-level window; it is not inferred.",
    },
    {
      key: "selling_pressure",
      label: "Selling pressure",
      available: snapshot.orderFlowPressure.available || snapshot.changeIndicators.orderFlowShift !== null,
      opposesSignal: sellingPressure,
      detail: sellingPressure
        ? "Observed order-flow evidence shows active selling pressure or a worsening flow shift."
        : "No observed active-selling contradiction is present in the current live window.",
    },
    {
      key: "price_volume_divergence",
      label: "Price / volume divergence",
      available: snapshot.changeIndicators.momentumAcceleration !== null && snapshot.changeIndicators.volumeAcceleration !== null,
      opposesSignal: priceVolumeDivergence,
      detail: priceVolumeDivergence
        ? "Price momentum is improving while volume acceleration is weakening."
        : "No observed price-up/volume-down divergence is present.",
    },
    {
      key: "breakout_failure",
      label: "Breakout failure",
      available: breakoutFailureAvailable,
      opposesSignal: breakoutFailure,
      detail: breakoutFailureAvailable
        ? breakoutFailure
          ? "Price has fallen back below the real observed breakout price."
          : "Price remains at or above the real observed breakout price."
        : "A real post-breakout reference is not available yet.",
    },
    {
      key: "structural_support_loss",
      label: "Structural support loss",
      available: supportLossAvailable,
      opposesSignal: supportLoss,
      detail: supportLossAvailable
        ? supportLoss
          ? "Post-breakout buy, volume, trade-rate, or price structure is deteriorating."
          : "Observed post-breakout structure remains supportive."
        : "Post-breakout structure is not active yet.",
    },
  ];
  const opposed = evidence.filter((item) => item.available && item.opposesSignal);
  const strong = breakoutFailure || supportLoss || opposed.length >= 2;
  const moderate = opposed.length === 1;
  const strength = strong ? "strong" : moderate ? "moderate" : evidence.some((item) => item.available) ? "none" : "unavailable";
  return {
    strength,
    blocksHighGradeUpgrade: strong || snapshot.dataConfidence.state !== "high",
    evidence,
    reasons: opposed.map((item) => item.label),
    reason: strength === "strong"
      ? "Strong observed counter-evidence blocks a high-grade upgrade."
      : strength === "moderate"
        ? "Observed counter-evidence limits the next stage until it clears."
        : strength === "none"
          ? "No observed counter-evidence currently opposes the signal."
          : "Counter-evidence is incomplete; missing independent sources are not inferred.",
  };
}

export function addAlphaRadarDynamics(
  snapshot: AlphaRadarSnapshot,
  history: AlphaRadarHistoryPoint[],
  context: AlphaRadarScanContext,
): AlphaRadarSnapshot {
  const scan = {
    lastScannedAt: context.lastScannedAt,
    scanIntervalMs: context.scanIntervalMs,
    scanMode: context.scanMode,
    triggerReason: context.triggerReason,
    eventTriggered: context.eventTriggered,
  };
  const invalidDynamics = {
    scan,
    alphaVelocity: emptyAlphaVelocity(),
    changeIndicators: emptyChangeIndicators(),
    multiTimeframe: unavailableMultiTimeframe(
      "Cross-context evidence is unavailable until a complete fresh live score window is rebuilt.",
    ),
    dataConfidence: unavailableDataConfidence(
      "Data Confidence is unavailable until a complete fresh live score window is rebuilt.",
    ),
    counterEvidence: unavailableCounterEvidence(
      "Counter-evidence is unavailable until a complete fresh live score window is rebuilt.",
    ),
    preBreakoutWatch: false,
    preBreakout: unavailablePreBreakout(context.lastScannedAt),
    postBreakout: unavailablePostBreakout(context.lastScannedAt),
  };

  if (
    snapshot.scoreState !== "available"
    || snapshot.dataQuality !== "good"
    || snapshot.score === null
    || !snapshot.momentum.scoreEligible
    || !snapshot.volumeIntensity.scoreEligible
    || !snapshot.orderFlowPressure.scoreEligible
  ) {
    return { ...snapshot, ...invalidDynamics };
  }

  const nowMs = context.lastScannedAt.getTime();
  const current: AlphaRadarHistoryPoint = {
    generatedAt: context.lastScannedAt,
    score: snapshot.score,
    momentumScore: snapshot.momentum.score ?? 0,
    volumeScore: snapshot.volumeIntensity.score ?? 0,
    orderFlowScore: snapshot.orderFlowPressure.score ?? 0,
    spreadScore: snapshot.spread.score ?? 0,
  };
  const baseline30 = historyPointAtOrBefore(history, nowMs - 30_000);
  const baseline60 = historyPointAtOrBefore(history, nowMs - 60_000);
  const previous = history.at(-1) ?? null;
  const velocity = {
    delta30s: baseline30 ? round(current.score - baseline30.score, 2) : null,
    delta60s: baseline60 ? round(current.score - baseline60.score, 2) : null,
    rate30s: baseline30
      ? changeRate(current.score, baseline30.score, nowMs - baseline30.generatedAt.getTime())
      : null,
    rate60s: baseline60
      ? changeRate(current.score, baseline60.score, nowMs - baseline60.generatedAt.getTime())
      : null,
  };
  const indicators = {
    momentumAcceleration: previous
      ? changeRate(current.momentumScore, previous.momentumScore, nowMs - previous.generatedAt.getTime())
      : null,
    volumeAcceleration: previous
      ? changeRate(current.volumeScore, previous.volumeScore, nowMs - previous.generatedAt.getTime())
      : null,
    orderFlowShift: previous
      ? changeRate(current.orderFlowScore, previous.orderFlowScore, nowMs - previous.generatedAt.getTime())
      : null,
    spreadTightening: previous
      ? changeRate(current.spreadScore, previous.spreadScore, nowMs - previous.generatedAt.getTime())
      : null,
  };
  const improvingComponents = [
    indicators.momentumAcceleration,
    indicators.volumeAcceleration,
    indicators.orderFlowShift,
  ].filter((value): value is number => value !== null && value >= 1).length;
  const preBreakoutWatch =
    snapshot.status !== "Breakout Setup"
    && velocity.rate30s !== null
    && velocity.rate30s > 0
    && improvingComponents >= 2;
  const multiTimeframe = multiTimeframeContext(history, current);
  const snapshotWithTimeframes = {
    ...snapshot,
    multiTimeframe,
  };
  const dataConfidence = calculateDataConfidence(snapshotWithTimeframes, multiTimeframe);
  const counterEvidence = evaluateCounterEvidence({
    ...snapshotWithTimeframes,
    dataConfidence,
  });

  return {
    ...snapshot,
    ...invalidDynamics,
    alphaVelocity: velocity,
    changeIndicators: indicators,
    multiTimeframe,
    dataConfidence,
    counterEvidence,
    preBreakoutWatch,
    preBreakout: {
      state: preBreakoutWatch ? "latent" : "watch",
      latentScore: null,
      breakoutCriticalScore: null,
      evidenceCount: improvingComponents,
      velocityGateSatisfied: velocity.rate30s !== null && velocity.rate30s > 0,
      reasons: [],
      deteriorationReasons: [],
      transitionEvidenceCount: 0,
      transitionReasons: [],
      lastTransitionAt: null,
      lastEvaluatedAt: context.lastScannedAt,
      dataFresh: true,
      cooldownRemainingMs: null,
      confirmation: unavailableConfirmation(
        context.lastScannedAt,
        "Confirmation awaits the current state-machine evaluation.",
      ),
    },
  };
}

function detectionRank(state: PreBreakoutDetectionState): number {
  switch (state) {
    case "watch":
      return 0;
    case "latent":
      return 1;
    case "breakout_critical":
      return 2;
    case "confirmed":
      return 3;
    default:
      return -1;
  }
}

function stateAtRank(rank: number): Exclude<PreBreakoutDetectionState, "unavailable"> {
  return (["watch", "latent", "breakout_critical", "confirmed"] as const)[rank] ?? "watch";
}

/**
 * Scores only observable, fresh microstructure behavior. It intentionally does
 * not infer a low price, institutional ownership, depth-of-book activity, or
 * external fundamentals that EQUS.MINI cannot prove.
 */
function latentEvidence(snapshot: AlphaRadarSnapshot): string[] {
  const momentum = snapshot.momentum.value;
  const orderFlow = snapshot.orderFlowPressure.value;
  const { changeIndicators } = snapshot;
  return [
    momentum !== null && Math.abs(momentum) <= 0.35
      ? "Fresh short-window price remains unextended"
      : null,
    (snapshot.spread.score ?? 0) >= 60
      ? "Fresh quoted liquidity remains orderly"
      : null,
    orderFlow !== null && orderFlow >= -10
      ? "Observed sell pressure is not dominant"
      : null,
    changeIndicators.orderFlowShift !== null && changeIndicators.orderFlowShift >= 1
      ? "Observed buy pressure is improving"
      : null,
    (snapshot.volumeIntensity.score ?? 0) >= 50
      && changeIndicators.volumeAcceleration !== null
      && changeIndicators.volumeAcceleration >= 1
      ? "Observed participation is building"
      : null,
  ].filter((reason): reason is string => reason !== null);
}

function positiveEvidence(snapshot: AlphaRadarSnapshot): string[] {
  const { changeIndicators } = snapshot;
  return [
    changeIndicators.momentumAcceleration !== null && changeIndicators.momentumAcceleration >= 10
      ? "Momentum is accelerating"
      : null,
    changeIndicators.volumeAcceleration !== null && changeIndicators.volumeAcceleration >= 10
      ? "Volume intensity is accelerating"
      : null,
    changeIndicators.orderFlowShift !== null && changeIndicators.orderFlowShift >= 10
      ? "Order-flow pressure is improving"
      : null,
    changeIndicators.spreadTightening !== null && changeIndicators.spreadTightening >= 8
      ? "Quoted spread is tightening"
      : null,
  ].filter((reason): reason is string => reason !== null);
}

function deteriorationEvidence(snapshot: AlphaRadarSnapshot): string[] {
  const { changeIndicators } = snapshot;
  return [
    changeIndicators.momentumAcceleration !== null && changeIndicators.momentumAcceleration <= -10
      ? "Momentum is weakening"
      : null,
    changeIndicators.volumeAcceleration !== null && changeIndicators.volumeAcceleration <= -10
      ? "Volume intensity is weakening"
      : null,
    changeIndicators.orderFlowShift !== null && changeIndicators.orderFlowShift <= -10
      ? "Order-flow pressure is weakening"
      : null,
    changeIndicators.spreadTightening !== null && changeIndicators.spreadTightening <= -8
      ? "Quoted spread is widening"
      : null,
  ].filter((reason): reason is string => reason !== null);
}

function confirmationEvidence(
  snapshot: AlphaRadarSnapshot,
  persistenceScans: number,
): PreBreakoutConfirmationEvidence[] {
  const momentum = snapshot.changeIndicators.momentumAcceleration;
  const volume = snapshot.changeIndicators.volumeAcceleration;
  const orderFlow = snapshot.changeIndicators.orderFlowShift;
  const spread = snapshot.changeIndicators.spreadTightening;
  const velocity = snapshot.alphaVelocity.rate30s;
  const score = snapshot.score;
  return [
    {
      key: "price_momentum",
      label: "Fresh price momentum",
      satisfied: momentum !== null && momentum >= 10,
      detail: momentum === null
        ? "No eligible momentum acceleration is available."
        : `Momentum acceleration is ${round(momentum, 1)} pts/min; requires at least +10.`,
    },
    {
      key: "volume_acceleration",
      label: "Volume acceleration",
      satisfied: volume !== null && volume >= 10,
      detail: volume === null
        ? "No eligible volume acceleration is available."
        : `Volume acceleration is ${round(volume, 1)} pts/min; requires at least +10.`,
    },
    {
      key: "order_flow_pressure",
      label: "Order-flow pressure",
      satisfied: orderFlow !== null && orderFlow >= 10,
      detail: orderFlow === null
        ? "No eligible order-flow shift is available."
        : `Order-flow shift is ${round(orderFlow, 1)} pts/min; requires at least +10.`,
    },
    {
      key: "spread_tightening",
      label: "Spread tightening",
      satisfied: spread !== null && spread >= 8,
      detail: spread === null
        ? "No eligible spread change is available."
        : `Spread score change is ${round(spread, 1)} pts/min; requires at least +8.`,
    },
    {
      key: "alpha_velocity",
      label: "Positive Alpha Velocity",
      satisfied: velocity !== null && velocity >= 6,
      detail: velocity === null
        ? "No eligible 30-second Alpha Velocity is available."
        : `Alpha Velocity is ${round(velocity, 1)} pts/min; requires at least +6.`,
    },
    {
      key: "score_strength",
      label: "Alpha score strength",
      satisfied: score !== null && score >= 55,
      detail: score === null
        ? "No eligible Alpha score is available."
        : `Alpha score is ${round(score, 0)}; requires at least 55.`,
    },
    {
      key: "trajectory_persistence",
      label: "Persistent multi-scan trajectory",
      satisfied: persistenceScans >= MULTI_FACTOR_CONFIRMATION_SCANS,
      detail: `${persistenceScans} of ${MULTI_FACTOR_CONFIRMATION_SCANS} consecutive valid confirmation observations.`,
    },
  ];
}

function evaluateConfirmation(
  snapshot: AlphaRadarSnapshot,
  previousPersistenceScans: number,
  now: Date,
): PreBreakoutConfirmation {
  const provisionalEvidence = confirmationEvidence(snapshot, previousPersistenceScans);
  const directAndThresholdEvidence = provisionalEvidence.filter(
    (evidence) => evidence.key !== "trajectory_persistence",
  );
  const trajectoryContinues = directAndThresholdEvidence.every((evidence) => evidence.satisfied);
  const persistenceScans = trajectoryContinues ? previousPersistenceScans + 1 : 0;
  const evidence = confirmationEvidence(snapshot, persistenceScans);
  const satisfiedEvidence = evidence
    .filter((item) => item.satisfied)
    .map((item) => item.label);
  const missingEvidence = evidence
    .filter((item) => !item.satisfied)
    .map((item) => item.label);
  const directEvidenceCount = evidence
    .filter((item) =>
      item.key === "price_momentum"
      || item.key === "volume_acceleration"
      || item.key === "order_flow_pressure"
      || item.key === "spread_tightening",
    )
    .filter((item) => item.satisfied).length;
  const allSatisfied = missingEvidence.length === 0;
  const status: PreBreakoutConfirmationStatus = allSatisfied
    ? "confirmed"
    : directEvidenceCount >= 2 || trajectoryContinues
      ? "pending"
      : "rejected";
  const reason =
    status === "confirmed"
      ? `All confirmation factors persisted for ${persistenceScans} consecutive valid scans.`
      : status === "pending"
        ? trajectoryContinues
          ? `Converging evidence has persisted for ${persistenceScans} of ${MULTI_FACTOR_CONFIRMATION_SCANS} required scans.`
          : `Confirmation remains pending; missing ${missingEvidence.join(", ")}.`
        : `The current scan lacks converging independent evidence; missing ${missingEvidence.join(", ")}.`;

  return {
    status,
    evidence,
    satisfiedEvidence,
    missingEvidence,
    persistenceScans,
    requiredPersistenceScans: MULTI_FACTOR_CONFIRMATION_SCANS,
    evaluatedAt: now,
    reason,
  };
}

function candidateDetectionState(
  snapshot: AlphaRadarSnapshot,
  evidenceCount: number,
  latentScore: number,
  confirmation: PreBreakoutConfirmation,
): PreBreakoutDetectionState {
  const velocity = snapshot.alphaVelocity.rate30s ?? Number.NEGATIVE_INFINITY;
  const score = snapshot.score ?? Number.NEGATIVE_INFINITY;
  if (confirmation.status === "confirmed") return "confirmed";
  if (evidenceCount >= 3 && velocity >= 6 && score >= 55) return "breakout_critical";
  if (latentScore >= 80 && velocity >= 3 && score >= 50) return "latent";
  return "watch";
}

function qualityCappedCandidate(
  candidate: PreBreakoutDetectionState,
  confidence: AlphaRadarDataConfidence,
  counterEvidence: AlphaRadarCounterEvidenceAssessment,
): Exclude<PreBreakoutDetectionState, "unavailable"> {
  const candidateRank = detectionRank(candidate);
  const confidenceCap = confidence.state === "high"
    ? 3
    : confidence.state === "adequate"
      ? 2
      : confidence.state === "low"
        ? 1
        : 0;
  const counterCap = counterEvidence.strength === "strong"
    ? 0
    : counterEvidence.strength === "moderate"
      ? 1
      : 3;
  return stateAtRank(Math.min(candidateRank, confidenceCap, counterCap));
}

export function updatePreBreakoutDetection(
  snapshot: AlphaRadarSnapshot,
  machine: PreBreakoutStateMachine,
  now: Date,
): { snapshot: AlphaRadarSnapshot; machine: PreBreakoutStateMachine } {
  const isValid =
    snapshot.scoreState === "available"
    && snapshot.dataQuality === "good"
    && snapshot.score !== null
    && snapshot.momentum.scoreEligible
    && snapshot.volumeIntensity.scoreEligible
    && snapshot.orderFlowPressure.scoreEligible
    && snapshot.spread.scoreEligible;
  if (!isValid) {
    return {
      snapshot: {
        ...snapshot,
        preBreakoutWatch: false,
        preBreakout: unavailablePreBreakout(now),
      },
      machine: {
        state: "unavailable",
        pendingState: null,
        pendingCount: 0,
        lastTransitionAt: null,
        lastTransitionEvidenceCount: 0,
        lastTransitionReasons: [],
        confirmationPersistenceScans: 0,
      },
    };
  }

  const baseCounterEvidence = evaluateCounterEvidence(snapshot);
  const counterEvidence = {
    ...baseCounterEvidence,
    blocksHighGradeUpgrade: baseCounterEvidence.blocksHighGradeUpgrade || snapshot.dataConfidence.state !== "high",
  };
  const reasons = positiveEvidence(snapshot);
  const latentReasons = latentEvidence(snapshot);
  const latentScore = latentReasons.length * 20;
  const deteriorationReasons = deteriorationEvidence(snapshot);
  const confirmation = evaluateConfirmation(
    snapshot,
    machine.confirmationPersistenceScans ?? 0,
    now,
  );
  const ungatedCandidate = candidateDetectionState(snapshot, reasons.length, latentScore, confirmation);
  const candidate = qualityCappedCandidate(ungatedCandidate, snapshot.dataConfidence, counterEvidence);
  const priorState = machine.state === "unavailable" ? "watch" : machine.state;
  const priorRank = detectionRank(priorState);
  const candidateRank = detectionRank(candidate);
  const elapsedSinceTransition = machine.lastTransitionAt
    ? now.getTime() - machine.lastTransitionAt.getTime()
    : Number.POSITIVE_INFINITY;
  let nextState: Exclude<PreBreakoutDetectionState, "unavailable"> = priorState;
  let pendingState: PreBreakoutDetectionState | null = null;
  let pendingCount = 0;
  let lastTransitionAt = machine.lastTransitionAt;
  let lastTransitionEvidenceCount = machine.lastTransitionEvidenceCount;
  let lastTransitionReasons = machine.lastTransitionReasons;
  let cooldownRemainingMs: number | null = null;
  const confirmationHardCapRequired =
    confirmation.status !== "confirmed"
    && priorRank >= detectionRank("confirmed");

  if (confirmationHardCapRequired) {
    // Confirmation loss must never bypass the independent confidence and
    // counter-evidence cap. This is intentionally the quality-capped
    // candidate, rather than the raw predicate, so a previously confirmed
    // signal cannot degrade into an alertable high grade on weak evidence.
    nextState = candidate;
    pendingState = null;
    pendingCount = 0;
    lastTransitionAt = now;
    lastTransitionEvidenceCount = reasons.length;
    lastTransitionReasons = [
      ...deteriorationReasons,
      `Confirmation no longer met: ${confirmation.missingEvidence.join(", ")}`,
    ];
  } else if (machine.state === "unavailable") {
    nextState = "watch";
    lastTransitionAt = now;
    lastTransitionEvidenceCount = reasons.length;
    lastTransitionReasons = reasons;
  } else if (candidateRank > priorRank) {
    const oneStepCandidate = stateAtRank(Math.min(priorRank + 1, candidateRank));
    pendingState = machine.pendingState === oneStepCandidate ? oneStepCandidate : oneStepCandidate;
    pendingCount = machine.pendingState === oneStepCandidate ? machine.pendingCount + 1 : 1;
    if (pendingCount >= PRE_BREAKOUT_CONFIRMATION_SCANS) {
      nextState = oneStepCandidate;
      pendingState = null;
      pendingCount = 0;
      lastTransitionAt = now;
      lastTransitionEvidenceCount = reasons.length;
      lastTransitionReasons = reasons;
    }
  } else if (candidateRank < priorRank) {
    if (elapsedSinceTransition < PRE_BREAKOUT_COOLDOWN_MS) {
      cooldownRemainingMs = PRE_BREAKOUT_COOLDOWN_MS - elapsedSinceTransition;
    } else {
      const oneStepCandidate = stateAtRank(Math.max(priorRank - 1, candidateRank));
      pendingState = oneStepCandidate;
      pendingCount = machine.pendingState === oneStepCandidate ? machine.pendingCount + 1 : 1;
      if (pendingCount >= PRE_BREAKOUT_CONFIRMATION_SCANS) {
        nextState = oneStepCandidate;
        pendingState = null;
        pendingCount = 0;
        lastTransitionAt = now;
        lastTransitionEvidenceCount = deteriorationReasons.length;
        lastTransitionReasons = deteriorationReasons;
      }
    }
  }

  const detection: PreBreakoutDetection = {
    state: nextState,
    latentScore,
    breakoutCriticalScore: Math.min(
      100,
      Math.max(0, reasons.length * 20 + ((snapshot.alphaVelocity.rate30s ?? 0) >= 6 ? 20 : 0)),
    ),
    evidenceCount: reasons.length,
    velocityGateSatisfied: (snapshot.alphaVelocity.rate30s ?? Number.NEGATIVE_INFINITY) >= 3,
    reasons,
    deteriorationReasons: [
      ...deteriorationReasons,
      ...(counterEvidence.strength === "none" || counterEvidence.strength === "unavailable"
        ? []
        : counterEvidence.reasons.map((reason) => `Counter-evidence: ${reason}`)),
    ],
    transitionEvidenceCount: lastTransitionEvidenceCount,
    transitionReasons: lastTransitionReasons,
    lastTransitionAt,
    lastEvaluatedAt: now,
    dataFresh: true,
    cooldownRemainingMs,
    confirmation,
  };
  return {
    snapshot: {
      ...snapshot,
      preBreakoutWatch: nextState === "latent" || nextState === "breakout_critical" || nextState === "confirmed",
      preBreakout: detection,
      counterEvidence,
    },
    machine: {
      state: nextState,
      pendingState,
      pendingCount,
      lastTransitionAt,
      lastTransitionEvidenceCount,
      lastTransitionReasons,
      confirmationPersistenceScans: confirmation.persistenceScans,
    },
  };
}

/**
 * Tracks only a breakout that can be proven from the current fresh stream:
 * the confirmed Alpha state must cross a prior, independently observed rolling
 * high. It deliberately does not invent a target price or retain a stale trend.
 */
export function updatePostBreakoutMonitoring(
  snapshot: AlphaRadarSnapshot,
  machine: PostBreakoutStateMachine,
  input: AlphaRadarInput,
): { snapshot: AlphaRadarSnapshot; machine: PostBreakoutStateMachine } {
  const now = input.now;
  const prices = [
    ...input.trades.map((trade) => ({ timestamp: trade.timestamp, price: trade.price })),
    ...input.bars
      .filter((bar) => bar.close !== null && bar.close > 0)
      .map((bar) => ({ timestamp: bar.timestamp, price: bar.close as number })),
    ...input.quotes
      .map((quote) => ({ timestamp: quote.timestamp, price: quoteMidpoint(quote) }))
      .filter((point): point is { timestamp: Date; price: number } => point.price !== null),
  ].filter((point) => point.price > 0)
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const latest = prices.at(-1) ?? null;
  const fresh =
    snapshot.preBreakout.dataFresh
    && snapshot.scoreState === "available"
    && snapshot.dataQuality === "good"
    && latest !== null
    && observationIsFresh(latest.timestamp, now);

  if (!fresh || latest === null) {
    const resetMachine: PostBreakoutStateMachine = {
      active: false,
      state: "unavailable",
      breakoutPrice: null,
      highSinceBreakout: null,
      consecutiveWeakScans: 0,
      consecutiveReversalScans: 0,
      lastTransitionAt: null,
    };
    return {
      snapshot: {
        ...snapshot,
        postBreakout: unavailablePostBreakout(
          now,
          "Post-breakout monitoring is unavailable because the current market window is not fresh and complete; a new confirmed live breakout is required after recovery.",
        ),
        counterEvidence: evaluateCounterEvidence({
          ...snapshot,
          postBreakout: unavailablePostBreakout(
            now,
            "Post-breakout monitoring is unavailable because the current market window is not fresh and complete; a new confirmed live breakout is required after recovery.",
          ),
        }),
      },
      machine: resetMachine,
    };
  }

  const confirmed =
    snapshot.preBreakout.state === "confirmed"
    && snapshot.preBreakout.confirmation.status === "confirmed";
  const priorPrices = prices.filter((point) => (
    point.timestamp.getTime() <= latest.timestamp.getTime() - 5_000
  ));
  const priorHigh = priorPrices.length >= 4
    ? Math.max(...priorPrices.map((point) => point.price))
    : null;
  const newlyBroken =
    confirmed
    && priorHigh !== null
    && latest.price > priorHigh;

  if (!machine.active && !newlyBroken) {
    return {
      snapshot: {
        ...snapshot,
        postBreakout: {
          ...unavailablePostBreakout(
            now,
            !confirmed
              ? "Post-breakout monitoring waits for existing multi-factor breakout confirmation."
              : priorHigh === null
                ? "Post-breakout monitoring requires at least four prior, observed live prices to establish a real breakout reference."
                : "Confirmation is present, but price has not yet crossed the observed rolling high by the required margin.",
          ),
          latestPrice: latest.price,
        },
        counterEvidence: evaluateCounterEvidence({
          ...snapshot,
          postBreakout: {
            ...unavailablePostBreakout(
              now,
              !confirmed
                ? "Post-breakout monitoring waits for existing multi-factor breakout confirmation."
                : priorHigh === null
                  ? "Post-breakout monitoring requires at least four prior, observed live prices to establish a real breakout reference."
                  : "Confirmation is present, but price has not yet crossed the observed rolling high by the required margin.",
            ),
            latestPrice: latest.price,
          },
        }),
      },
      machine,
    };
  }

  const breakoutPrice = machine.breakoutPrice ?? priorHigh ?? latest.price;
  const highSinceBreakout = Math.max(machine.highSinceBreakout ?? breakoutPrice, latest.price);
  const drawdownFromHighPercent = highSinceBreakout > 0
    ? round(((latest.price - highSinceBreakout) / highSinceBreakout) * 100, 3)
    : null;
  const latestQuote = [...input.quotes]
    .filter((quote) => observationIsFresh(quote.timestamp, now))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    .at(-1) ?? null;
  const l1BidPressure = latestQuote
    && latestQuote.bidSize !== null
    && latestQuote.askSize !== null
    && latestQuote.bidSize + latestQuote.askSize > 0
    ? round(((latestQuote.bidSize - latestQuote.askSize) / (latestQuote.bidSize + latestQuote.askSize)) * 100, 2)
    : null;
  const recentTrades = getWindow(input.trades, now.getTime() - 30_000, now.getTime());
  const priorTrades = getWindow(input.trades, now.getTime() - 60_000, now.getTime() - 30_000);
  const tradeRateChange = priorTrades.length > 0
    ? round((recentTrades.length - priorTrades.length) / priorTrades.length, 3)
    : null;
  const buyPressure = snapshot.orderFlowPressure.value;
  const volumeAcceleration = snapshot.changeIndicators.volumeAcceleration;
  const priceMakingHigh = latest.price >= highSinceBreakout;
  const lostBreakout = latest.price < breakoutPrice;
  const supportReasons = [
    buyPressure !== null && buyPressure >= 0 ? "主动买盘未转弱" : null,
    l1BidPressure !== null && l1BidPressure >= 0 ? "L1 买盘不弱于卖盘" : null,
    volumeAcceleration !== null && volumeAcceleration >= 0 ? "成交量未衰竭" : null,
    tradeRateChange !== null && tradeRateChange >= 0 ? "成交速率未下降" : null,
    priceMakingHigh ? "价格仍在接近或刷新突破后高点" : null,
  ].filter((reason): reason is string => reason !== null);
  const deteriorationReasons = [
    buyPressure !== null && buyPressure <= -10 ? "主动买盘明显下降，卖方成交压力增强" : null,
    l1BidPressure !== null && l1BidPressure <= -20 ? "L1 卖盘压力增强" : null,
    volumeAcceleration !== null && volumeAcceleration <= -10 ? "成交量出现衰竭" : null,
    tradeRateChange !== null && tradeRateChange <= -0.3 ? "成交速率明显下降" : null,
    !priceMakingHigh ? "价格未能继续接近或刷新突破后高点" : null,
    lostBreakout ? "价格失守已确认的突破位" : null,
  ].filter((reason): reason is string => reason !== null);
  const weakNow = deteriorationReasons.length >= 2 || lostBreakout;
  const consecutiveWeakScans = weakNow ? machine.consecutiveWeakScans + 1 : 0;
  const reversalNow = (
    (lostBreakout && (buyPressure ?? 0) < 0)
    || deteriorationReasons.length >= 3
  );
  const consecutiveReversalScans = reversalNow ? machine.consecutiveReversalScans + 1 : 0;
  const nextState: PostBreakoutState =
    consecutiveReversalScans >= 2
      ? "trend_reversal_confirmed"
      : weakNow
        ? "take_profit_watch"
        : "trend_continuation";
  const transitioned = !machine.active || machine.state !== nextState;
  const lastTransitionAt = transitioned ? now : machine.lastTransitionAt;
  const reason = nextState === "trend_reversal_confirmed"
    ? "🔴 趋势反转/止盈确认：连续真实成交结构与突破位均显示反转。"
    : nextState === "take_profit_watch"
      ? "⚠️ 止盈/减仓关注：上涨过程的实时买盘、成交或价格结构正在转弱。"
      : "持有/趋势延续：当前上涨仍获得真实买盘、成交和 L1 结构支持。";
  const postBreakout: PostBreakoutMonitoring = {
    state: nextState,
    active: true,
    dataFresh: true,
    breakoutPrice,
    highSinceBreakout,
    drawdownFromHighPercent,
    latestPrice: latest.price,
    activeBuyPressure: buyPressure,
    l1BidPressure,
    volumeAcceleration,
    tradeRateChange,
    supportReasons,
    deteriorationReasons,
    consecutiveWeakScans,
    consecutiveReversalScans,
    lastTransitionAt,
    lastEvaluatedAt: now,
    reason,
  };
  return {
    snapshot: {
      ...snapshot,
      postBreakout,
      counterEvidence: evaluateCounterEvidence({ ...snapshot, postBreakout }),
    },
    machine: {
      active: true,
      state: nextState,
      breakoutPrice,
      highSinceBreakout,
      consecutiveWeakScans,
      consecutiveReversalScans,
      lastTransitionAt,
    },
  };
}

function calculateMomentum(input: AlphaRadarInput): RadarSignalMetric {
  const points = [
    ...sortedRecent(input.quotes)
      .map((quote) => ({ timestamp: quote.timestamp, price: quoteMidpoint(quote), source: "quote midpoint" }))
      .filter((point): point is { timestamp: Date; price: number; source: string } => point.price !== null),
    ...sortedRecent(input.trades)
      .map((trade) => ({ timestamp: trade.timestamp, price: trade.price, source: "trade price" })),
    ...sortedRecent(input.bars)
      .map((bar) => ({ timestamp: bar.timestamp, price: bar.close, source: "OHLCV close" }))
      .filter((point): point is { timestamp: Date; price: number; source: string } => point.price !== null),
  ].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  const freshPoints = points.filter((point) => observationIsFresh(point.timestamp, input.now));
  const latestFreshPoint = freshPoints.at(-1);
  const hasFreshReference = Boolean(
    latestFreshPoint
    && freshPoints.some((point) => point.timestamp.getTime() < latestFreshPoint.timestamp.getTime()),
  );
  const scoringPoints = hasFreshReference ? freshPoints : points;
  const latest = scoringPoints.at(-1);
  const priorPoints = latest
    ? scoringPoints.filter((point) => point.timestamp.getTime() < latest.timestamp.getTime())
    : [];
  if (!latest || priorPoints.length === 0) {
    return unavailableMetric("%", "Requires at least two live quote, trade, or bar prices.", input.now);
  }

  const targetTime = latest.timestamp.getTime() - SHORT_WINDOW_MS;
  const reference =
    [...priorPoints].reverse().find((point) => point.timestamp.getTime() <= targetTime)
    ?? priorPoints[0];
  if (!reference || reference.price <= 0) {
    return unavailableMetric("%", "Requires a prior price observation.", input.now);
  }

  const changePercent = ((latest.price - reference.price) / reference.price) * 100;
  const score = 50 + clamp((changePercent / 0.25) * 50, -50, 50);
  const metric = makeMetric(
    changePercent,
    "%",
    score,
    latest.timestamp,
    `Short-window ${latest.source} change`,
    input.now,
    reference.price,
    "window start price",
  );
  return hasFreshReference
    ? metric
    : withoutCurrentScore({
      ...metric,
      source:
        metric.freshness === "fresh"
          ? "Historical price reference retained for diagnosis; excluded from live momentum scoring"
          : metric.source,
    });
}

function calculateSpread(input: AlphaRadarInput): RadarSignalMetric {
  const quote = [...sortedRecent(input.quotes)]
    .reverse()
    .find((item) => observationIsFresh(item.timestamp, input.now) && quoteMidpoint(item) !== null);
  if (!quote) {
    return unavailableMetric("bps", "Requires a live bid and ask quote.", input.now);
  }

  const midpoint = quoteMidpoint(quote);
  if (!midpoint || quote.bidPrice === null || quote.askPrice === null) {
    return unavailableMetric("bps", "Requires a valid bid and ask quote.", input.now);
  }
  const spreadBps = ((quote.askPrice - quote.bidPrice) / midpoint) * 10_000;
  const score = 100 - spreadBps * 5;
  return makeMetric(spreadBps, "bps", score, quote.timestamp, "Best bid / ask spread", input.now, quote.askPrice - quote.bidPrice, "absolute spread");
}

function calculateVolumeIntensity(input: AlphaRadarInput): RadarSignalMetric {
  const nowMs = input.now.getTime();
  const bars = sortedRecent(input.bars).filter(
    (bar) =>
      observationIsInRollingWindow(bar.timestamp, input.now)
      && bar.volume !== null
      && bar.volume >= 0,
  );
  const trades = sortedRecent(input.trades).filter(
    (trade) => observationIsInRollingWindow(trade.timestamp, input.now) && trade.size >= 0,
  );
  const barVolume = sum(bars.map((bar) => bar.volume ?? 0));
  const tradeVolume = sum(trades.map((trade) => trade.size));
  const barsCanBaseline = bars.length >= MIN_VOLUME_OBSERVATIONS && barVolume > 0;
  const tradesCanBaseline = trades.length >= MIN_VOLUME_OBSERVATIONS && tradeVolume > 0;
  const useBars = barsCanBaseline || (!tradesCanBaseline && bars.length > 0);
  const observations = useBars ? bars : trades;

  if (observations.length === 0) {
    return unavailableMetric("x baseline", "Requires live OHLCV volume or trade sizes.", input.now);
  }

  const getVolume = (item: BarObservation | TradeObservation): number => "volume" in item ? item.volume ?? 0 : item.size;
  const recent = observations.filter((item) => {
    const timestamp = item.timestamp.getTime();
    return timestamp > nowMs - SHORT_WINDOW_MS && timestamp <= nowMs;
  });
  const recentVolume = sum(recent.map(getVolume));
  const latest = observations.at(-1) ?? null;
  const earliest = observations[0];
  const distinctTimestamps = new Set(observations.map((item) => item.timestamp.getTime()));

  if (
    !latest
    || observations.length < MIN_VOLUME_OBSERVATIONS
    || distinctTimestamps.size < MIN_VOLUME_OBSERVATIONS
  ) {
    return makeMetric(
      null,
      "x baseline",
      null,
      latest?.timestamp ?? null,
      "Collecting a rolling volume baseline from live observations",
      input.now,
      recentVolume,
      "recent 30s volume",
    );
  }

  const baselineBuckets: number[] = [];
  const observedWindowAgeMs = Math.max(1, nowMs - earliest.timestamp.getTime());
  const observedBucketCount = Math.min(
    BASELINE_WINDOW_MS / SHORT_WINDOW_MS,
    Math.max(1, Math.ceil(observedWindowAgeMs / SHORT_WINDOW_MS)),
  );
  for (let bucket = 1; bucket <= observedBucketCount; bucket += 1) {
    const bucketEnd = nowMs - (bucket - 1) * SHORT_WINDOW_MS;
    const bucketStart = bucketEnd - SHORT_WINDOW_MS;
    baselineBuckets.push(sum(observations
      .filter((item) => {
        const timestamp = item.timestamp.getTime();
        return timestamp > bucketStart && timestamp <= bucketEnd;
      })
      .map(getVolume)));
  }
  const baseline = sum(baselineBuckets) / baselineBuckets.length;
  if (baseline <= 0) {
    return makeMetric(
      null,
      "x baseline",
      null,
      latest.timestamp,
      "Baseline has no comparable volume yet",
      input.now,
      recentVolume,
      "recent 30s volume",
    );
  }

  const ratio = recentVolume / baseline;
  const score = 50 + clamp((ratio - 1) * 25, -50, 50);
  return makeMetric(ratio, "x baseline", score, latest.timestamp, useBars ? "OHLCV volume / trailing five-minute baseline" : "Trade size / trailing five-minute baseline", input.now, recentVolume, "recent 30s volume");
}

function calculateOrderFlowPressure(input: AlphaRadarInput): RadarSignalMetric {
  const nowMs = input.now.getTime();
  const windowTrades = getWindow(sortedRecent(input.trades), nowMs - FRESH_MS, nowMs);
  const classifiedTrades = windowTrades.filter((trade) => trade.side === "B" || trade.side === "A");
  const latestClassifiedTrade = classifiedTrades.at(-1);

  if (classifiedTrades.length > 0) {
    const buyVolume = sum(classifiedTrades.filter((trade) => trade.side === "B").map((trade) => trade.size));
    const sellVolume = sum(classifiedTrades.filter((trade) => trade.side === "A").map((trade) => trade.size));
    const totalVolume = buyVolume + sellVolume;
    if (totalVolume > 0 && latestClassifiedTrade) {
      const pressurePercent = ((buyVolume - sellVolume) / totalVolume) * 100;
      return makeMetric(
        pressurePercent,
        "% net",
        50 + pressurePercent / 2,
        latestClassifiedTrade.timestamp,
        `Classified buy/sell trade volume (${classifiedTrades.length} trades)`,
        input.now,
        buyVolume,
        "buy volume",
      );
    }
  }

  const quote = [...sortedRecent(input.quotes)]
    .reverse()
    .find(
      (item) =>
        observationIsFresh(item.timestamp, input.now)
        && item.bidSize !== null
        && item.askSize !== null,
    );
  if (quote && quote.bidSize !== null && quote.askSize !== null && quote.bidSize + quote.askSize > 0) {
    const pressurePercent = ((quote.bidSize - quote.askSize) / (quote.bidSize + quote.askSize)) * 100;
    return makeMetric(
      pressurePercent,
      "% depth",
      50 + pressurePercent / 2,
      quote.timestamp,
      "Quote-depth proxy because classified trade sides are unavailable",
      input.now,
      quote.bidSize,
      "bid size",
    );
  }

  return unavailableMetric("% net", "Requires classified trade sides or live quote sizes.", input.now);
}

function calculateUnusualActivity(input: AlphaRadarInput, volumeIntensity: RadarSignalMetric): RadarSignalMetric & { detected: boolean } {
  const nowMs = input.now.getTime();
  const trades = sortedRecent(input.trades);
  const latestTrade = trades.at(-1) ?? null;
  const recentCount = getWindow(trades, nowMs - SHORT_WINDOW_MS, nowMs).length;
  const earliest = trades[0];
  let countRatio: number | null = null;

  if (earliest && earliest.timestamp.getTime() <= nowMs - BASELINE_WINDOW_MS) {
    const baselineCounts: number[] = [];
    for (let bucket = 1; bucket <= BASELINE_WINDOW_MS / SHORT_WINDOW_MS; bucket += 1) {
      const bucketEnd = nowMs - (bucket - 1) * SHORT_WINDOW_MS;
      baselineCounts.push(getWindow(trades, bucketEnd - SHORT_WINDOW_MS, bucketEnd).length);
    }
    const averageCount = sum(baselineCounts) / baselineCounts.length;
    if (averageCount > 0) countRatio = recentCount / averageCount;
  }

  const ratios = [volumeIntensity.value, countRatio].filter((ratio): ratio is number => ratio !== null && Number.isFinite(ratio));
  if (ratios.length === 0) {
    return {
      ...makeMetric(null, "x baseline", null, latestTrade?.timestamp ?? null, "Collecting volume and trade-count baseline", input.now, recentCount, "recent 30s trades"),
      detected: false,
    };
  }

  const activityRatio = Math.max(...ratios);
  const detected = activityRatio >= 2;
  return {
    ...makeMetric(
      activityRatio,
      "x baseline",
      clamp((activityRatio - 1) * 50),
      latestTrade?.timestamp ?? volumeIntensity.observedAt,
      "Maximum of volume intensity and trade-count intensity",
      input.now,
      recentCount,
      "recent 30s trades",
    ),
    detected,
  };
}

function dataQualityFrom(metrics: RadarSignalMetric[], connectionState: string): SignalDataQuality {
  const observed = metrics.map((metric) => metric.observedAt).filter((date): date is Date => date !== null);
  if (observed.length === 0) return "missing";
  if (connectionState !== "streaming") return "degraded";

  const freshness = metrics.map((metric) => metric.freshness);
  if (freshness.includes("stale")) return "stale";
  if (
    freshness.includes("delayed")
    || freshness.includes("missing")
    || metrics.some((metric) => metric.score === null)
  ) {
    return "degraded";
  }
  return "good";
}

function diagnosticsFrom(input: AlphaRadarInput): Omit<AlphaRadarDiagnostics, "scoring_gate_reason"> {
  const freshQuotes = input.quotes.filter(
    (quote) =>
      observationIsFresh(quote.timestamp, input.now)
      && (
        quoteMidpoint(quote) !== null
        || (quote.bidSize !== null && quote.askSize !== null)
      ),
  );
  const freshTrades = input.trades.filter(
    (trade) => observationIsFresh(trade.timestamp, input.now),
  );
  const freshBars = input.bars.filter(
    (bar) => observationIsFresh(bar.timestamp, input.now),
  );
  const priceTimestamps = new Set<number>();
  for (const quote of freshQuotes) {
    if (quoteMidpoint(quote) !== null) priceTimestamps.add(quote.timestamp.getTime());
  }
  for (const trade of freshTrades) {
    if (trade.price > 0) priceTimestamps.add(trade.timestamp.getTime());
  }
  for (const bar of freshBars) {
    if (bar.close !== null && bar.close > 0) priceTimestamps.add(bar.timestamp.getTime());
  }
  const freshVolume =
    freshTrades.filter((trade) => trade.size > 0).length
    + freshBars.filter((bar) => bar.volume !== null && bar.volume > 0).length;
  const rollingTimestamps = [
    ...input.quotes.map((quote) => quote.timestamp),
    ...input.trades.map((trade) => trade.timestamp),
    ...input.bars.map((bar) => bar.timestamp),
  ]
    .filter((timestamp) => observationIsInRollingWindow(timestamp, input.now))
    .map((timestamp) => timestamp.getTime());
  const hasFreshObservation =
    freshQuotes.length > 0
    || freshTrades.length > 0
    || freshBars.length > 0;
  const earliestTimestamp = rollingTimestamps.length > 0
    ? Math.min(...rollingTimestamps)
    : null;

  return {
    fresh_quotes: freshQuotes.length,
    fresh_trades: freshTrades.length,
    fresh_prices: priceTimestamps.size,
    fresh_volume: freshVolume,
    valid_window_age:
      hasFreshObservation && earliestTimestamp !== null
        ? round((input.now.getTime() - earliestTimestamp) / 1_000, 1)
        : null,
  };
}

function scoringGateReason(
  input: AlphaRadarInput,
  diagnostics: Omit<AlphaRadarDiagnostics, "scoring_gate_reason">,
  scoringAvailable: boolean,
  momentum: RadarSignalMetric,
  spread: RadarSignalMetric,
  volumeIntensity: RadarSignalMetric,
  orderFlowPressure: RadarSignalMetric,
): string {
  if (scoringAvailable) return "ready";
  if (input.connectionState !== "streaming") return "feed_not_streaming";
  if (
    diagnostics.fresh_quotes === 0
    && diagnostics.fresh_trades === 0
    && diagnostics.fresh_prices === 0
    && diagnostics.fresh_volume === 0
  ) {
    return "no_fresh_market_observations";
  }
  if (!momentum.scoreEligible) return "waiting_for_two_fresh_prices";
  if (!spread.scoreEligible) return "waiting_for_fresh_bid_ask";
  if (!volumeIntensity.scoreEligible) return "building_volume_baseline";
  if (!orderFlowPressure.scoreEligible) return "waiting_for_order_flow";
  return "incomplete_scoring_window";
}

function withoutCurrentScore(metric: RadarSignalMetric): RadarSignalMetric {
  return {
    ...metric,
    score: null,
    scoreEligible: false,
  };
}

export function createEmptyAlphaRadar(now: Date, symbol = "NVDA"): AlphaRadarSnapshot {
  const unavailable = unavailableMetric("", "Waiting for live market observations.", now);
  return {
    score: null,
    status: null,
    scoreState: "insufficient",
    confidence: 0,
    dataConfidence: unavailableDataConfidence(
      "Data Confidence is awaiting a complete fresh live score window.",
    ),
    dataQuality: "missing",
    generatedAt: now,
    warnings: [`Waiting for live ${symbol} market observations. No Alpha Radar score is available.`],
    diagnostics: {
      fresh_quotes: 0,
      fresh_trades: 0,
      fresh_prices: 0,
      fresh_volume: 0,
      valid_window_age: null,
      scoring_gate_reason: "waiting_for_live_market_observations",
    },
    scan: {
      lastScannedAt: now,
      scanIntervalMs: 5_000,
      scanMode: "normal",
      triggerReason: "waiting_for_live_market_observations",
      eventTriggered: false,
    },
    alphaVelocity: emptyAlphaVelocity(),
    changeIndicators: emptyChangeIndicators(),
    multiTimeframe: unavailableMultiTimeframe(
      "Cross-context evidence is awaiting complete fresh live scans.",
    ),
    counterEvidence: unavailableCounterEvidence(
      "Counter-evidence is awaiting a complete fresh live score window.",
    ),
    preBreakoutWatch: false,
    preBreakout: unavailablePreBreakout(now),
    postBreakout: unavailablePostBreakout(now),
    momentum: { ...unavailable, unit: "%" },
    spread: { ...unavailable, unit: "bps" },
    volumeIntensity: { ...unavailable, unit: "x baseline" },
    orderFlowPressure: { ...unavailable, unit: "% net" },
    unusualActivity: { ...unavailable, unit: "x baseline", detected: false },
  };
}

export function calculateAlphaRadar(input: AlphaRadarInput): AlphaRadarSnapshot {
  const calculatedMomentum = calculateMomentum(input);
  const calculatedSpread = calculateSpread(input);
  const calculatedVolumeIntensity = calculateVolumeIntensity(input);
  const calculatedOrderFlowPressure = calculateOrderFlowPressure(input);
  const calculatedUnusualActivity = calculateUnusualActivity(input, calculatedVolumeIntensity);
  const components = [
    { metric: calculatedMomentum, weight: 0.3 },
    { metric: calculatedSpread, weight: 0.15 },
    { metric: calculatedVolumeIntensity, weight: 0.25 },
    { metric: calculatedOrderFlowPressure, weight: 0.3 },
  ];
  const eligibleComponents = components.filter(({ metric }) => metric.scoreEligible && metric.score !== null);
  const availableWeight = sum(eligibleComponents.map(({ weight }) => weight));
  const dataQuality = dataQualityFrom(
    [
      calculatedMomentum,
      calculatedSpread,
      calculatedVolumeIntensity,
      calculatedOrderFlowPressure,
    ],
    input.connectionState,
  );
  const scoringAvailable =
    input.connectionState === "streaming"
    && dataQuality === "good"
    && eligibleComponents.length === components.length;
  const weightedScore = scoringAvailable
    ? sum(eligibleComponents.map(({ metric, weight }) => (metric.score ?? 0) * weight)) / availableWeight
    : null;
  const confidence =
    input.connectionState === "streaming"
      ? Math.round(availableWeight * 100)
      : 0;
  const score = weightedScore === null ? null : Math.round(clamp(weightedScore));
  const hasHistoricalObservation = components.some(({ metric }) => metric.observedAt !== null);
  const scoreState: AlphaRadarScoreState = scoringAvailable
    ? "available"
    : dataQuality === "stale" || (input.connectionState !== "streaming" && hasHistoricalObservation)
      ? "stale"
      : "insufficient";

  let status: AlphaRadarSignalState | null = score === null ? null : "Neutral";
  if (score !== null) {
    const componentsSupportBreakout =
      (calculatedMomentum.score ?? 0) >= 60
      && (calculatedOrderFlowPressure.score ?? 0) >= 60
      && (calculatedVolumeIntensity.score ?? 0) >= 50;
    if (score >= 72 && componentsSupportBreakout) {
      status = "Breakout Setup";
    } else if (score >= 56 || calculatedUnusualActivity.detected) {
      status = "Watch";
    }
  }

  const momentum = scoringAvailable ? calculatedMomentum : withoutCurrentScore(calculatedMomentum);
  const spread = scoringAvailable ? calculatedSpread : withoutCurrentScore(calculatedSpread);
  const volumeIntensity = scoringAvailable
    ? calculatedVolumeIntensity
    : withoutCurrentScore(calculatedVolumeIntensity);
  const orderFlowPressure = scoringAvailable
    ? calculatedOrderFlowPressure
    : withoutCurrentScore(calculatedOrderFlowPressure);
  const unusualActivity = scoringAvailable
    ? calculatedUnusualActivity
    : {
        ...withoutCurrentScore(calculatedUnusualActivity),
        detected: false,
      };
  const diagnosticCounts = diagnosticsFrom(input);
  const diagnostics: AlphaRadarDiagnostics = {
    ...diagnosticCounts,
    scoring_gate_reason: scoringGateReason(
      input,
      diagnosticCounts,
      scoringAvailable,
      calculatedMomentum,
      calculatedSpread,
      calculatedVolumeIntensity,
      calculatedOrderFlowPressure,
    ),
  };

  const warnings: string[] = [];
  if (input.connectionState !== "streaming") {
    warnings.push("The feed is not currently streaming; no current Alpha Radar score is available.");
  }
  if (dataQuality === "missing") {
    warnings.push("No usable live market observations are available yet.");
  } else if (dataQuality === "stale") {
    warnings.push("Market observations are historical and stale; their values are excluded from scoring.");
  } else if (dataQuality === "degraded") {
    warnings.push("Market observations are delayed or incomplete; no score is available until a valid window is rebuilt.");
  }
  if (!calculatedVolumeIntensity.scoreEligible) {
    warnings.push("Volume intensity is collecting a rolling baseline.");
  }
  if (!calculatedMomentum.scoreEligible) {
    warnings.push("Momentum is waiting for at least two price observations.");
  }

  return {
    score,
    status,
    scoreState,
    confidence,
    dataQuality,
    generatedAt: input.now,
    warnings,
    diagnostics,
    scan: {
      lastScannedAt: input.now,
      scanIntervalMs: 5_000,
      scanMode: "normal",
      triggerReason: "direct_calculation",
      eventTriggered: false,
    },
    alphaVelocity: emptyAlphaVelocity(),
    changeIndicators: emptyChangeIndicators(),
    preBreakoutWatch: false,
    preBreakout: unavailablePreBreakout(input.now),
    postBreakout: unavailablePostBreakout(input.now),
    multiTimeframe: unavailableMultiTimeframe(
      "Cross-context evidence is awaiting complete fresh live scans.",
    ),
    dataConfidence: unavailableDataConfidence(
      "Data Confidence is awaiting a complete fresh live score window.",
    ),
    counterEvidence: unavailableCounterEvidence(
      "Counter-evidence is awaiting a complete fresh live score window.",
    ),
    momentum,
    spread,
    volumeIntensity,
    orderFlowPressure,
    unusualActivity,
  };
}