import { useEffect, useRef, useState } from 'react';
import { useGetRadarStatus, getGetRadarStatusQueryKey } from '@workspace/api-client-react';
import type { RadarStatus } from '@workspace/api-client-react';

/**
 * Returns a valid server-issued status revision or null. This is intentionally
 * separate from market-event timestamps, which may be unchanged or absent
 * while connection, recovery, or error state changes.
 */
export function radarStatusRevision(status: RadarStatus | null | undefined): number | null {
  const revision = status?.statusRevision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : null;
}

export function radarStatusEpoch(status: RadarStatus | null | undefined): string | null {
  const epoch = status?.statusEpoch;
  return typeof epoch === 'string' && epoch.length > 0 ? epoch : null;
}

export type RadarStatusTransport = 'rest' | 'sse';

export type RadarStatusSelection = {
  status: RadarStatus | null;
  retiredEpochs: ReadonlySet<string>;
};

const RADAR_STATUS_STORAGE_KEY = 'alpha-radar:last-accepted-status:v1';

export function hasCoherentRadarScan(status: RadarStatus | null | undefined): status is RadarStatus {
  if (
    !status
    || typeof status.scanId !== 'string'
    || status.scanId.length === 0
    || status.marketWindowSettlement.scanId !== status.scanId
    || status.symbolRadars.length !== 5
    || status.symbolRadars.some(
      (symbol) =>
        symbol.scanId !== status.scanId
        || symbol.marketWindowSettlement.scanId !== status.scanId,
    )
  ) {
    return false;
  }
  const symbolFeedStates = status.symbolRadars.map((symbol) => symbol.marketFeedState);
  const anyOffline = status.marketFeedState === 'offline'
    || symbolFeedStates.some((state) => state === 'offline');
  if (
    anyOffline
    && (
      status.marketFeedState !== 'offline'
      || symbolFeedStates.some((state) => state !== 'offline')
    )
  ) {
    return false;
  }
  return status.opportunityCenter.scanId === status.scanId
    && status.opportunityCenter.opportunities.every(
      (opportunity) => opportunity.scanId === status.scanId,
    );
}

/**
 * A cached snapshot is presentation continuity only. Until REST confirms the
 * active server epoch, every market and opportunity gate is explicitly stale.
 */
export function createRadarRecoveryProjection(status: RadarStatus): RadarStatus {
  const missingSegments: RadarStatus['marketWindowSettlement']['missingSegments'] = [
    'quote',
    'trade',
    'volume',
    'heartbeat',
  ];
  type StatusNetwork = {
    heartbeatFresh?: boolean;
    marketEventFresh?: boolean;
    marketEventPathHealthy?: boolean;
    alertReady?: boolean;
    recovery?: {
      state?: string;
      windowResetRequired?: boolean;
      reason?: string;
      [key: string]: unknown;
    };
    reason?: string;
    [key: string]: unknown;
  };
  const gateNetwork = (network: StatusNetwork): StatusNetwork => ({
    ...network,
    heartbeatFresh: false,
    marketEventFresh: false,
    marketEventPathHealthy: false,
    alertReady: false,
    recovery: {
      ...network.recovery,
      state: 'rebuilding_window',
      windowResetRequired: true,
      reason: 'REST must confirm the current server epoch before live alert readiness can resume.',
    },
    reason: 'Cached transport and market-event health are not live alert evidence.',
  });
  const gateAlphaRadar = (alphaRadar: RadarStatus['alphaRadar']): RadarStatus['alphaRadar'] => ({
    ...alphaRadar,
    score: null,
    scoreState: 'stale',
    dataQuality: 'stale',
    changeIndicators: {
      ...alphaRadar.changeIndicators,
      volumeAcceleration: null,
    },
    preBreakoutWatch: false,
    preBreakout: {
      ...alphaRadar.preBreakout,
      dataFresh: false,
      confirmation: {
        ...alphaRadar.preBreakout.confirmation,
        status: 'pending',
        reason: 'REST must confirm the current server epoch before live confirmation can resume.',
      },
    },
  });
  const gateScanHealth = (scanHealth: RadarStatus['scanHealth']): RadarStatus['scanHealth'] => ({
    ...scanHealth,
    marketDataState: 'stale',
    marketDataGateReady: false,
    degradation: 'stale_market_data',
    reason: 'Showing the last accepted snapshot while REST confirms the current server epoch.',
  });
  const gateWindow = (
    settlement: RadarStatus['marketWindowSettlement'],
  ): RadarStatus['marketWindowSettlement'] => ({
    ...settlement,
    quote: false,
    trade: false,
    volume: false,
    heartbeat: false,
    complete: false,
    missingSegments: [...missingSegments],
  });
  const gateIngestion = (
    ingestion: RadarStatus['liveIngestion'],
  ): RadarStatus['liveIngestion'] => {
    const runtimeNetwork = (
      ingestion as RadarStatus['liveIngestion'] & { network?: StatusNetwork }
    ).network;
    return {
      ...ingestion,
      ...(runtimeNetwork ? { network: gateNetwork(runtimeNetwork) } : {}),
      acceptanceState: 'stale',
      conditions: {
        ...ingestion.conditions,
        quoteFresh: false,
        tradeFresh: false,
        priceFresh: false,
        volumeFresh: false,
        scoringEligible: false,
        triggerEvidenceAvailable: false,
      },
      scoringStatus: {
        ...ingestion.scoringStatus,
        scoreState: 'stale',
        score: null,
        freshness: 'stale',
        dataQuality: 'stale',
        gateReason: 'rest_epoch_confirmation_pending',
      },
      reason: 'Showing cached evidence while REST confirms the current server epoch.',
    };
  };
  const symbolRadars = status.symbolRadars.map((symbol) => ({
    ...symbol,
    ...((symbol as typeof symbol & { network?: StatusNetwork }).network
      ? { network: gateNetwork((symbol as typeof symbol & { network: StatusNetwork }).network) }
      : {}),
    marketFeedState: 'stale' as const,
    alphaRadar: gateAlphaRadar(symbol.alphaRadar),
    scanHealth: gateScanHealth(symbol.scanHealth),
    marketWindowSettlement: gateWindow(symbol.marketWindowSettlement),
    liveIngestion: gateIngestion(symbol.liveIngestion),
  }));
  return {
    ...status,
    ...((status as RadarStatus & { network?: StatusNetwork }).network
      ? { network: gateNetwork((status as RadarStatus & { network: StatusNetwork }).network) }
      : {}),
    marketFeedState: 'stale',
    alphaRadar: gateAlphaRadar(status.alphaRadar),
    scanHealth: gateScanHealth(status.scanHealth),
    marketWindowSettlement: gateWindow(status.marketWindowSettlement),
    liveIngestion: gateIngestion(status.liveIngestion),
    symbolRadars,
    opportunityCenter: {
      ...status.opportunityCenter,
      opportunities: status.opportunityCenter.opportunities.map((opportunity) => ({
        ...opportunity,
        freshness: 'stale',
        direction: 'unavailable',
        alphaVelocity30s: null,
        acceleration: null,
        state: 'WATCH',
        marketState: 'stale',
        alertReady: false,
        alertReadyReason: 'Alert handoff remains gated until REST confirms the current server epoch.',
        missingConfirmationItems: [
          ...new Set([
            ...opportunity.missingConfirmationItems,
            'Fresh complete protected market window',
          ]),
        ],
      })),
      reason: 'Restoring the last accepted snapshot; live opportunity handoff remains gated until REST confirms the current epoch.',
    },
  };
}

function loadAcceptedRadarStatus(): RadarStatus | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(RADAR_STATUS_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as RadarStatus;
    return hasCoherentRadarScan(parsed) ? parsed : null;
  } catch {
    window.sessionStorage.removeItem(RADAR_STATUS_STORAGE_KEY);
    return null;
  }
}

function persistAcceptedRadarStatus(status: RadarStatus): void {
  if (typeof window === 'undefined' || !hasCoherentRadarScan(status)) return;
  try {
    window.sessionStorage.setItem(RADAR_STATUS_STORAGE_KEY, JSON.stringify(status));
  } catch {
    // Storage availability is not allowed to affect live status acceptance.
  }
}

/**
 * Accept only a strictly newer server-issued snapshot in the current epoch.
 * A REST response is the authoritative way to adopt a new server epoch after
 * an API restart. Retired epochs remain rejected so delayed old SSE/REST
 * responses can never take the dashboard backward.
 */
export function selectLatestRadarStatus(
  currentStatus: RadarStatus | null,
  incomingStatus: RadarStatus | null | undefined,
  transport: RadarStatusTransport,
  retiredEpochs: ReadonlySet<string>,
): RadarStatusSelection {
  if (!incomingStatus) return { status: currentStatus, retiredEpochs };
  if (!currentStatus) return { status: incomingStatus, retiredEpochs };

  const currentEpoch = radarStatusEpoch(currentStatus);
  const incomingEpoch = radarStatusEpoch(incomingStatus);
  const currentRevision = radarStatusRevision(currentStatus);
  const incomingRevision = radarStatusRevision(incomingStatus);
  if (incomingEpoch === null || incomingRevision === null) {
    return { status: currentStatus, retiredEpochs };
  }
  if (currentEpoch === null || currentRevision === null) {
    return { status: incomingStatus, retiredEpochs };
  }
  if (incomingEpoch === currentEpoch) {
    return {
      status: incomingRevision > currentRevision ? incomingStatus : currentStatus,
      retiredEpochs,
    };
  }
  if (retiredEpochs.has(incomingEpoch) || transport !== 'rest') {
    return { status: currentStatus, retiredEpochs };
  }

  const nextRetiredEpochs = new Set(retiredEpochs);
  nextRetiredEpochs.add(currentEpoch);
  return { status: incomingStatus, retiredEpochs: nextRetiredEpochs };
}

export function isBackendUnavailable(
  hasReceivedStatus: boolean,
  transportState: 'connecting' | 'connected' | 'reconnecting',
  restFallbackAvailable: boolean,
): boolean {
  return hasReceivedStatus && transportState !== 'connected' && !restFallbackAvailable;
}

export function shouldPollRestStatus(
  transportState: 'connecting' | 'connected' | 'reconnecting',
  needsRestEpochConfirmation: boolean,
): boolean {
  return transportState !== 'connected' || needsRestEpochConfirmation;
}

export function shouldOpenRadarSse(
  needsRestEpochConfirmation: boolean,
  confirmedRestEpoch: string | null,
): boolean {
  return !needsRestEpochConfirmation && confirmedRestEpoch !== null;
}

export function useRadarStream() {
  const restoredStatusRef = useRef<RadarStatus | null | undefined>(undefined);
  if (restoredStatusRef.current === undefined) {
    restoredStatusRef.current = loadAcceptedRadarStatus();
  }
  const restoredStatus = restoredStatusRef.current;
  const [lastSuccessfulStatus, setLastSuccessfulStatus] = useState<RadarStatus | null>(
    restoredStatus ? createRadarRecoveryProjection(restoredStatus) : null,
  );
  const [hasReceivedStatus, setHasReceivedStatus] = useState(Boolean(restoredStatus));
  const [transportState, setTransportState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [restFallbackAvailable, setRestFallbackAvailable] = useState(false);
  const [needsRestEpochConfirmation, setNeedsRestEpochConfirmation] = useState(true);
  const acceptedStatusRef = useRef<RadarStatus | null>(restoredStatus);
  const retiredEpochsRef = useRef<ReadonlySet<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const confirmedRestEpochRef = useRef<string | null>(null);

  // We use the generated hook for the initial load and fallback state.
  // If SSE is failing, we fall back to polling as a recovery path.
  const {
    data: initialStatus,
    dataUpdatedAt,
    isFetchedAfterMount,
    isLoading,
    error: queryError,
  } = useGetRadarStatus({
    query: {
      queryKey: getGetRadarStatusQueryKey(),
      refetchInterval: (query) => {
        // Maintain a safe REST fallback while the browser re-establishes SSE.
        return shouldPollRestStatus(transportState, needsRestEpochConfirmation) ? 2000 : false;
      },
      staleTime: 0,
      refetchOnMount: 'always',
    }
  });

  const acceptStatus = (incomingStatus: RadarStatus, transport: RadarStatusTransport): boolean => {
    if (!hasCoherentRadarScan(incomingStatus)) return false;
    if (
      transport === 'sse'
      && radarStatusEpoch(incomingStatus) !== confirmedRestEpochRef.current
    ) {
      return false;
    }
    const selected = selectLatestRadarStatus(
      acceptedStatusRef.current,
      incomingStatus,
      transport,
      retiredEpochsRef.current,
    );
    retiredEpochsRef.current = selected.retiredEpochs;
    if (
      transport === 'rest'
      && radarStatusEpoch(selected.status) === radarStatusEpoch(incomingStatus)
    ) {
      confirmedRestEpochRef.current = radarStatusEpoch(incomingStatus);
      setNeedsRestEpochConfirmation(false);
    }
    if (selected.status === acceptedStatusRef.current) {
      if (transport === 'rest' && selected.status) {
        setLastSuccessfulStatus(selected.status);
        persistAcceptedRadarStatus(selected.status);
      }
      return true;
    }
    acceptedStatusRef.current = selected.status;
    setLastSuccessfulStatus(selected.status);
    setHasReceivedStatus(true);
    if (selected.status) persistAcceptedRadarStatus(selected.status);
    return true;
  };

  useEffect(() => {
    if (!isFetchedAfterMount || !initialStatus) return;
    setRestFallbackAvailable(!queryError);
    if (queryError) return;

    acceptStatus(initialStatus, 'rest');
  }, [initialStatus, dataUpdatedAt, isFetchedAfterMount, queryError]);

  useEffect(() => {
    if (queryError) setRestFallbackAvailable(false);
  }, [queryError]);

  useEffect(() => {
    if (!shouldOpenRadarSse(needsRestEpochConfirmation, confirmedRestEpochRef.current)) return;
    const url = '/api/radar/events';
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const handleStatusEvent = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as RadarStatus;
        if (acceptStatus(data, 'sse')) {
          setTransportState('connected');
        }
      } catch {
        setTransportState('reconnecting');
      }
    };

    es.addEventListener('status', handleStatusEvent);
    es.onmessage = handleStatusEvent;
    es.onopen = () => {
      setTransportState('connected');
    };
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      confirmedRestEpochRef.current = null;
      if (acceptedStatusRef.current) {
        setLastSuccessfulStatus(createRadarRecoveryProjection(acceptedStatusRef.current));
      }
      setTransportState('reconnecting');
      setNeedsRestEpochConfirmation(true);
    };

    return () => {
      es.removeEventListener('status', handleStatusEvent);
      es.close();
      eventSourceRef.current = null;
    };
  }, [needsRestEpochConfirmation]);

  // Keep the last valid state visible while REST/SSE reconnects. A transport
  // failure is not a reason to erase already verified UI state.
  const status = lastSuccessfulStatus;
  
  const backendUnavailable = isBackendUnavailable(
    hasReceivedStatus,
    transportState,
    restFallbackAvailable,
  );
  const isError = Boolean(status?.connectionState === 'error' || backendUnavailable);

  return { status, isLoading, isError, transportState, hasReceivedStatus, backendUnavailable };
}
