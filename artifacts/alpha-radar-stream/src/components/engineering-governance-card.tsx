import {
  getGetEngineeringGovernanceQueryKey,
  useGetEngineeringGovernance,
  type EngineeringGovernanceSnapshot,
} from '@workspace/api-client-react';
import { ClipboardCheck, CircleAlert, Workflow } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatTime } from '@/lib/utils';

function healthTone(state: EngineeringGovernanceSnapshot['state']) {
  return state === 'healthy'
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    : state === 'degraded'
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
      : 'border-destructive/40 bg-destructive/5 text-destructive';
}

export function EngineeringGovernanceCard() {
  const { data: governance, isLoading, isError } = useGetEngineeringGovernance({
    query: {
      queryKey: getGetEngineeringGovernanceQueryKey(),
      refetchInterval: 15_000,
      staleTime: 10_000,
    },
  });

  if (isLoading || !governance) {
    return (
      <Card className="border-dashed" data-testid="engineering-governance-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
            <Workflow className="h-4 w-4" /> Engineering governance
          </CardTitle>
          <CardDescription>{isError ? 'Governance projection is temporarily unavailable.' : 'Loading the read-only governance projection.'}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/80 shadow-sm" data-testid="engineering-governance-card">
      <CardHeader className="border-b border-border/40 bg-muted/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <ClipboardCheck className="h-4 w-4 text-primary" /> Engineering governance
            </CardTitle>
            <CardDescription className="mt-1.5 text-xs">
              Read-only admission, capacity, and boundary audit. It cannot start work or affect the live radar.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('font-mono text-[10px] uppercase', healthTone(governance.state))}>
            {governance.state} · {governance.healthScore}/100
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <Metric label="Protected scanners" value={String(governance.runtime.protectedScannerCount)} />
          <Metric label="Delayed scanners" value={String(governance.runtime.delayedScannerCount)} />
          <Metric label="Internal slots" value={`${governance.taskQueue.activeSlots}/${governance.taskQueue.maximumSlots}`} />
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          {governance.executionOrder.map((step) => (
            <div key={step.id} className="rounded-md border border-border/60 bg-muted/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{step.label}</p>
                <Badge variant="outline" className={cn(
                  'text-[9px] uppercase',
                  step.state === 'ready'
                    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
                )}>
                  {step.state}
                </Badge>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{step.reason}</p>
            </div>
          ))}
        </div>
        <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-3 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              <p>{governance.platformBoundary.reason}</p>
              <p>{governance.runtime.backgroundResourcePolicy}</p>
              <p className="font-mono text-[10px]">Audit {governance.auditHash.slice(0, 16)}… · {formatTime(governance.generatedAt)}</p>
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
      <p className="mt-1 font-mono text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}