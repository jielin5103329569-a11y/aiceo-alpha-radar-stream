import type { RadarConnectionState } from "./databentoLive";

export type MarketFeedState = "streaming" | "stale" | "offline";

export const MARKET_FEED_STALE_AFTER_MS = 15_000;

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

  const ageMs = Math.max(0, now.getTime() - lastUpdatedAt.getTime());
  return ageMs <= MARKET_FEED_STALE_AFTER_MS ? "streaming" : "stale";
}