import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatNumber, formatTime } from '@/lib/utils';
import type { OpeningReadinessSnapshot, RadarStatus } from '@workspace/api-client-react';
import {
  CircleAlert,
  Clock,
  Layers,
  ShieldCheck,
} from 'lucide-react';

interface LiveSectorReadinessPanelProps {
  status: RadarStatus | null;
}

function getGateStatus(
  marketDataGateReady: boolean, 
  marketDataState: string, 
  verifiedEvents: number, 
  connectionState: string
) {
  if (marketDataGateReady) {
    return { label: 'Fresh Gate Ready', style: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' };
  }
  if (marketDataState === 'insufficient' && verifiedEvents > 0) {
    return { label: 'Window Building', style: 'border-primary/40 bg-primary/10 text-primary' };
  }
  if (connectionState === 'connecting' || connectionState === 'connected' || connectionState === 'streaming') {
    return { label: 'Transport Armed', style: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' };
  }
  return { label: 'Unavailable / Withheld', style: 'border-muted-foreground/30 bg-muted/20 text-muted-foreground' };
}

export function LiveSectorReadinessPanel({ status }: LiveSectorReadinessPanelProps) {
  if (!status) {
    return null;
  }

  const readiness = status.openingReadiness;

  return (
    <Card className="border-border">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Opening Readiness Panel
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Read-only validation of the live data chain. Status labels reflect proven evidence, not heartbeat expectations.
            </CardDescription>
          </div>
          {readiness ? (
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="font-mono text-[10px] uppercase bg-primary/10 text-primary border-primary/20">
                {readiness.session.phase.replace('_', ' ')}
              </Badge>
              <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                {readiness.session.mode.replace(/_/g, ' ')}
              </span>
            </div>
          ) : (
             <Badge variant="outline" className="font-mono text-[10px] uppercase border-muted-foreground/30 bg-muted/20 text-muted-foreground">
              Awaiting Readiness Context
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Pipeline Stages */}
        {readiness && (
          <div className="rounded-md border border-border/60 bg-card p-4">
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Chain of Evidence
            </h3>
            <div className="mb-4 border-l-2 border-primary/50 pl-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {readiness.session.timezone} session context
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">
                {readiness.session.detail}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {readiness.stages.map((stage) => (
                <StageCard key={stage.id} stage={stage} />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-3">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Next evaluation
                </span>
                <span className="font-mono text-[11px] text-foreground">
                  {readiness.nextEvaluationAt ? formatTime(readiness.nextEvaluationAt) : 'Awaiting data'}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {readiness.nextEvaluationReason}
              </p>
            </div>
          </div>
        )}

        {/* Detailed Context Grid */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Transport & Ingestion">
            <MetricRow label="Connection" value={status.connectionState} />
            <MetricRow label="Market Feed" value={status.marketFeedState} />
            <MetricRow
              label="Verified Events"
              value={formatNumber(status.liveIngestion.verifiedMarketEventCount, 0)}
              valueClassName={status.liveIngestion.verifiedMarketEventCount > 0 ? 'text-primary' : 'text-muted-foreground'}
            />
            <MetricRow
              label="Current Window"
              value={formatNumber(status.liveIngestion.currentWindowMarketEventCount, 0)}
            />
          </SummaryCard>

          <SummaryCard title="Market Universe">
            <MetricRow label="Freshness" value={status.marketUniverse.freshness} />
            <MetricRow label="Classification" value={status.marketUniverse.classificationQuality} />
            <MetricRow label="Authorized" value={formatNumber(status.marketUniverse.classificationCoverageCount, 0)} />
            <MetricRow label="Source" value={status.marketUniverse.classificationSource ?? 'Unavailable'} />
            <ReasonBox reason={status.marketUniverse.classificationReason} />
          </SummaryCard>

          <SummaryCard title="Sector Coverage">
            <MetricRow label="Live Symbols" value={formatNumber(status.sectorPriority.coverage.eligibleLiveSymbols, 0)} />
            <MetricRow label="Classified" value={formatNumber(status.sectorPriority.coverage.classifiedLiveSymbols, 0)} />
            <MetricRow label="Ranked Sectors" value={formatNumber(status.sectorPriority.coverage.rankedSectorCount, 0)} />
            <ReasonBox reason={status.sectorPriority.coverage.reason} />
          </SummaryCard>

          <SummaryCard title="Candidate Promotion">
            <MetricRow label="State" value={status.sectorPriority.state} />
            <MetricRow label="Final Candidates" value={formatNumber(status.sectorPriority.finalCandidates.length, 0)} />
            <MetricRow label="潜伏候选（每板块最多 5）" value={formatNumber(status.sectorPriority.latentCandidates.length, 0)} />
            <MetricRow label="Withheld" value={formatNumber(status.sectorPriority.withheldCandidates.length, 0)} />
          </SummaryCard>
        </div>

        {/* Per-Symbol Table */}
        <div className="space-y-3">
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="h-3.5 w-3.5" />
            Per-Symbol Readiness
          </h3>
          
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="bg-muted/50 text-[9px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Connection</th>
                  <th className="px-3 py-2 font-medium">Market Data</th>
                  <th className="px-3 py-2 font-medium">Gate</th>
                  <th className="px-3 py-2 font-medium text-right">Verified</th>
                  <th className="px-3 py-2 font-medium text-right">Window</th>
                  <th className="px-3 py-2 font-medium">Scheduler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {status.symbolRadars && status.symbolRadars.length > 0 ? (
                  status.symbolRadars.map((sym) => {
                    const gate = getGateStatus(
                      sym.scanHealth.marketDataGateReady,
                      sym.scanHealth.marketDataState,
                      sym.liveIngestion.verifiedMarketEventCount,
                      sym.connectionState
                    );

                    return (
                      <tr key={sym.symbol} className="bg-card hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 font-semibold text-foreground">{sym.symbol}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", gate.style)}>
                            {gate.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{sym.connectionState}</td>
                        <td className="px-3 py-2 text-muted-foreground">{sym.scanHealth.marketDataState}</td>
                        <td className="px-3 py-2">
                          <span className={sym.scanHealth.marketDataGateReady ? 'text-emerald-500' : 'text-muted-foreground'}>
                            {sym.scanHealth.marketDataGateReady ? 'Ready' : 'Pending'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{formatNumber(sym.liveIngestion.verifiedMarketEventCount, 0)}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(sym.liveIngestion.currentWindowMarketEventCount, 0)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{sym.scanHealth.schedulerState}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      No symbols in live readiness scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StageCard({ stage }: { stage: OpeningReadinessSnapshot['stages'][number] }) {
  const isReady = stage.state === 'ready';
  const isMonitoring = stage.state === 'monitoring';
  const isBlocked = stage.state === 'blocked';
  const isWithheld = stage.state === 'withheld';

  return (
    <div className={cn(
      "flex flex-col gap-1.5 rounded-md border p-3",
      isReady ? "border-emerald-500/20 bg-emerald-500/5" :
      isBlocked ? "border-destructive/20 bg-destructive/5" :
      isMonitoring ? "border-primary/20 bg-primary/5" :
      "border-muted-foreground/20 bg-muted/10"
    )}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-foreground">
          {stage.label}
        </span>
        <Badge variant="outline" className={cn(
          "font-mono text-[9px] px-1.5 py-0 uppercase border-transparent",
          isReady ? "text-emerald-600 dark:text-emerald-400" :
          isBlocked ? "text-destructive" :
          isMonitoring ? "text-primary" :
          "text-muted-foreground"
        )}>
          {stage.state}
        </Badge>
      </div>
      <p className={cn(
        "text-[10px] leading-relaxed",
        isReady ? "text-emerald-700/80 dark:text-emerald-300/80" :
        isBlocked ? "text-destructive/80" :
        isMonitoring ? "text-primary/80" :
        "text-muted-foreground"
      )}>
        {stage.detail}
      </p>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-border/60 bg-muted/10 p-3 h-full">
      <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-3">{title}</h4>
      <div className="space-y-1.5 flex-1 flex flex-col justify-start">
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value, valueClassName }: { label: string; value: string | number; valueClassName?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-foreground text-right", valueClassName)}>{value}</span>
    </div>
  );
}

function ReasonBox({ reason }: { reason?: string | null }) {
  if (!reason) return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded border border-border/40 bg-background/50 p-2">
      <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <p className="text-[10px] leading-relaxed text-muted-foreground">{reason}</p>
    </div>
  );
}
