import { getGetAiIndustryPoolQueryKey, useGetAiIndustryPool } from '@workspace/api-client-react';
import { Database, ShieldAlert, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatTime } from '@/lib/utils';

function stateClass(state: string | undefined): string {
  if (state === 'verified' || state === 'ready') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (state === 'blocked' || state === 'unavailable' || state === 'withheld') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

export function AiIndustryPoolCard() {
  const { data, isLoading } = useGetAiIndustryPool({
    query: { queryKey: getGetAiIndustryPoolQueryKey(), refetchInterval: 30_000, staleTime: 10_000 },
  });
  const used = data?.historicalDistinctCount ?? 0;

  return (
    <Card className="scroll-mt-20" data-testid="ai-industry-pool">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Industry Opportunity Pool
            </CardTitle>
            <CardDescription className="mt-1">
              System-maintained discovery across chips, memory, servers, networking, power, cloud, software, and automation.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('font-mono text-[10px] uppercase', stateClass(data?.capacityState))} data-testid="ai-industry-pool-capacity">
            {data ? `${data.capacityState} · ${used}/${data.identifierCapacity}` : 'loading'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <PoolMetric label="Active taxonomy" value={data ? String(data.activeCount) : '—'} />
          <PoolMetric label="Remaining estimate" value={data ? String(data.remainingEstimate) : '—'} />
          <PoolMetric label="Reference state" value={data?.referenceAuthorizationState ?? 'loading'} className={stateClass(data?.referenceAuthorizationState)} />
        </div>

        <div className="rounded-md border border-dashed border-border bg-background/50 p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-xs leading-relaxed text-muted-foreground" data-testid="ai-industry-pool-reason">
                {data?.reason ?? (isLoading ? 'Loading isolated pool governance…' : 'Pool status is not available.')}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {data?.referenceReason ?? 'Targeted reference enrichment is withheld until a live candidate passes the existing confirmation gates.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          <span>Updated {formatTime(data?.generatedAt)}</span>
          <span>•</span>
          <span>Isolated from {data?.isolatedServices.join(', ') ?? 'protected market authority'}</span>
        </div>

        {data?.members && data.members.length > 0 ? (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1" data-testid="ai-industry-pool-members">
            {data.members.slice(0, 16).map((member) => (
              <div key={member.symbol} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold">{member.symbol}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{member.categories.join(' · ')}</p>
                </div>
                <Badge variant="outline" className={cn('shrink-0 font-mono text-[9px] uppercase', stateClass(member.membershipState))}>
                  {member.membershipState}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PoolMetric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('rounded-md border border-border/60 bg-muted/30 p-3', className)}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}