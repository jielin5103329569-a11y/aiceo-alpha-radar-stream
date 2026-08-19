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

export type AlphaRadarSnapshot = {
  score: number | null;
  status: AlphaRadarSignalState | null;
  scoreState: AlphaRadarScoreState;
  confidence: number;
  dataQuality: SignalDataQuality;
  generatedAt: Date;
  warnings: string[];
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

const SHORT_WINDOW_MS = 30_000;
const BASELINE_WINDOW_MS = 300_000;
const FRESH_MS = 15_000;
const DELAYED_MS = 60_000;

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

function calculateMomentum(input: AlphaRadarInput): RadarSignalMetric {
  const points = [
    ...sortedRecent(input.quotes)
      .map((quote) => ({ timestamp: quote.timestamp, price: quoteMidpoint(quote), source: "quote midpoint" }))
      .filter((point): point is { timestamp: Date; price: number; source: string } => point.price !== null),
    ...sortedRecent(input.trades).map((trade) => ({ timestamp: trade.timestamp, price: trade.price, source: "trade price" })),
    ...sortedRecent(input.bars)
      .map((bar) => ({ timestamp: bar.timestamp, price: bar.close, source: "OHLCV close" }))
      .filter((point): point is { timestamp: Date; price: number; source: string } => point.price !== null),
  ].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  const latest = points.at(-1);
  if (!latest || points.length < 2) {
    return unavailableMetric("%", "Requires at least two live quote, trade, or bar prices.", input.now);
  }

  const targetTime = latest.timestamp.getTime() - SHORT_WINDOW_MS;
  const reference = [...points].reverse().find((point) => point.timestamp.getTime() <= targetTime) ?? points[0];
  if (!reference || reference.price <= 0 || reference.timestamp.getTime() === latest.timestamp.getTime()) {
    return unavailableMetric("%", "Requires a prior price observation.", input.now);
  }

  const changePercent = ((latest.price - reference.price) / reference.price) * 100;
  const score = 50 + clamp((changePercent / 0.25) * 50, -50, 50);
  return makeMetric(
    changePercent,
    "%",
    score,
    latest.timestamp,
    `Short-window ${latest.source} change`,
    input.now,
    reference.price,
    "window start price",
  );
}

function calculateSpread(input: AlphaRadarInput): RadarSignalMetric {
  const quote = [...sortedRecent(input.quotes)].reverse().find((item) => quoteMidpoint(item) !== null);
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
  const bars = sortedRecent(input.bars).filter((bar) => bar.volume !== null && bar.volume >= 0);
  const trades = sortedRecent(input.trades).filter((trade) => trade.size >= 0);
  const useBars = bars.length > 0;
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

  if (!latest || earliest.timestamp.getTime() > nowMs - BASELINE_WINDOW_MS) {
    return makeMetric(
      null,
      "x baseline",
      null,
      latest?.timestamp ?? null,
      "Collecting a five-minute rolling volume baseline",
      input.now,
      recentVolume,
      "recent 30s volume",
    );
  }

  const baselineBuckets: number[] = [];
  for (let bucket = 1; bucket <= BASELINE_WINDOW_MS / SHORT_WINDOW_MS; bucket += 1) {
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
  const windowTrades = getWindow(sortedRecent(input.trades), nowMs - SHORT_WINDOW_MS, nowMs);
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

  const quote = [...sortedRecent(input.quotes)].reverse().find((item) => item.bidSize !== null && item.askSize !== null);
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

function withoutCurrentScore(metric: RadarSignalMetric): RadarSignalMetric {
  return {
    ...metric,
    score: null,
    scoreEligible: false,
  };
}

export function createEmptyAlphaRadar(now: Date): AlphaRadarSnapshot {
  const unavailable = unavailableMetric("", "Waiting for live market observations.", now);
  return {
    score: null,
    status: null,
    scoreState: "insufficient",
    confidence: 0,
    dataQuality: "missing",
    generatedAt: now,
    warnings: ["Waiting for live NVDA market observations. No Alpha Radar score is available."],
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
  const confidence = scoringAvailable ? Math.round(availableWeight * 100) : 0;
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
  if (volumeIntensity.score === null) {
    warnings.push("Volume intensity is collecting a rolling baseline.");
  }
  if (momentum.score === null) {
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
    momentum,
    spread,
    volumeIntensity,
    orderFlowPressure,
    unusualActivity,
  };
}