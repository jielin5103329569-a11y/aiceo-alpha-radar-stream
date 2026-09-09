import { useEffect, useRef, useState } from 'react';
import type { RadarStatus } from '@workspace/api-client-react';

const SNAPSHOT_REVIEW_SCROLL_THRESHOLD_PX = 64;
const FOREGROUND_SNAPSHOT_REFRESH_MS = 5_000;

export function shouldBypassSnapshotReviewHold(
  foregroundRefreshUntil: number,
  now = Date.now(),
): boolean {
  return foregroundRefreshUntil >= now;
}

/**
 * Keep the Universe evidence visible at the top of a review bound to the
 * opportunity and ranking cards reached later in the same downward scroll.
 * The newest queued snapshot replaces the whole presentation on return to the
 * top. A snapshot that is or becomes actionable bypasses the hold so stale
 * alert readiness can never remain visible.
 */
export function useUniverseSnapshotPresentation(
  liveStatus: RadarStatus | null,
): RadarStatus | null {
  const [presentedStatus, setPresentedStatus] = useState<RadarStatus | null>(liveStatus);
  const presentedRef = useRef<RadarStatus | null>(liveStatus);
  const pendingRef = useRef<RadarStatus | null>(null);
  const foregroundRefreshUntilRef = useRef(0);

  useEffect(() => {
    if (!liveStatus) return;
    const current = presentedRef.current;
    const reviewingSnapshot =
      typeof window !== 'undefined'
      && window.scrollY > SNAPSHOT_REVIEW_SCROLL_THRESHOLD_PX;

    if (
      current === null
      || !reviewingSnapshot
      || shouldBypassSnapshotReviewHold(foregroundRefreshUntilRef.current)
    ) {
      pendingRef.current = null;
      presentedRef.current = liveStatus;
      setPresentedStatus(liveStatus);
      return;
    }

    pendingRef.current = liveStatus;
    const actionableSnapshot =
      current.opportunityCenter.opportunities.some((opportunity) => opportunity.alertReady)
      || liveStatus.opportunityCenter.opportunities.some((opportunity) => opportunity.alertReady);
    if (actionableSnapshot) {
      pendingRef.current = null;
      presentedRef.current = liveStatus;
      setPresentedStatus(liveStatus);
    }
  }, [liveStatus]);

  useEffect(() => {
    const flushAtTop = () => {
      if (window.scrollY > SNAPSHOT_REVIEW_SCROLL_THRESHOLD_PX) return;
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      presentedRef.current = pending;
      setPresentedStatus(pending);
    };

    window.addEventListener('scroll', flushAtTop, { passive: true });
    return () => window.removeEventListener('scroll', flushAtTop);
  }, []);

  useEffect(() => {
    const refreshAfterForegroundReturn = () => {
      if (document.visibilityState === 'hidden') return;
      foregroundRefreshUntilRef.current = Date.now() + FOREGROUND_SNAPSHOT_REFRESH_MS;
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      presentedRef.current = pending;
      setPresentedStatus(pending);
    };
    document.addEventListener('visibilitychange', refreshAfterForegroundReturn);
    window.addEventListener('focus', refreshAfterForegroundReturn);
    window.addEventListener('pageshow', refreshAfterForegroundReturn);
    window.addEventListener('online', refreshAfterForegroundReturn);
    return () => {
      document.removeEventListener('visibilitychange', refreshAfterForegroundReturn);
      window.removeEventListener('focus', refreshAfterForegroundReturn);
      window.removeEventListener('pageshow', refreshAfterForegroundReturn);
      window.removeEventListener('online', refreshAfterForegroundReturn);
    };
  }, []);

  return presentedStatus;
}