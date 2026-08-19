import { Activity, CheckCircle2, CircleAlert, Database, ShieldCheck, XCircle } from 'lucide-react';

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

  const acceptance = acceptancePresentation(diagnostics.acceptanceState);
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
              acceptance.className,
            )}
            data-testid="live-ingestion-window-status"
          >
            {acceptance.label}
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

        <div className="rounded-md border border-primary/20 bg-primary/5 p-3" data-testid="live-ingestion-readiness">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next-session acceptance readiness</p>
              <p className="mt-1 text-sm font-medium text-foreground">{acceptance.heading}</p>
            </div>
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              {diagnostics.scoringStatus.scoreState === 'insufficient'
                ? 'Insufficient Sample'
                : diagnostics.scoringStatus.scoreState}
            </span>
          </div>
          <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Condition label="Verified subscription" value={diagnostics.conditions.subscriptionVerified} />
            <Condition label="Real Databento record" value={diagnostics.conditions.realMarketEventReceived} />
            <Condition label="Entered current window" value={diagnostics.conditions.enteredScoringWindow} />
            <Condition label="Fresh quotes" value={diagnostics.conditions.quoteFresh} />
            <Condition label="Fresh trades" value={diagnostics.conditions.tradeFresh} />
            <Condition label="Fresh prices" value={diagnostics.conditions.priceFresh} />
            <Condition label="Fresh volume" value={diagnostics.conditions.volumeFresh} />
            <Condition label="Trigger evidence" value={diagnostics.conditions.triggerEvidenceAvailable} />
            <Condition label="Existing scoring gate" value={diagnostics.conditions.scoringEligible} />
          </div>
          <div className="mt-3 grid gap-2 border-t border-primary/10 pt-3 text-[11px] text-muted-foreground sm:grid-cols-2">
            <p>Window began: <span className="font-mono text-foreground">{formatTime(diagnostics.windowStartedAt)}</span></p>
            <p>Last window entry: <span className="font-mono text-foreground">{formatTime(diagnostics.lastWindowEntryAt)}</span></p>
          </div>
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

        <div className="grid gap-3 lg:grid-cols-2">
          <AuditSection
            title="Trigger evidence"
            rows={[
              ['Source record', diagnostics.triggerEvidence.sourceEventType ?? 'No verified record'],
              ['Source event', formatTime(diagnostics.triggerEvidence.sourceEventAt)],
              ['Source receive', formatTime(diagnostics.triggerEvidence.sourceReceiveAt)],
              ['Alpha scan', formatTime(diagnostics.triggerEvidence.scanAt)],
              ['Scan cause', diagnostics.triggerEvidence.triggerReason.replaceAll('_', ' ')],
              ['Event-triggered', diagnostics.triggerEvidence.eventTriggered ? 'yes' : 'no'],
              ['Evidence', `${formatNumber(diagnostics.triggerEvidence.evidenceCount, 0)} direct signals`],
            ]}
          />
          <AuditSection
            title="Scoring status (read-only)"
            rows={[
              ['Score state', diagnostics.scoringStatus.scoreState === 'insufficient' ? 'Insufficient Sample' : diagnostics.scoringStatus.scoreState],
              ['Radar status', diagnostics.scoringStatus.status ?? 'not established'],
              ['Score', formatNumber(diagnostics.scoringStatus.score, 1)],
              ['Data quality', diagnostics.scoringStatus.dataQuality],
              ['Metric freshness', diagnostics.scoringStatus.freshness],
              ['Existing gate', diagnostics.scoringStatus.gateReason.replaceAll('_', ' ')],
            ]}
          />
        </div>

        <EvidenceSummary
          title="Satisfied evidence"
          values={diagnostics.triggerEvidence.satisfiedEvidence}
          empty="No direct trigger evidence is satisfied."
          tone="positive"
        />
        <EvidenceSummary
          title="Missing evidence"
          values={diagnostics.triggerEvidence.missingEvidence}
          empty="No missing-evidence assessment yet; a real market record is still required."
          tone="neutral"
        />

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

function Condition({ label, value }: { label: string; value: boolean }) {
  const Icon = value ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', value ? 'text-primary' : 'text-muted-foreground')} />
      <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

function AuditSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-3">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <dl className="space-y-1.5 text-[11px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="max-w-[62%] text-right font-mono text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EvidenceSummary({
  title,
  values,
  empty,
  tone,
}: {
  title: string;
  values: string[];
  empty: string;
  tone: 'positive' | 'neutral';
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className={cn('mt-1 text-xs', values.length > 0 && tone === 'positive' ? 'text-primary' : 'text-muted-foreground')}>
        {values.length > 0 ? values.join(' · ') : empty}
      </p>
    </div>
  );
}

function acceptancePresentation(state: LiveIngestionDiagnostics['acceptanceState']) {
  switch (state) {
    case 'scoring_eligible':
      return {
        label: 'scoring gate met',
        heading: 'Real live evidence is currently eligible under the existing scoring gate.',
        className: 'border-primary/40 bg-primary/10 text-primary',
      };
    case 'insufficient_sample':
      return {
        label: 'insufficient sample',
        heading: 'A real record entered the window; more existing live evidence is required.',
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      };
    case 'window_building':
      return {
        label: 'building window',
        heading: 'Real records are present, but the current scoring window is rebuilding.',
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      };
    case 'stale':
      return {
        label: 'market evidence stale',
        heading: 'The prior real record is outside the existing freshness gate.',
        className: 'border-destructive/40 bg-destructive/10 text-destructive',
      };
    case 'offline':
      return {
        label: 'feed offline',
        heading: 'Reconnect the live feed before the next-session acceptance can begin.',
        className: 'border-destructive/40 bg-destructive/10 text-destructive',
      };
    default:
      return {
        label: 'awaiting live record',
        heading: 'Prepared for the next eligible Databento market record; no substitute data is used.',
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      };
  }
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