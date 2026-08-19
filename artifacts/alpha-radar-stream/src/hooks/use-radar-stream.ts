import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetRadarStatus, getGetRadarStatusQueryKey } from '@workspace/api-client-react';
import type { RadarStatus } from '@workspace/api-client-react';

export function useRadarStream() {
  const queryClient = useQueryClient();
  
  const [liveStatus, setLiveStatus] = useState<RadarStatus | null>(null);
  const [transportState, setTransportState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);

  // We use the generated hook for the initial load and fallback state.
  // If SSE is failing, we fall back to polling as a recovery path.
  const { data: initialStatus, isLoading, error: queryError } = useGetRadarStatus({
    query: {
      queryKey: getGetRadarStatusQueryKey(),
      refetchInterval: (query) => {
        // Maintain a safe REST fallback while the browser re-establishes SSE.
        return transportState === 'connected' ? false : 2000;
      },
      staleTime: 5000,
    }
  });

  useEffect(() => {
    // Only open SSE once the component mounts
    const url = '/api/radar/events';
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const handleStatusEvent = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as RadarStatus;
        setLiveStatus(data);
        setTransportState('connected');
        // Sync query cache so it's fresh if other components need it
        queryClient.setQueryData(getGetRadarStatusQueryKey(), data);
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
      setTransportState('reconnecting');
      // EventSource retries using the server-provided reconnect delay.
    };

    return () => {
      es.removeEventListener('status', handleStatusEvent);
      es.close();
      eventSourceRef.current = null;
    };
  }, [queryClient]);

  // Merge state: if live status is available, use it. Otherwise, use initial fetched status.
  const status = liveStatus ?? initialStatus ?? null;
  
  const isError = Boolean(queryError || status?.connectionState === 'error');

  return { status, isLoading, isError, transportState };
}
