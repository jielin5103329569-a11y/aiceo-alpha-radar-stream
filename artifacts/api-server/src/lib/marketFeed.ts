import type { RadarConnectionState } from "./databentoLive";

export type MarketFeedState = "streaming" | "stale" | "offline";

export const MARKET_FEED_STALE_AFTER_MS = 15_000;

export function marketEventIsFresh(eventTimestamp: Date, now: Date): boolean {
  const ageMs = Math.max(0, now.getTime() - eventTimestamp.getTime());
  return ageMs <= MARKET_FEED_STALE_AFTER_MS;
}

export function marketFeedStateFor(
  connectionState: RadarConnectionState,
  lastUpdatedAt: Date | null,
  now: Date,
): MarketFeedState {
  if (
    connectionState === "error"
    || connectionState === "stopped"
    || connectionState === "not_configured"
  ) {
    return "offline";
  }

  if (!lastUpdatedAt) {
    return "stale";
  }

  return marketEventIsFresh(lastUpdatedAt, now) ? "streaming" : "stale";
}

export function shouldResetAnalysisWindow(
  connectionState: RadarConnectionState,
  lastUpdatedAt: Date | null,
  now: Date,
): boolean {
  return lastUpdatedAt !== null
    && marketFeedStateFor(connectionState, lastUpdatedAt, now) === "stale";
}