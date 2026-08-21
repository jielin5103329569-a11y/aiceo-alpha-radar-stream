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

export function useRadarStream() {
  const [lastSuccessfulStatus, setLastSuccessfulStatus] = useState<RadarStatus | null>(null);
  const [hasReceivedStatus, setHasReceivedStatus] = useState(false);
  const [transportState, setTransportState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [restFallbackAvailable, setRestFallbackAvailable] = useState(false);
  const [needsRestEpochConfirmation, setNeedsRestEpochConfirmation] = useState(true);
  const acceptedStatusRef = useRef<RadarStatus | null>(null);
  const retiredEpochsRef = useRef<ReadonlySet<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);

  // We use the generated hook for the initial load and fallback state.
  // If SSE is failing, we fall back to polling as a recovery path.
  const { data: initialStatus, isLoading, error: queryError } = useGetRadarStatus({
    query: {
      queryKey: getGetRadarStatusQueryKey(),
      refetchInterval: (query) => {
        // Maintain a safe REST fallback while the browser re-establishes SSE.
        return shouldPollRestStatus(transportState, needsRestEpochConfirmation) ? 2000 : false;
      },
      staleTime: 5000,
    }
  });

  const acceptStatus = (incomingStatus: RadarStatus, transport: RadarStatusTransport): void => {
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
      setNeedsRestEpochConfirmation(false);
    }
    if (selected.status === acceptedStatusRef.current) return;
    acceptedStatusRef.current = selected.status;
    setLastSuccessfulStatus(selected.status);
    setHasReceivedStatus(true);
  };

  useEffect(() => {
    if (!initialStatus) return;
    setRestFallbackAvailable(!queryError);
    if (queryError) return;

    acceptStatus(initialStatus, 'rest');
  }, [initialStatus, queryError]);

  useEffect(() => {
    if (queryError) setRestFallbackAvailable(false);
  }, [queryError]);

  useEffect(() => {
    // Only open SSE once the component mounts
    const url = '/api/radar/events';
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const handleStatusEvent = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as RadarStatus;
        acceptStatus(data, 'sse');
        setTransportState('connected');
      } catch {
        setTransportState('reconnecting');
      }
    };

    es.addEventListener('status', handleStatusEvent);
    es.onmessage = handleStatusEvent;
    es.onopen = () => {
      setTransportState('connected');
      // An EventSource open proves only that a stream socket exists. Keep REST
      // polling until it confirms the current server epoch, because delayed
      // old-epoch SSE events are intentionally not trusted to switch epochs.
      setNeedsRestEpochConfirmation(true);
    };
    es.onerror = () => {
      setTransportState('reconnecting');
      setNeedsRestEpochConfirmation(true);
      // EventSource retries using the server-provided reconnect delay.
    };

    return () => {
      es.removeEventListener('status', handleStatusEvent);
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Keep the last valid state visible while REST/SSE reconnects. A transport
  // failure is not a reason to erase already verified UI state.
  const status = lastSuccessfulStatus ?? initialStatus ?? null;
  
  const backendUnavailable = isBackendUnavailable(
    hasReceivedStatus,
    transportState,
    restFallbackAvailable,
  );
  const isError = Boolean(status?.connectionState === 'error' || backendUnavailable);

  return { status, isLoading, isError, transportState, hasReceivedStatus, backendUnavailable };
}
