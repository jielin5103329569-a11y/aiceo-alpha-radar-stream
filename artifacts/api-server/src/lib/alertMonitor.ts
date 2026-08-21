/**
 * Alert Monitor — Task #18 backend foundation.
 *
 * Accepts a published RadarSymbolStatus / RadarStatus snapshot and produces an
 * immutable NotificationCandidate ONLY when ALL fail-closed gates are proven:
 *
 *  Feed gates   — both streams "receiving", marketFeedState "streaming"
 *  Score gates  — scoreState "available", dataQuality "good", score non-null
 *  Freshness    — preBreakout.dataFresh === true
 *  Components   — all four core RadarSignalMetric.scoreEligible === true
 *  Live ingestion — subscriptionVerified, realMarketEventReceived,
 *                   enteredScoringWindow, scoringEligible,
 *                   triggerEvidenceAvailable (all true)
 *  Network path — bounded queue, ordered/integrity-verified event delivery,
 *                 and latency/jitter health must independently be alert-ready
 *  Scan health — current scheduler plus verified fresh market-data window
 *  Shadow / heartbeat / ranking / focused-leader / missing-stale veto
 *
 * Additionally the function enforces:
 *  • deterministic per-symbol transition/event key deduplication
 *  • per-symbol cooldown (default 60 s) between successive candidates
 *  • bounded retry state and health observations
 *  • non-throwing interface — all errors produce a structured failure result
 */

import type { RadarSymbolStatus, RadarStatus } from "./databentoLive";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AlertSeverity = "info" | "watch" | "alert" | "critical";

export type AlertTriggerReason =
  | "breakout_confirmed"
  | "breakout_critical"
  | "latent_candidate"
  | "take_profit_watch"
  | "trend_reversal_confirmed"
  | "watch_state_elevated";

/**
 * An immutable, deduplicated notification candidate produced when all
 * fail-closed gates pass.  Nothing in this type is optional so that
 * consumers never have to guard against partial data.
 */
export type NotificationCandidate = {
  /** Unique key used for deduplication — never changes for the same event. */
  readonly eventKey: string;
  readonly symbol: string;
  readonly severity: AlertSeverity;
  readonly triggerReason: AlertTriggerReason;
  readonly detectionState: string;
  readonly confirmationStatus: string;
  readonly alphaScore: number;
  readonly alphaVelocity30s: number | null;
  readonly confidence: number;
  readonly triggerPrice: number | null;
  readonly preBreakoutState: string;
  readonly satisfiedEvidence: readonly string[];
  readonly missingEvidence: readonly string[];
  /** Actual state-machine transition that made this candidate eligible. */
  readonly transitionAt: Date;
  readonly generatedAt: Date;
  /** Snapshot of the gate conditions that passed for auditability. */
  readonly gateSnapshot: AlertGateSnapshot;
};

/**
 * All gate conditions captured at the moment of candidate generation.
 * Stored verbatim for audit / delivery logs.
 */
export type AlertGateSnapshot = {
  readonly bothStreamsReceiving: boolean;
  readonly marketFeedStreaming: boolean;
  readonly scoreAvailable: boolean;
  readonly scoreGood: boolean;
  readonly scoreNonNull: boolean;
  readonly preBreakoutDataFresh: boolean;
  readonly coreComponentsScoreEligible: boolean;
  readonly subscriptionVerified: boolean;
  readonly realMarketEventReceived: boolean;
  readonly enteredScoringWindow: boolean;
  readonly scoringEligible: boolean;
  readonly triggerEvidenceAvailable: boolean;
  readonly scanHealthMarketDataReady: boolean;
  readonly networkAlertReady: boolean;
  readonly eventTriggeredScan: boolean;
  readonly transitionInstanceAvailable: boolean;
  readonly noShadowVeto: boolean;
  readonly noHeartbeatVeto: boolean;
  readonly noRankingVeto: boolean;
  readonly noFocusedLeaderVeto: boolean;
  readonly noMissingDataVeto: boolean;
  readonly noStaleDataVeto: boolean;
};

/** Result returned when all gates pass. */
export type AlertMonitorSuccess = {
  readonly ok: true;
  readonly candidate: NotificationCandidate;
};

/** Partial gate snapshot captured up to the point of a gate failure. */
export type PartialGateSnapshot = Partial<{ [K in keyof AlertGateSnapshot]: AlertGateSnapshot[K] }>;

/** Result returned when at least one gate blocks. */
export type AlertMonitorBlocked = {
  readonly ok: false;
  readonly reason: string;
  /** First failing gate key for programmatic handling. */
  readonly failedGate: keyof AlertGateSnapshot;
  /** Partial gate snapshot up to the point of failure (for diagnostics). */
  readonly gateSnapshot: PartialGateSnapshot;
};

/** Result returned when evaluation threw an unexpected error. */
export type AlertMonitorError = {
  readonly ok: false;
  readonly reason: string;
  readonly failedGate: "internal_error";
  readonly error: string;
};

export type AlertMonitorResult =
  | AlertMonitorSuccess
  | AlertMonitorBlocked
  | AlertMonitorError;

// ---------------------------------------------------------------------------
// Per-symbol cooldown / deduplication state (mutable, bounded)
// ---------------------------------------------------------------------------

const MAX_HISTORY_ENTRIES = 200;

export type AlertSymbolState = {
  /** Last event key that produced a candidate (undefined = never). */
  lastEventKey: string | undefined;
  /** Epoch ms of the last successful candidate generation. */
  lastCandidateAt: number;
  /** Independent cooldown clocks for entry, take-profit, and reversal transitions. */
  lastCandidateAtByLane: Record<"entry" | "take_profit" | "reversal", number>;
  /** Rolling log of the last N evaluation outcomes for health diagnostics. */
  recentOutcomes: AlertOutcomeEntry[];
  /** Count of successive blocked evaluations since last success. */
  consecutiveBlocked: number;
  /** Count of successive error evaluations since last success. */
  consecutiveErrors: number;
};

export type AlertOutcomeEntry = {
  readonly evaluatedAt: number; // epoch ms
  readonly ok: boolean;
  readonly reason: string;
};

/** Create a fresh per-symbol state record. */
export function createSymbolState(): AlertSymbolState {
  return {
    lastEventKey: undefined,
    lastCandidateAt: 0,
    lastCandidateAtByLane: {
      entry: 0,
      take_profit: 0,
      reversal: 0,
    },
    recentOutcomes: [],
    consecutiveBlocked: 0,
    consecutiveErrors: 0,
  };
}

// ---------------------------------------------------------------------------
// Gate evaluation helpers (pure, throw-free)
// ---------------------------------------------------------------------------

/**
 * Derive the deterministic event key for a symbol snapshot.
 * Uses the actual state-machine transition, not an evolving score bucket.
 * This is stable across retries of a single real transition while allowing a
 * later recurrence of the same state to alert independently.
 */
export function deriveEventKey(symbol: string, snapshot: RadarSymbolStatus): string {
  const alpha = snapshot.alphaRadar;
  const pb = alpha.preBreakout;
  const post = alpha.postBreakout;
  const postTransitionAt = post?.lastTransitionAt;
  const postAlertable =
    post?.active === true
    && post.dataFresh === true
    && (post?.state === "take_profit_watch" || post?.state === "trend_reversal_confirmed")
    && postTransitionAt instanceof Date;
  if (postAlertable) {
    return `alert:${symbol}:${postTransitionAt.toISOString()}:post_breakout:${post.state}`;
  }
  const transitionAt = pb.lastTransitionAt;
  if (!transitionAt) {
    throw new Error("Cannot derive an alert event key without preBreakout.lastTransitionAt");
  }
  return `alert:${symbol}:${transitionAt.toISOString()}:${pb.state}:${pb.confirmation.status}`;
}

/**
 * Classify severity from detection state and confirmation status.
 */
export function classifySeverity(
  detectionState: string,
  confirmationStatus: string,
  postBreakoutState?: string,
): AlertSeverity {
  if (postBreakoutState === "trend_reversal_confirmed") return "critical";
  if (postBreakoutState === "take_profit_watch") return "alert";
  if (detectionState === "confirmed" && confirmationStatus === "confirmed") return "critical";
  if (detectionState === "breakout_critical") return "alert";
  if (detectionState === "latent") return "watch";
  return "info";
}

/**
 * Classify the trigger reason from detection state and confirmation status.
 */
export function classifyTriggerReason(
  detectionState: string,
  confirmationStatus: string,
  postBreakoutState?: string,
): AlertTriggerReason {
  if (postBreakoutState === "trend_reversal_confirmed") return "trend_reversal_confirmed";
  if (postBreakoutState === "take_profit_watch") return "take_profit_watch";
  if (detectionState === "confirmed" && confirmationStatus === "confirmed") return "breakout_confirmed";
  if (detectionState === "breakout_critical") return "breakout_critical";
  if (detectionState === "latent") return "latent_candidate";
  return "watch_state_elevated";
}

// ---------------------------------------------------------------------------
// Core gate evaluation — pure function, no throws
// ---------------------------------------------------------------------------

/**
 * Evaluate all fail-closed gates on a RadarSymbolStatus snapshot.
 *
 * Returns a structured result without ever throwing.  The caller is
 * responsible for applying cooldown / deduplication policy using
 * AlertSymbolState.
 */
export function evaluateAlertGates(
  symbolStatus: RadarSymbolStatus,
): AlertMonitorResult {
  try {
    // Mutable accumulator — cast to AlertGateSnapshot only when complete
    type MutableGateSnapshot = { -readonly [K in keyof AlertGateSnapshot]?: AlertGateSnapshot[K] };
    const partial: MutableGateSnapshot = {};
    const alpha = symbolStatus.alphaRadar;
    const pb = alpha.preBreakout;
    const post = alpha.postBreakout;
    const ingestion = symbolStatus.liveIngestion;

    // ------------------------------------------------------------------
    // Gate 1: both feed streams receiving  (FAIL-CLOSED)
    // Missing or empty streams array = blocked — never pass by omission.
    // ------------------------------------------------------------------
    const streams = symbolStatus.streams;
    const bothStreamsReceiving =
      Array.isArray(streams)
      && streams.length >= 2
      && streams.every((s) => s.state === "receiving");
    partial.bothStreamsReceiving = bothStreamsReceiving;
    if (!bothStreamsReceiving) {
      const detail = !Array.isArray(streams)
        ? "streams array absent"
        : streams.length < 2
          ? `only ${streams.length} stream(s) present`
          : `not all receiving: ${streams.map((s) => `${s.schema}=${s.state}`).join(", ")}`;
      return {
        ok: false,
        reason: `Streams gate (fail-closed): ${detail}`,
        failedGate: "bothStreamsReceiving",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gate 2: market feed streaming
    // ------------------------------------------------------------------
    const marketFeedStreaming = symbolStatus.marketFeedState === "streaming";
    partial.marketFeedStreaming = marketFeedStreaming;
    if (!marketFeedStreaming) {
      return {
        ok: false,
        reason: `marketFeedState is "${symbolStatus.marketFeedState}", not "streaming"`,
        failedGate: "marketFeedStreaming",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gate 3: protected scan health. This is intentionally independent of
    // the score: a stale/overdue/inactive scanner may retain historical score
    // fields but must never hand them to production alert delivery.
    // ------------------------------------------------------------------
    const scanHealthMarketDataReady =
      symbolStatus.scanHealth?.marketDataGateReady === true
      && symbolStatus.scanHealth.marketDataState === "fresh"
      && symbolStatus.scanHealth.schedulerState === "scheduled";
    partial.scanHealthMarketDataReady = scanHealthMarketDataReady;
    if (!scanHealthMarketDataReady) {
      const health = symbolStatus.scanHealth;
      return {
        ok: false,
        reason: health
          ? `Protected scan health is ${health.degradation}: ${health.reason}`
          : "Protected scan health is missing — fail closed",
        failedGate: "scanHealthMarketDataReady",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gate 4: network transport is an independent fail-closed boundary.
    // A connection, heartbeat, queue drain, or cached market window alone
    // never passes it. This checks the read-only network projection that
    // accounts for event latency, jitter, bounded backpressure, ordering, and
    // recovery-window validity.
    // ------------------------------------------------------------------
    const networkAlertReady = symbolStatus.network?.alertReady === true;
    partial.networkAlertReady = networkAlertReady;
    if (!networkAlertReady) {
      const network = symbolStatus.network;
      return {
        ok: false,
        reason: network
          ? `Network event path is not alert-ready: ${network.reason}`
          : "Network event path health is missing — fail closed",
        failedGate: "networkAlertReady",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gate 5–7: score available / good / non-null
    // ------------------------------------------------------------------
    const scoreAvailable = alpha.scoreState === "available";
    partial.scoreAvailable = scoreAvailable;
    if (!scoreAvailable) {
      return {
        ok: false,
        reason: `scoreState is "${alpha.scoreState}", not "available"`,
        failedGate: "scoreAvailable",
        gateSnapshot: partial,
      };
    }

    const scoreGood = alpha.dataQuality === "good";
    partial.scoreGood = scoreGood;
    if (!scoreGood) {
      return {
        ok: false,
        reason: `dataQuality is "${alpha.dataQuality}", not "good"`,
        failedGate: "scoreGood",
        gateSnapshot: partial,
      };
    }

    const scoreNonNull = alpha.score !== null && Number.isFinite(alpha.score);
    partial.scoreNonNull = scoreNonNull;
    if (!scoreNonNull) {
      return {
        ok: false,
        reason: "Alpha score is null or non-finite",
        failedGate: "scoreNonNull",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gate 6: preBreakout data fresh
    // ------------------------------------------------------------------
    const preBreakoutDataFresh = pb.dataFresh === true;
    partial.preBreakoutDataFresh = preBreakoutDataFresh;
    if (!preBreakoutDataFresh) {
      return {
        ok: false,
        reason: "preBreakout.dataFresh is false — data is not fresh",
        failedGate: "preBreakoutDataFresh",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gate 7: all four core components scoreEligible
    // ------------------------------------------------------------------
    const coreComponentsScoreEligible =
      alpha.momentum.scoreEligible === true
      && alpha.volumeIntensity.scoreEligible === true
      && alpha.orderFlowPressure.scoreEligible === true
      && alpha.spread.scoreEligible === true;
    partial.coreComponentsScoreEligible = coreComponentsScoreEligible;
    if (!coreComponentsScoreEligible) {
      const missing: string[] = [];
      if (!alpha.momentum.scoreEligible) missing.push("momentum");
      if (!alpha.volumeIntensity.scoreEligible) missing.push("volumeIntensity");
      if (!alpha.orderFlowPressure.scoreEligible) missing.push("orderFlowPressure");
      if (!alpha.spread.scoreEligible) missing.push("spread");
      return {
        ok: false,
        reason: `Core components not scoreEligible: ${missing.join(", ")}`,
        failedGate: "coreComponentsScoreEligible",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Gates 8–12: live ingestion conditions
    // ------------------------------------------------------------------
    const conditions = ingestion.conditions;

    const subscriptionVerified = conditions.subscriptionVerified === true;
    partial.subscriptionVerified = subscriptionVerified;
    if (!subscriptionVerified) {
      return {
        ok: false,
        reason: "Live ingestion subscriptionVerified is false",
        failedGate: "subscriptionVerified",
        gateSnapshot: partial,
      };
    }

    const realMarketEventReceived = conditions.realMarketEventReceived === true;
    partial.realMarketEventReceived = realMarketEventReceived;
    if (!realMarketEventReceived) {
      return {
        ok: false,
        reason: "Live ingestion realMarketEventReceived is false",
        failedGate: "realMarketEventReceived",
        gateSnapshot: partial,
      };
    }

    const enteredScoringWindow = conditions.enteredScoringWindow === true;
    partial.enteredScoringWindow = enteredScoringWindow;
    if (!enteredScoringWindow) {
      return {
        ok: false,
        reason: "Live ingestion enteredScoringWindow is false",
        failedGate: "enteredScoringWindow",
        gateSnapshot: partial,
      };
    }

    const scoringEligible = conditions.scoringEligible === true;
    partial.scoringEligible = scoringEligible;
    if (!scoringEligible) {
      return {
        ok: false,
        reason: "Live ingestion scoringEligible is false",
        failedGate: "scoringEligible",
        gateSnapshot: partial,
      };
    }

    const triggerEvidenceAvailable = conditions.triggerEvidenceAvailable === true;
    partial.triggerEvidenceAvailable = triggerEvidenceAvailable;
    if (!triggerEvidenceAvailable) {
      return {
        ok: false,
        reason: "Live ingestion triggerEvidenceAvailable is false",
        failedGate: "triggerEvidenceAvailable",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Transition identity: production alerts require this scan to have been
    // triggered by a real market event and to represent an actual state
    // transition. Scheduled checks and state/score persistence never create
    // an alert candidate on their own.
    // ------------------------------------------------------------------
    const eventTriggeredScan =
      alpha.scan.eventTriggered === true
      && ingestion.triggerEvidence.eventTriggered === true;
    partial.eventTriggeredScan = eventTriggeredScan;
    if (!eventTriggeredScan) {
      return {
        ok: false,
        reason: "Alert scan is not directly triggered by verified live market evidence",
        failedGate: "eventTriggeredScan",
        gateSnapshot: partial,
      };
    }

    const postAlertable =
      post?.active === true
      && post.dataFresh === true
      && (post.state === "take_profit_watch" || post.state === "trend_reversal_confirmed");
    const transitionAt = postAlertable ? post.lastTransitionAt : pb.lastTransitionAt;
    const transitionInstanceAvailable =
      transitionAt instanceof Date
      && !Number.isNaN(transitionAt.getTime())
      && alpha.scan.lastScannedAt instanceof Date
      && alpha.scan.lastScannedAt.getTime() >= transitionAt.getTime();
    partial.transitionInstanceAvailable = transitionInstanceAvailable;
    if (!transitionInstanceAvailable) {
      return {
        ok: false,
        reason: "No current pre-breakout or post-breakout transition instance is available for alert identity",
        failedGate: "transitionInstanceAvailable",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // Veto gates: shadow, heartbeat, ranking, focused leader, missing/stale
    // ------------------------------------------------------------------

    // A real latent setup is actionable, but watch/unavailable are not.
    const noShadowVeto =
      postAlertable
      || pb.state === "latent"
      || pb.state === "breakout_critical"
      || pb.state === "confirmed";
    partial.noShadowVeto = noShadowVeto;
    if (!noShadowVeto) {
      return {
        ok: false,
        reason: `preBreakout.state "${pb.state}" is too early — minimum is "latent"`,
        failedGate: "noShadowVeto",
        gateSnapshot: partial,
      };
    }

    // Heartbeat veto: connection must not be in a heartbeat-only or non-streaming state
    const noHeartbeatVeto =
      symbolStatus.connectionState === "streaming";
    partial.noHeartbeatVeto = noHeartbeatVeto;
    if (!noHeartbeatVeto) {
      return {
        ok: false,
        reason: `connectionState "${symbolStatus.connectionState}" is not "streaming" — heartbeat/reconnect veto`,
        failedGate: "noHeartbeatVeto",
        gateSnapshot: partial,
      };
    }

    // Latent qualification has its own fresh observed evidence. Critical and
    // confirmed states still require converging confirmation evidence.
    const noRankingVeto = postAlertable
      ? true
      : (
        (pb.state === "latent" && (pb.latentScore ?? 0) >= 80)
        || (
          pb.state !== "latent"
          && pb.confirmation.status !== "unavailable"
          && pb.confirmation.status !== "rejected"
        )
      );
    partial.noRankingVeto = noRankingVeto;
    if (!noRankingVeto) {
      return {
        ok: false,
        reason: `confirmation.status "${pb.confirmation.status}" is not actionable — ranking veto`,
        failedGate: "noRankingVeto",
        gateSnapshot: partial,
      };
    }

    // Focused leader veto: preBreakout detection must not be in a transient
    // state where the focused leader diverges from the alert symbol.
    // We gate on pb.velocityGateSatisfied being explicitly true.
    const noFocusedLeaderVeto = postAlertable || pb.velocityGateSatisfied === true;
    partial.noFocusedLeaderVeto = noFocusedLeaderVeto;
    if (!noFocusedLeaderVeto) {
      return {
        ok: false,
        reason: "velocityGateSatisfied is false — focused leader veto",
        failedGate: "noFocusedLeaderVeto",
        gateSnapshot: partial,
      };
    }

    // Missing data veto: dataQuality must not be "missing" or "degraded"
    const noMissingDataVeto =
      alpha.dataQuality !== "missing"
      && alpha.dataQuality !== "degraded";
    partial.noMissingDataVeto = noMissingDataVeto;
    if (!noMissingDataVeto) {
      return {
        ok: false,
        reason: `dataQuality "${alpha.dataQuality}" indicates missing/degraded data`,
        failedGate: "noMissingDataVeto",
        gateSnapshot: partial,
      };
    }

    // Stale data veto: scoreState must not be "stale" (already covered by
    // scoreAvailable gate, but explicit for defence-in-depth)
    const noStaleDataVeto = alpha.scoreState !== "stale";
    partial.noStaleDataVeto = noStaleDataVeto;
    if (!noStaleDataVeto) {
      return {
        ok: false,
        reason: "scoreState is stale — stale data veto",
        failedGate: "noStaleDataVeto",
        gateSnapshot: partial,
      };
    }

    // ------------------------------------------------------------------
    // All gates passed — build immutable candidate
    // ------------------------------------------------------------------
    const gateSnapshot: AlertGateSnapshot = {
      bothStreamsReceiving: partial.bothStreamsReceiving ?? true,
      marketFeedStreaming: partial.marketFeedStreaming!,
      scoreAvailable: partial.scoreAvailable!,
      scoreGood: partial.scoreGood!,
      scoreNonNull: partial.scoreNonNull!,
      preBreakoutDataFresh: partial.preBreakoutDataFresh!,
      coreComponentsScoreEligible: partial.coreComponentsScoreEligible!,
      subscriptionVerified: partial.subscriptionVerified!,
      realMarketEventReceived: partial.realMarketEventReceived!,
      enteredScoringWindow: partial.enteredScoringWindow!,
      scoringEligible: partial.scoringEligible!,
      triggerEvidenceAvailable: partial.triggerEvidenceAvailable!,
      scanHealthMarketDataReady: partial.scanHealthMarketDataReady!,
      networkAlertReady: partial.networkAlertReady!,
      eventTriggeredScan: partial.eventTriggeredScan!,
      transitionInstanceAvailable: partial.transitionInstanceAvailable!,
      noShadowVeto: partial.noShadowVeto!,
      noHeartbeatVeto: partial.noHeartbeatVeto!,
      noRankingVeto: partial.noRankingVeto!,
      noFocusedLeaderVeto: partial.noFocusedLeaderVeto!,
      noMissingDataVeto: partial.noMissingDataVeto!,
      noStaleDataVeto: partial.noStaleDataVeto!,
    };

    const candidate: NotificationCandidate = Object.freeze({
      eventKey: deriveEventKey(symbolStatus.symbol, symbolStatus),
      symbol: symbolStatus.symbol,
      severity: classifySeverity(
        pb.state,
        pb.confirmation.status,
        postAlertable ? post?.state : undefined,
      ),
      triggerReason: classifyTriggerReason(
        pb.state,
        pb.confirmation.status,
        postAlertable ? post?.state : undefined,
      ),
      detectionState: pb.state,
      confirmationStatus: pb.confirmation.status,
      alphaScore: alpha.score as number,
      alphaVelocity30s: alpha.alphaVelocity.rate30s,
      confidence: alpha.confidence,
      triggerPrice: symbolStatus.market.latestPrice,
      preBreakoutState: pb.state,
      satisfiedEvidence: Object.freeze([
        ...pb.confirmation.satisfiedEvidence,
        ...(postAlertable ? post.supportReasons : []),
      ]),
      missingEvidence: Object.freeze([
        ...pb.confirmation.missingEvidence,
        ...(postAlertable ? post.deteriorationReasons : []),
      ]),
      transitionAt,
      generatedAt: new Date(),
      gateSnapshot: Object.freeze(gateSnapshot),
    });

    return { ok: true, candidate };
  } catch (err) {
    return {
      ok: false,
      reason: "Internal error during gate evaluation",
      failedGate: "internal_error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Stateful alert monitor with cooldown + deduplication
// ---------------------------------------------------------------------------

export type AlertMonitorOptions = {
  /** Minimum milliseconds between successive candidates for the same symbol (default 60_000). */
  cooldownMs?: number;
  /** Maximum recent outcome entries to retain per symbol (default 100). */
  maxOutcomeHistory?: number;
};

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_OUTCOME_HISTORY = 100;

export type AlertMonitorObservation = {
  readonly symbol: string;
  readonly evaluatedAt: Date;
  readonly result: AlertMonitorResult;
  /** true only when a candidate was NEW (not deduped, not in cooldown). */
  readonly isNewCandidate: boolean;
};

/**
 * AlertMonitor maintains per-symbol cooldown and deduplication state and
 * exposes a non-throwing observe() method.
 *
 * Usage pattern (to be wired at the live status publication point):
 *
 *   const monitor = new AlertMonitor();
 *   databentoLive.on("status", (status) => {
 *     for (const symbolStatus of status.symbolRadars ?? []) {
 *       const obs = monitor.observe(symbolStatus);
 *       if (obs.isNewCandidate && obs.result.ok) {
 *         // dispatch obs.result.candidate to notification delivery
 *       }
 *     }
 *   });
 */
export class AlertMonitor {
  private readonly cooldownMs: number;
  private readonly maxOutcomeHistory: number;
  private readonly symbolStates = new Map<string, AlertSymbolState>();

  constructor(options: AlertMonitorOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxOutcomeHistory = options.maxOutcomeHistory ?? DEFAULT_MAX_OUTCOME_HISTORY;
  }

  /**
   * Evaluate a symbol snapshot.  Returns an observation that records whether
   * this produced a new (non-deduped, non-cooled) candidate.
   *
   * Never throws — all errors are captured in the returned observation.
   */
  observe(symbolStatus: RadarSymbolStatus): AlertMonitorObservation {
    // Guard against null/undefined/malformed input at the outermost level
    if (symbolStatus == null || typeof symbolStatus !== "object") {
      return {
        symbol: "unknown",
        evaluatedAt: new Date(),
        result: {
          ok: false,
          reason: "Invalid symbolStatus input (null/undefined/non-object)",
          failedGate: "internal_error" as const,
          error: "symbolStatus is null, undefined, or not an object",
        },
        isNewCandidate: false,
      };
    }

    const now = Date.now();
    const symbol = (symbolStatus as { symbol?: unknown }).symbol as string ?? "unknown";

    // Ensure per-symbol state exists
    if (!this.symbolStates.has(symbol)) {
      this.symbolStates.set(symbol, createSymbolState());
    }
    const state = this.symbolStates.get(symbol)!;

    // Gate evaluation (non-throwing)
    const result = evaluateAlertGates(symbolStatus);

    let isNewCandidate = false;

    if (result.ok) {
      const candidate = result.candidate;
      const cooldownLane = candidate.triggerReason === "take_profit_watch"
        ? "take_profit"
        : candidate.triggerReason === "trend_reversal_confirmed"
          ? "reversal"
          : "entry";

      // Exact event deduplication must take precedence over cooldown lanes.
      if (state.lastEventKey === candidate.eventKey) {
        this.recordOutcome(state, now, false, `deduped: ${candidate.eventKey}`);
        return {
          symbol,
          evaluatedAt: new Date(now),
          result: {
            ok: false,
            reason: `Duplicate event key: ${candidate.eventKey}`,
            failedGate: "noShadowVeto",
            gateSnapshot: candidate.gateSnapshot,
          },
          isNewCandidate: false,
        };
      }

      // Entry, exit-watch, and confirmed-reversal transitions have independent
      // cooldowns. A fresh exit transition must never be delayed by its entry.
      const lastLaneCandidateAt = state.lastCandidateAtByLane[cooldownLane];
      const elapsedSinceLastMs = now - lastLaneCandidateAt;
      if (elapsedSinceLastMs < this.cooldownMs && lastLaneCandidateAt > 0) {
        // Within cooldown — report blocked, not new
        this.recordOutcome(state, now, false, `cooldown: ${Math.ceil((this.cooldownMs - elapsedSinceLastMs) / 1000)}s remaining`);
        return {
          symbol,
          evaluatedAt: new Date(now),
          result: {
            ok: false,
            reason: `Cooldown active: ${Math.ceil((this.cooldownMs - elapsedSinceLastMs) / 1000)}s remaining`,
            failedGate: "noShadowVeto", // reuse closest semantic gate
            gateSnapshot: candidate.gateSnapshot,
          },
          isNewCandidate: false,
        };
      }

      // New candidate — update state
      state.lastEventKey = candidate.eventKey;
      state.lastCandidateAt = now;
      state.lastCandidateAtByLane[cooldownLane] = now;
      state.consecutiveBlocked = 0;
      state.consecutiveErrors = 0;
      isNewCandidate = true;
      this.recordOutcome(state, now, true, "candidate generated");
    } else if (result.failedGate === "internal_error") {
      state.consecutiveErrors += 1;
      state.consecutiveBlocked = 0;
      this.recordOutcome(state, now, false, `error: ${result.error}`);
    } else {
      state.consecutiveBlocked += 1;
      state.consecutiveErrors = 0;
      this.recordOutcome(state, now, false, result.reason);
    }

    return {
      symbol,
      evaluatedAt: new Date(now),
      result,
      isNewCandidate,
    };
  }

  /**
   * Inspect current health of a symbol's monitor state.
   * Returns undefined if the symbol has never been observed.
   */
  getSymbolHealth(symbol: string): AlertSymbolHealthSnapshot | undefined {
    const state = this.symbolStates.get(symbol);
    if (!state) return undefined;
    return {
      symbol,
      lastEventKey: state.lastEventKey,
      lastCandidateAt: state.lastCandidateAt > 0 ? new Date(state.lastCandidateAt) : null,
      consecutiveBlocked: state.consecutiveBlocked,
      consecutiveErrors: state.consecutiveErrors,
      recentOutcomeCount: state.recentOutcomes.length,
      lastOutcome: state.recentOutcomes.at(-1) ?? null,
    };
  }

  /** Reset the per-symbol state, clearing cooldown and dedupe history. */
  resetSymbol(symbol: string): void {
    this.symbolStates.delete(symbol);
  }

  /** Reset all symbol states. */
  resetAll(): void {
    this.symbolStates.clear();
  }

  private recordOutcome(
    state: AlertSymbolState,
    nowMs: number,
    ok: boolean,
    reason: string,
  ): void {
    state.recentOutcomes.push({ evaluatedAt: nowMs, ok, reason });
    // Bound the history
    if (state.recentOutcomes.length > this.maxOutcomeHistory) {
      state.recentOutcomes.splice(0, state.recentOutcomes.length - this.maxOutcomeHistory);
    }
  }
}

export type AlertSymbolHealthSnapshot = {
  readonly symbol: string;
  readonly lastEventKey: string | undefined;
  readonly lastCandidateAt: Date | null;
  readonly consecutiveBlocked: number;
  readonly consecutiveErrors: number;
  readonly recentOutcomeCount: number;
  readonly lastOutcome: AlertOutcomeEntry | null;
};

// ---------------------------------------------------------------------------
// RadarStatus multi-symbol convenience helper
// ---------------------------------------------------------------------------

/**
 * Evaluate all symbolRadars in a full RadarStatus publication and return the
 * list of new notification candidates.
 *
 * Designed to be called directly from the "status" event publication point.
 * Never throws.
 */
export function observeRadarStatus(
  monitor: AlertMonitor,
  status: RadarStatus,
): AlertMonitorObservation[] {
  const symbolStatuses = status.symbolRadars ?? [];
  const observations: AlertMonitorObservation[] = [];
  for (const symbolStatus of symbolStatuses) {
    try {
      observations.push(monitor.observe(symbolStatus));
    } catch {
      // Per-symbol errors are swallowed — no one symbol failure should block others
    }
  }
  return observations;
}

// ---------------------------------------------------------------------------
// Re-export RadarStatus/RadarSymbolStatus types for convenience
// ---------------------------------------------------------------------------
export type { RadarSymbolStatus, RadarStatus } from "./databentoLive";
