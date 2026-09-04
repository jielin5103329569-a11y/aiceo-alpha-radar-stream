import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  FlaskConical,
  Landmark,
  Newspaper,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatNumber, formatTime } from '@/lib/utils';
import type {
  CatalystRadarSnapshot,
  CatalystSourceStatus,
  Opportunity,
  OpportunityCenterSnapshot,
  ProtectedMarketWindowSettlement,
  RadarSymbolStatus,
} from '@workspace/api-client-react';

type CatalystOpportunityCenterProps = {
  catalystRadar: CatalystRadarSnapshot | null | undefined;
  opportunityCenter: OpportunityCenterSnapshot | null | undefined;
  marketWindowSettlement: ProtectedMarketWindowSettlement | null | undefined;
  symbolRadars: RadarSymbolStatus[];
};

const sourceIcon = {
  company_news: Newspaper,
  earnings_guidance: Activity,
  fda_clinical_regulatory: FlaskConical,
  partnership_order_ma: Sparkles,
  sec_filing: FileText,
} as const;

function sourceTone(source: CatalystSourceStatus): string {
  if (source.availability === 'available' && source.freshness === 'fresh') {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (source.availability === 'stale') {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }
  if (source.availability === 'blocked') {
    return 'border-destructive/35 bg-destructive/10 text-destructive';
  }
  return 'border-border bg-muted/50 text-muted-foreground';
}

function opportunityTone(state: Opportunity['state']): string {
  if (state === 'CONFIRMED') {
    return 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (state === 'PRE-BREAKOUT') {
    return 'border-primary/45 bg-primary/10 text-primary';
  }
  return 'border-border bg-muted/50 text-muted-foreground';
}

function sectorTone(status: Opportunity['sectorConfirmation']['status']): string {
  if (status === 'confirmed') return 'text-emerald-700 dark:text-emerald-300';
  if (status === 'insufficient') return 'text-amber-700 dark:text-amber-300';
  return 'text-muted-foreground';
}

export function CatalystOpportunityCenter({
  catalystRadar,
  opportunityCenter,
  marketWindowSettlement,
  symbolRadars,
}: CatalystOpportunityCenterProps) {
  const statuses = catalystRadar?.sourceStatuses ?? [];
  const opportunities = opportunityCenter?.opportunities ?? [];
  const settlementBySymbol = new Map(
    symbolRadars.map((symbol) => [symbol.symbol, symbol.marketWindowSettlement]),
  );

  return (
    <section className="space-y-6" aria-label="Catalyst Radar and Opportunity Center">
      <Card className="border-primary/20" data-testid="catalyst-radar">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
                <Landmark className="h-4 w-4 text-primary" />
                Catalyst Radar
              </CardTitle>
              <CardDescription className="mt-1">
                Provider-neutral catalyst evidence. Unconnected sources stay explicitly unavailable; no event is inferred.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="border border-border bg-muted/40 font-mono text-[10px] uppercase text-muted-foreground"
                data-testid="catalyst-event-state"
              >
                {catalystRadar?.eventState ?? 'unavailable'} events
              </Badge>
              <Badge
                variant="outline"
                className="border border-primary/25 bg-primary/5 font-mono text-[10px] text-primary"
                data-testid="catalyst-source-availability"
              >
                {formatNumber(catalystRadar?.availableSourceCount, 0)}/{formatNumber(catalystRadar?.sourceCount, 0)} sources
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {statuses.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {statuses.map((source) => {
                const Icon = sourceIcon[source.category];
                return (
                  <div
                    key={source.category}
                    className="rounded-md border border-border/60 bg-muted/10 p-3 transition-colors hover:bg-muted/25"
                    data-testid={`catalyst-source-${source.category}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-primary" />
                      <Badge
                        variant="outline"
                        className={cn('border font-mono text-[9px] uppercase', sourceTone(source))}
                        data-testid={`catalyst-source-status-${source.category}`}
                      >
                        {source.readiness}
                      </Badge>
                    </div>
                    <p className="mt-3 text-xs font-medium text-foreground">{source.label}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      Event: {source.lastEventAt ? formatTime(source.lastEventAt) : 'No event'}
                    </p>
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                      {source.reason}
                    </p>
                    <p className="mt-2 border-t border-border/50 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                      Next: {source.nextAction}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
              Waiting for Catalyst Radar source status.
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-background/50 p-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground" data-testid="catalyst-radar-reason">
              {catalystRadar?.reason ?? 'Catalyst source availability has not loaded.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20" data-testid="opportunity-center">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
                <Target className="h-4 w-4 text-primary" />
                Alert / Opportunity Center
              </CardTitle>
              <CardDescription className="mt-1">
                A state advances only when fresh independent evidence converges. Catalyst context cannot confirm an opportunity by itself.
              </CardDescription>
            </div>
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <Badge
                variant="outline"
                className="border border-border bg-muted/40 font-mono text-[10px] uppercase text-muted-foreground"
                data-testid="opportunity-count"
              >
                {formatNumber(opportunities.length, 0)} monitored
              </Badge>
              <p className="max-w-full break-all font-mono text-[9px] text-muted-foreground" data-testid="opportunity-center-scan-id">
                Scan ID · {opportunityCenter?.scanId ?? 'Not supplied by server'}
              </p>
              <p className="font-mono text-[9px] text-muted-foreground" data-testid="opportunity-center-cycle-time">
                Cycle · {marketWindowSettlement?.settledAt ? formatTime(marketWindowSettlement.settledAt) : 'Not supplied by server'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {opportunities.length > 0 ? (
            <div className="space-y-3">
              {opportunities.map((opportunity) => (
                <OpportunityRow
                  key={opportunity.symbol}
                  opportunity={opportunity}
                  settlement={settlementBySymbol.get(opportunity.symbol)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
              Waiting for protected-symbol opportunity evidence.
            </div>
          )}
          <p className="border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground" data-testid="opportunity-center-reason">
            {opportunityCenter?.reason ?? 'Opportunity fusion status has not loaded.'}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function OpportunityRow({
  opportunity,
  settlement,
}: {
  opportunity: Opportunity;
  settlement: ProtectedMarketWindowSettlement | undefined;
}) {
  const sector = opportunity.sectorConfirmation;
  const classification = sector.trustedClassification
    ? `${sector.sector ?? '无可信板块'} · ${sector.industry ?? '无可信行业'}`
    : '无可信分类';
  return (
    <article
      className="rounded-lg border border-border/70 bg-card p-4 transition-colors hover:border-primary/30"
      data-testid={`opportunity-${opportunity.symbol}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 min-w-9 items-center justify-center rounded-md bg-primary/10 font-mono text-sm font-bold text-primary">
            {opportunity.symbol}
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">
              Trigger: {opportunity.triggerAt ? formatTime(opportunity.triggerAt) : 'Awaiting fresh scan'}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {opportunity.freshness} opportunity data · {opportunity.marketState} market window
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn('border font-mono text-[10px] uppercase', opportunityTone(opportunity.state))}
            data-testid={`opportunity-state-${opportunity.symbol}`}
          >
            {opportunity.state}
          </Badge>
          <Badge
            variant="outline"
            className="border border-border bg-muted/40 font-mono text-[10px] text-muted-foreground"
            data-testid={`opportunity-evidence-count-${opportunity.symbol}`}
          >
            {formatNumber(opportunity.evidenceCount, 0)} independent
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'border font-mono text-[10px] uppercase',
              opportunity.alertReady
                ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-border bg-muted/40 text-muted-foreground',
            )}
            data-testid={`opportunity-alert-ready-${opportunity.symbol}`}
          >
            {opportunity.alertReady ? 'in-app alert ready' : 'alert gated'}
          </Badge>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-border/60 bg-background/50 p-2.5">
        <p className="break-all font-mono text-[9px] text-muted-foreground" data-testid={`opportunity-scan-id-${opportunity.symbol}`}>
          Scan ID · {opportunity.scanId ?? 'Not supplied by server'}
        </p>
        <p className="mt-1 font-mono text-[9px] text-muted-foreground" data-testid={`opportunity-cycle-time-${opportunity.symbol}`}>
          Cycle · {settlement?.settledAt ? formatTime(settlement.settledAt) : 'Not supplied by server'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid={`opportunity-missing-segments-${opportunity.symbol}`}>
          <span className="text-[8px] uppercase tracking-wide text-muted-foreground">Missing segments</span>
          {settlement === undefined ? (
            <span className="text-[9px] text-muted-foreground">Not supplied by server</span>
          ) : settlement.missingSegments.length > 0 ? (
            settlement.missingSegments.map((segment) => (
              <Badge
                key={segment}
                variant="outline"
                className="border-amber-500/35 bg-amber-500/10 font-mono text-[9px] lowercase text-amber-700 dark:text-amber-300"
              >
                {segment}
              </Badge>
            ))
          ) : (
            <span className="font-mono text-[9px] text-primary">none</span>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-border/60 bg-muted/10 p-3 font-mono text-[10px] sm:grid-cols-4">
        <OpportunityMetric label="Direction" value={opportunity.direction} />
        <OpportunityMetric label="Speed" value={opportunity.alphaVelocity30s === null ? '—' : `${formatNumber(opportunity.alphaVelocity30s, 2)}/min`} />
        <OpportunityMetric label="Acceleration" value={opportunity.acceleration === null ? '—' : `${formatNumber(opportunity.acceleration, 2)}/min`} />
        <OpportunityMetric label="Catalyst" value={opportunity.eventTime ? formatTime(opportunity.eventTime) : 'unavailable'} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-border/60 bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Evidence chain</p>
            <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="mt-2 space-y-2">
            {opportunity.evidenceChain.map((evidence) => (
              <div key={evidence.key} className="flex items-start gap-2 text-[11px]" data-testid={`opportunity-evidence-${opportunity.symbol}-${evidence.key}`}>
                {evidence.satisfied ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{evidence.label}</p>
                  <p className="leading-relaxed text-muted-foreground">{evidence.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/10 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sector / industry confirmation</p>
            <p className={cn('mt-1 font-mono text-xs uppercase', sectorTone(sector.status))} data-testid={`sector-confirmation-${opportunity.symbol}`}>
              {sector.status}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`sector-classification-${opportunity.symbol}`}>
              {classification} · {formatNumber(sector.freshEligiblePeerCount, 0)} fresh peers
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{sector.reason}</p>
          </div>

          <div className="rounded-md border border-border/60 bg-background/50 p-3" data-testid={`opportunity-missing-${opportunity.symbol}`}>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Still required</p>
            {opportunity.missingConfirmationItems.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                {opportunity.missingConfirmationItems.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">All confirmation categories converge.</p>
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">{opportunity.reason}</p>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground" data-testid={`opportunity-alert-reason-${opportunity.symbol}`}>
        {opportunity.alertReadyReason}
      </p>
    </article>
  );
}

function OpportunityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-foreground">{value}</p>
    </div>
  );
}