import {
  getGetRuntimeSupervisorQueryKey,
  useGetRuntimeSupervisor,
  type RuntimeSupervisorSnapshot,
} from '@workspace/api-client-react';
import { Activity, CircleAlert, Eye, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatTime } from '@/lib/utils';

function stateTone(state: RuntimeSupervisorSnapshot['state']) {
  return state === 'healthy'
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    : state === 'recovering'
      ? 'border-primary/40 bg-primary/10 text-primary'
      : state === 'degraded'
        ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
        : 'border-destructive/40 bg-destructive/5 text-destructive';
}

export function RuntimeSupervisorCard() {
  const { data: supervisor, isLoading, isError } = useGetRuntimeSupervisor({
    query: {
      queryKey: getGetRuntimeSupervisorQueryKey(),
      refetchInterval: 10_000,
      staleTime: 7_500,
    },
  });

  if (isLoading || !supervisor) {
    return (
      <Card className="border-dashed" data-testid="runtime-supervisor-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
            <Activity className="h-4 w-4" /> Runtime supervisor
          </CardTitle>
          <CardDescription>
            {isError
              ? 'The operational supervisor projection is temporarily unavailable. Market status remains separate.'
              : 'Loading server-owned recovery supervision.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/80 shadow-sm" data-testid="runtime-supervisor-card">
      <CardHeader className="border-b border-border/40 bg-muted/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" /> Runtime supervisor
            </CardTitle>
            <CardDescription className="mt-1.5 text-xs">
              Bounded server-owned observation and safe local lease recovery. It never changes market evidence.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('font-mono text-[10px] uppercase', stateTone(supervisor.state))}>
            {supervisor.state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Process" value={supervisor.application.process} />
          <Metric label="Live feed" value={supervisor.application.liveFeed} />
          <Metric label="Alert worker" value={supervisor.application.alertService} />
          <Metric label="Local leases" value={supervisor.application.internalExecution} />
          <Metric label="SSE observers" value={String(supervisor.application.dashboardDelivery.activeSseConnections)} />
        </div>

        {supervisor.incidents.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <CircleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
              Active operational incidents
            </div>
            {supervisor.incidents.slice(0, 3).map((incident) => (
              <div key={incident.incidentKey} className="rounded border border-border/60 bg-background/60 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase text-foreground">
                    {incident.component.replaceAll('_', ' ')} · {incident.state}
                  </p>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    retry {incident.recoveryAttempts}/{supervisor.recovery.maxAttempts}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{incident.reason}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-3 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2">
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p>{supervisor.reason}</p>
              <p>{supervisor.externalPlatform.reason}</p>
              <p>{supervisor.recovery.reason}</p>
              <p className="flex items-center gap-1 font-mono text-[10px]">
                <ShieldCheck className="h-3 w-3" />
                Audit {supervisor.auditHash.slice(0, 16)}… · inspected {formatTime(supervisor.lastInspectionAt)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-medium text-foreground">{value.replaceAll('_', ' ')}</p>
    </div>
  );
}