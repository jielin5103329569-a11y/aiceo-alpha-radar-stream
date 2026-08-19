import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetRadarStatus, getGetRadarStatusQueryKey } from '@workspace/api-client-react';
import type { RadarStatus } from '@workspace/api-client-react';

export function useRadarStream() {
  const queryClient = useQueryClient();
  
  const [liveStatus, setLiveStatus] = useState<RadarStatus | null>(null);
  const [sseError, setSseError] = useState<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // We use the generated hook for the initial load and fallback state.
  // If SSE is failing, we fall back to polling as a recovery path.
  const { data: initialStatus, isLoading, error: queryError } = useGetRadarStatus({
    query: {
      queryKey: getGetRadarStatusQueryKey(),
      refetchInterval: (query) => {
        // Fallback to polling every 2s if EventSource is failing
        return sseError ? 2000 : false;
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
        if (sseError) setSseError(false); // recover from error state
        // Sync query cache so it's fresh if other components need it
        queryClient.setQueryData(getGetRadarStatusQueryKey(), data);
      } catch {
        setSseError(true);
      }
    };

    es.addEventListener('status', handleStatusEvent);
    es.onmessage = handleStatusEvent;
    es.onerror = () => {
      setSseError(true);
      // EventSource tries to reconnect automatically.
    };

    return () => {
      es.removeEventListener('status', handleStatusEvent);
      es.close();
      eventSourceRef.current = null;
    };
  }, [queryClient, sseError]);

  // Merge state: if live status is available, use it. Otherwise, use initial fetched status.
  const status = liveStatus ?? initialStatus ?? null;
  
  // The stream is broken if there's an SSE error and the connection is supposed to be 'streaming'
  const isError = Boolean(queryError || (sseError && status?.connectionState === 'streaming'));

  return { status, isLoading, isError };
}
