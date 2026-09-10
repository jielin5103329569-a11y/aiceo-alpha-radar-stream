import { useCallback, useEffect, useRef, useState } from 'react';
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
const PROTECTED_RADAR_SYMBOLS = ['AMD', 'CRDO', 'MU', 'NVDA', 'VRT'] as const;
const FOREGROUND_RECOVERY_COALESCE_MS = 3_000;
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

export function hasCoherentRadarScan(status: RadarStatus | null | undefined): status is RadarStatus {
  const settledAt = status?.marketWindowSettlement.settledAt;
  if (
    !status
    || typeof status.scanId !== 'string'
    || status.scanId.length === 0
    || typeof settledAt !== 'string'
    || settledAt.length === 0
    || status.marketWindowSettlement.scanId !== status.scanId
    || status.symbolRadars.length !== 5
    || status.opportunityCenter.opportunities.length !== 5
    || [...status.symbolRadars.map((symbol) => symbol.symbol)].sort().some(
      (symbol, index) => symbol !== PROTECTED_RADAR_SYMBOLS[index],
    )
    || [...status.opportunityCenter.opportunities.map((opportunity) => opportunity.symbol)].sort().some(
      (symbol, index) => symbol !== PROTECTED_RADAR_SYMBOLS[index],
    )
    || status.symbolRadars.some(
      (symbol) =>
        symbol.scanId !== status.scanId
        || symbol.marketWindowSettlement.scanId !== status.scanId
        || symbol.marketWindowSettlement.settledAt !== settledAt,
    )
  ) {
    return false;
  }
  const expectedFeedState: RadarStatus['marketFeedState'] = status.symbolRadars.every(
    (symbol) =>
      symbol.marketFeedState === 'streaming'
      && symbol.marketWindowSettlement.complete
      && symbol.marketWindowSettlement.missingSegments.length === 0,
  )
    ? 'streaming'
    : status.symbolRadars.every((symbol) => symbol.marketFeedState === 'offline')
      ? 'offline'
      : 'stale';
  if (status.marketFeedState !== expectedFeedState) return false;
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
      (opportunity) =>
        opportunity.scanId === status.scanId
        && opportunity.triggerAt === settledAt,
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

/**
 * Browser-link recovery is not a market-data outage. Preserve the most recent
 * server-verified feed state and evidence window while explicitly withholding
 * alert handoff until REST confirms the active epoch and SSE reconnects.
 */
export function createRadarBrowserRecoveryProjection(status: RadarStatus): RadarStatus {
  const gateNetwork = (network: StatusNetwork): StatusNetwork => ({
    ...network,
    alertReady: false,
    reason: 'Browser live-link confirmation is pending; market transport health remains server-owned.',
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
      conditions: {
        ...ingestion.conditions,
        scoringEligible: false,
        triggerEvidenceAvailable: false,
      },
      reason: 'Displaying the last server-verified market state while the browser live link reconnects.',
    };
  };
  return {
    ...status,
    ...((status as RadarStatus & { network?: StatusNetwork }).network
      ? { network: gateNetwork((status as RadarStatus & { network: StatusNetwork }).network) }
      : {}),
    liveIngestion: gateIngestion(status.liveIngestion),
    symbolRadars: status.symbolRadars.map((symbol) => ({
      ...symbol,
      ...((symbol as typeof symbol & { network?: StatusNetwork }).network
        ? { network: gateNetwork((symbol as typeof symbol & { network: StatusNetwork }).network) }
        : {}),
      liveIngestion: gateIngestion(symbol.liveIngestion),
    })),
    opportunityCenter: {
      ...status.opportunityCenter,
      opportunities: status.opportunityCenter.opportunities.map((opportunity) => ({
        ...opportunity,
        alertReady: false,
        alertReadyReason:
          'Alert handoff is gated while the browser confirms the current REST/SSE connection.',
      })),
      reason:
        'Displaying the last server-verified snapshot while the browser live link reconnects.',
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
  restFallbackKnownUnavailable: boolean,
): boolean {
  return hasReceivedStatus && transportState !== 'connected' && restFallbackKnownUnavailable;
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

export function shouldMarkRadarSseConnected(
  readyState: number,
  confirmedRestEpoch: string | null,
): boolean {
  return readyState === 1 && confirmedRestEpoch !== null;
}

export function shouldStartRadarForegroundRecovery(
  lastStartedAt: number,
  now: number,
  recoveryInFlight: boolean,
): boolean {
  return !recoveryInFlight && now - lastStartedAt >= FOREGROUND_RECOVERY_COALESCE_MS;
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
  const [restFallbackKnownUnavailable, setRestFallbackKnownUnavailable] = useState(false);
  const [needsRestEpochConfirmation, setNeedsRestEpochConfirmation] = useState(true);
  const acceptedStatusRef = useRef<RadarStatus | null>(restoredStatus);
  const retiredEpochsRef = useRef<ReadonlySet<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const confirmedRestEpochRef = useRef<string | null>(null);
  const foregroundRecoveryInFlightRef = useRef(false);
  const lastForegroundRecoveryStartedAtRef = useRef(0);

  // We use the generated hook for the initial load and fallback state.
  // If SSE is failing, we fall back to polling as a recovery path.
  const {
    data: initialStatus,
    dataUpdatedAt,
    isFetchedAfterMount,
    isLoading,
    error: queryError,
    refetch,
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

  const acceptStatus = useCallback((
    incomingStatus: RadarStatus,
    transport: RadarStatusTransport,
  ): boolean => {
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
      const currentEventSource = eventSourceRef.current;
      if (
        currentEventSource
        && shouldMarkRadarSseConnected(
          currentEventSource.readyState,
          confirmedRestEpochRef.current,
        )
      ) {
        setTransportState('connected');
      }
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
  }, []);

  useEffect(() => {
    if (hasReceivedStatus) return;
    const controller = new AbortController();
    void fetch('/api/radar/status', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Initial radar status failed with HTTP ${response.status}.`);
        }
        const incomingStatus = await response.json() as RadarStatus;
        if (!acceptStatus(incomingStatus, 'rest')) {
          throw new Error('Initial radar status returned an incoherent snapshot.');
        }
        setRestFallbackKnownUnavailable(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRestFallbackKnownUnavailable(true);
      });
    return () => controller.abort();
  }, [hasReceivedStatus, acceptStatus]);

  useEffect(() => {
    if (!isFetchedAfterMount || !initialStatus) return;
    if (queryError) return;

    setRestFallbackKnownUnavailable(false);
    acceptStatus(initialStatus, 'rest');
  }, [initialStatus, dataUpdatedAt, isFetchedAfterMount, queryError, acceptStatus]);

  useEffect(() => {
    if (queryError) setRestFallbackKnownUnavailable(true);
  }, [queryError]);

  const openRadarSse = useCallback(() => {
    const existingEventSource = eventSourceRef.current;
    if (existingEventSource) {
      existingEventSource.close();
    }
    const url = '/api/radar/events';
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (
        eventSourceRef.current === es
        && shouldMarkRadarSseConnected(es.readyState, confirmedRestEpochRef.current)
      ) {
        setTransportState('connected');
      }
    };

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
    es.onerror = () => {
      if (eventSourceRef.current !== es) return;
      es.close();
      eventSourceRef.current = null;
      confirmedRestEpochRef.current = null;
      if (acceptedStatusRef.current) {
        setLastSuccessfulStatus(createRadarBrowserRecoveryProjection(acceptedStatusRef.current));
      }
      setTransportState('reconnecting');
      setNeedsRestEpochConfirmation(true);
    };

    return es;
  }, [acceptStatus]);

  useEffect(() => {
    if (
      !shouldOpenRadarSse(needsRestEpochConfirmation, confirmedRestEpochRef.current)
      || eventSourceRef.current
    ) {
      return;
    }
    openRadarSse();
  }, [needsRestEpochConfirmation, openRadarSse]);

  useEffect(() => {
    return () => {
      const es = eventSourceRef.current;
      if (!es) return;
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const recoverForegroundConnection = () => {
      const now = Date.now();
      if (
        !hasReceivedStatus
        || document.visibilityState === 'hidden'
        || !shouldStartRadarForegroundRecovery(
          lastForegroundRecoveryStartedAtRef.current,
          now,
          foregroundRecoveryInFlightRef.current,
        )
      ) {
        return;
      }
      lastForegroundRecoveryStartedAtRef.current = now;
      foregroundRecoveryInFlightRef.current = true;
      const existingEventSource = eventSourceRef.current;
      if (existingEventSource) {
        existingEventSource.close();
        eventSourceRef.current = null;
      }
      if (acceptedStatusRef.current) {
        setLastSuccessfulStatus(createRadarBrowserRecoveryProjection(acceptedStatusRef.current));
      }
      setRestFallbackKnownUnavailable(false);
      setTransportState('reconnecting');
      setNeedsRestEpochConfirmation(confirmedRestEpochRef.current === null);
      openRadarSse();
      void fetch('/api/radar/status', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Radar status recovery failed with HTTP ${response.status}.`);
          }
          const incomingStatus = await response.json() as RadarStatus;
          if (!acceptStatus(incomingStatus, 'rest')) {
            throw new Error('Radar status recovery returned an incoherent snapshot.');
          }
          setRestFallbackKnownUnavailable(false);
        })
        .catch(() => {
          setRestFallbackKnownUnavailable(true);
        })
        .finally(() => {
          foregroundRecoveryInFlightRef.current = false;
        });
    };

    document.addEventListener('visibilitychange', recoverForegroundConnection);
    window.addEventListener('focus', recoverForegroundConnection);
    window.addEventListener('pageshow', recoverForegroundConnection);
    window.addEventListener('online', recoverForegroundConnection);
    return () => {
      document.removeEventListener('visibilitychange', recoverForegroundConnection);
      window.removeEventListener('focus', recoverForegroundConnection);
      window.removeEventListener('pageshow', recoverForegroundConnection);
      window.removeEventListener('online', recoverForegroundConnection);
    };
  }, [hasReceivedStatus, acceptStatus, openRadarSse]);

  // Keep the last valid state visible while REST/SSE reconnects. A transport
  // failure is not a reason to erase already verified UI state.
  const status = lastSuccessfulStatus;
  
  const backendUnavailable = isBackendUnavailable(
    hasReceivedStatus,
    transportState,
    restFallbackKnownUnavailable,
  );
  const isError = Boolean(status?.connectionState === 'error');

  return { status, isLoading, isError, transportState, hasReceivedStatus, backendUnavailable };
}
