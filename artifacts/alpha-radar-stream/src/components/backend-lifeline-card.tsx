import {
  getGetBackendLifelineQueryKey,
  useGetBackendLifeline,
  type BackendLifelineSnapshot,
} from '@workspace/api-client-react';
import { HeartPulse, ServerCog, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatTime } from '@/lib/utils';

function stateTone(state: BackendLifelineSnapshot['overall']['state']) {
  return state === 'healthy'
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    : state === 'degraded'
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
      : 'border-destructive/40 bg-destructive/5 text-destructive';
}

export function BackendLifelineCard() {
  const { data: lifeline, isLoading, isError } = useGetBackendLifeline({
    query: {
      queryKey: getGetBackendLifelineQueryKey(),
      refetchInterval: 15_000,
      staleTime: 10_000,
    },
  });

  if (isLoading || !lifeline) {
    return (
      <Card className="border-dashed" data-testid="backend-lifeline-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
            <HeartPulse className="h-4 w-4" /> Backend lifeline
          </CardTitle>
          <CardDescription>{isError ? 'The server-owned lifeline projection is temporarily unavailable.' : 'Loading server-owned runtime health.'}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/80 shadow-sm" data-testid="backend-lifeline-card">
      <CardHeader className="border-b border-border/40 bg-muted/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <ServerCog className="h-4 w-4 text-primary" /> Backend lifeline
            </CardTitle>
            <CardDescription className="mt-1.5 text-xs">
              Read-only server ownership and recovery health. Browser activity cannot keep this service alive.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('font-mono text-[10px] uppercase', stateTone(lifeline.overall.state))}>
            {lifeline.overall.state} · {lifeline.recovery.phase.replaceAll('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Listener" value={lifeline.owner.listenerState} detail={lifeline.owner.environment} />
          <Metric label="Transport" value={`${lifeline.transport.streamingSymbols}/${lifeline.symbols.length} streaming`} detail={lifeline.transport.state} />
          <Metric label="Verified events" value={`${lifeline.marketEvents.freshSymbols} fresh`} detail={`${lifeline.marketEvents.missingSymbols} missing · ${lifeline.marketEvents.staleSymbols} stale`} />
          <Metric label="Scanners" value={`${lifeline.scanners.scheduledSymbols} scheduled`} detail={`${lifeline.scanners.delayedSymbols} delayed · ${lifeline.scanners.inactiveSymbols} inactive`} />
        </div>
        <div className="rounded-md border border-border/60 bg-muted/10 p-3 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p>{lifeline.overall.reason}</p>
              <p>{lifeline.recovery.reason}</p>
              <p className="font-mono text-[10px]">Audit {lifeline.auditHash.slice(0, 16)}… · {formatTime(lifeline.observedAt)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-medium text-foreground">{value}</p>
      <p className="mt-1 truncate text-[9px] text-muted-foreground">{detail}</p>
    </div>
  );
}