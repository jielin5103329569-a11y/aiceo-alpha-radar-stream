import { useEffect, useRef, useState } from 'react';
import type { RadarStatus } from '@workspace/api-client-react';
import { createRadarRecoveryProjection } from '@/hooks/use-radar-stream';

const SNAPSHOT_REVIEW_SCROLL_THRESHOLD_PX = 64;

function isSafetyDegradation(
  current: RadarStatus,
  incoming: RadarStatus,
): boolean {
  if (
    incoming.connectionState === 'error'
    || incoming.connectionState === 'stopped'
    || incoming.connectionState === 'not_configured'
    || (current.marketFeedState === 'streaming' && incoming.marketFeedState !== 'streaming')
  ) {
    return true;
  }

  const currentSymbols = new Map(
    current.symbolRadars.map((symbol) => [symbol.symbol, symbol]),
  );
  if (incoming.symbolRadars.some((symbol) => {
    const previous = currentSymbols.get(symbol.symbol);
    return previous !== undefined && (
      (previous.marketFeedState === 'streaming' && symbol.marketFeedState !== 'streaming')
      || (previous.marketWindowSettlement.complete && !symbol.marketWindowSettlement.complete)
      || (previous.scanHealth.marketDataGateReady && !symbol.scanHealth.marketDataGateReady)
    );
  })) {
    return true;
  }

  const currentOpportunities = new Map(
    current.opportunityCenter.opportunities.map((opportunity) => [
      opportunity.symbol,
      opportunity,
    ]),
  );
  return incoming.opportunityCenter.opportunities.some((opportunity) => {
    const previous = currentOpportunities.get(opportunity.symbol);
    return previous !== undefined && (
      (previous.marketState === 'fresh' && opportunity.marketState !== 'fresh')
      || (previous.alertReady && !opportunity.alertReady)
    );
  });
}

function createHeldSnapshotSafetyProjection(status: RadarStatus): RadarStatus {
  const projected = createRadarRecoveryProjection(status);
  return {
    ...projected,
    opportunityCenter: {
      ...projected.opportunityCenter,
      opportunities: projected.opportunityCenter.opportunities.map((opportunity) => ({
        ...opportunity,
        alertReadyReason:
          'This held Universe snapshot is fail-closed while newer live evidence remains queued.',
      })),
      reason:
        'Reviewing one held Universe snapshot. Newer live evidence will replace every card together at the top of the page.',
    },
  };
}

/**
 * Keep the Universe evidence visible at the top of a review bound to the
 * opportunity and ranking cards reached later in the same downward scroll.
 * The newest queued snapshot replaces the whole presentation on return to the
 * top. Safety degradation bypasses the hold and replaces every card together.
 */
export function useUniverseSnapshotPresentation(
  liveStatus: RadarStatus | null,
): RadarStatus | null {
  const [presentedStatus, setPresentedStatus] = useState<RadarStatus | null>(liveStatus);
  const presentedRef = useRef<RadarStatus | null>(liveStatus);
  const pendingRef = useRef<RadarStatus | null>(null);

  useEffect(() => {
    if (!liveStatus) return;
    const current = presentedRef.current;
    const reviewingSnapshot =
      typeof window !== 'undefined'
      && window.scrollY > SNAPSHOT_REVIEW_SCROLL_THRESHOLD_PX;

    if (current === null || !reviewingSnapshot) {
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
      return;
    }
    if (isSafetyDegradation(current, liveStatus)) {
      const gatedCurrent = createHeldSnapshotSafetyProjection(current);
      presentedRef.current = gatedCurrent;
      setPresentedStatus(gatedCurrent);
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

  return presentedStatus;
}