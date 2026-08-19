import { Activity, CircleAlert, Database, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatAge, formatNumber, formatTime } from '@/lib/utils';
import type { LiveIngestionDiagnostics } from '@workspace/api-client-react';

type LiveIngestionAcceptanceCardProps = {
  diagnostics: LiveIngestionDiagnostics | undefined;
};

export function LiveIngestionAcceptanceCard({ diagnostics }: LiveIngestionAcceptanceCardProps) {
  if (!diagnostics) {
    return null;
  }

  const eventIsFresh = diagnostics.enteredScoringWindow;
  const eventAge = diagnostics.lastMarketEventAgeMs === null
    ? 'No verified event'
    : diagnostics.lastMarketEventAgeMs < 1_000
      ? 'just now'
      : `${formatNumber(diagnostics.lastMarketEventAgeMs / 1_000, 1)}s`;

  return (
    <Card className="border-primary/20" data-testid="live-ingestion-acceptance">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Live Ingestion Acceptance
            </CardTitle>
            <CardDescription className="mt-1">
              Read-only audit of real Databento market records before they are eligible for a scoring window.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'font-mono text-[10px] uppercase',
              eventIsFresh
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            )}
            data-testid="live-ingestion-window-status"
          >
            {eventIsFresh ? 'entered scoring window' : 'not in scoring window'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-medium text-foreground">Verified subscription</p>
            <p className="font-mono text-[11px] text-muted-foreground" data-testid="live-ingestion-subscription">
              {diagnostics.subscription.dataset} · {diagnostics.subscription.symbol} · {diagnostics.subscription.symbolType}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {diagnostics.subscription.schemas.join(' + ')}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Market-session context</p>
            <p className="font-mono text-[11px] text-muted-foreground" data-testid="live-ingestion-session">
              {diagnostics.marketSession.phase.replace('_', ' ')} · {diagnostics.marketSession.timezone}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Session filter: {diagnostics.marketSession.filterApplied ? 'applied' : 'not applied'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Verified events" value={formatNumber(diagnostics.verifiedMarketEventCount, 0)} />
          <Metric label="Current window" value={formatNumber(diagnostics.currentWindowMarketEventCount, 0)} />
          <Metric label="Last event age" value={eventAge} />
          <Metric label="Last event" value={formatTime(diagnostics.lastMarketEventAt)} />
        </div>

        <div className="rounded-md border border-border/60 bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" />
            Freshness evidence entering Alpha Radar
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-4">
            <Counter label="quotes" value={diagnostics.freshnessCounters.quotes} />
            <Counter label="trades" value={diagnostics.freshnessCounters.trades} />
            <Counter label="prices" value={diagnostics.freshnessCounters.prices} />
            <Counter label="volume" value={diagnostics.freshnessCounters.volume} />
          </div>
        </div>

        <div className="rounded-md border border-dashed border-border bg-background/60 p-3">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground" data-testid="live-ingestion-reason">
              {diagnostics.reason}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-border/60">
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            Recent verified Databento market records
          </div>
          {diagnostics.recentMarketEvents.length > 0 ? (
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[760px] text-left font-mono text-[11px]">
                <thead className="sticky top-0 bg-background text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Symbol / type</th>
                    <th className="px-3 py-2 font-medium">Event time</th>
                    <th className="px-3 py-2 font-medium">Source receive</th>
                    <th className="px-3 py-2 font-medium">Ingested</th>
                    <th className="px-3 py-2 font-medium text-right">Price</th>
                    <th className="px-3 py-2 font-medium text-right">Size</th>
                    <th className="px-3 py-2 font-medium text-right">Window</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {diagnostics.recentMarketEvents.map((event, index) => (
                    <tr key={`${event.ingestedAt}-${event.eventTimestamp}-${index}`} data-testid={`live-ingestion-event-${index}`}>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-foreground">{event.symbol}</span>
                        <span className="text-muted-foreground"> · {event.schema} / {event.eventType}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{formatTime(event.eventTimestamp)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatTime(event.receiveTimestamp)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatTime(event.ingestedAt)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(event.price, 3)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(event.size, 0)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[9px] uppercase',
                          event.enteredScoringWindow
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}>
                          {event.enteredScoringWindow ? 'entered' : 'excluded'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-24 items-center justify-center px-4 text-center text-xs text-muted-foreground">
              No verified market record received in this process. System, interval, heartbeat, SSE, cache, and simulated data are intentionally absent.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-3">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{formatNumber(value, 0)}</span>
    </div>
  );
}