import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatNumber, formatTime } from '@/lib/utils';
import type { RadarStatus, SectorPrioritySnapshot } from '@workspace/api-client-react';
import {
  CircleAlert,
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

function getSectorReadinessStatus(snapshot: SectorPrioritySnapshot) {
  if (snapshot.state === 'ranked' && snapshot.coverage.rankedSectorCount > 0) {
    return {
      label: 'Sector Ranking Active',
      style: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  if (snapshot.coverage.eligibleLiveSymbols > 0 || snapshot.coverage.classifiedLiveSymbols > 0) {
    return {
      label: 'Sector Ranking Withheld',
      style: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  }
  return {
    label: 'Sector Readiness Unavailable',
    style: 'border-muted-foreground/30 bg-muted/20 text-muted-foreground',
  };
}

export function LiveSectorReadinessPanel({ status }: LiveSectorReadinessPanelProps) {
  if (!status) {
    return null;
  }

  const primaryGate = getGateStatus(
    status.scanHealth.marketDataGateReady,
    status.scanHealth.marketDataState,
    status.liveIngestion.verifiedMarketEventCount,
    status.connectionState
  );
  const sectorGate = getSectorReadinessStatus(status.sectorPriority);

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
              Read-only validation of the live data chain. Sector readiness needs two fresh, trusted classified constituents.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", sectorGate.style)}>
            {sectorGate.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Top-Level Summary Grid */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Transport & Ingestion">
            <MetricRow label="Connection" value={status.connectionState} />
            <MetricRow label="Market Feed" value={status.marketFeedState} />
            <MetricRow
              label="Recovery"
              value={
                status.reconnectState === 'scheduled' || status.reconnectState === 'exhausted'
                  ? `${status.reconnectState} · ${formatTime(status.nextReconnectAt)}`
                  : status.reconnectState
              }
            />
            <MetricRow label="Verified Events" value={formatNumber(status.liveIngestion.verifiedMarketEventCount, 0)} />
            <MetricRow label="Current Window" value={formatNumber(status.liveIngestion.currentWindowMarketEventCount, 0)} />
          </SummaryCard>

          <SummaryCard title="Scan Health">
            <MetricRow label="Scheduler" value={status.scanHealth.schedulerState} />
            <MetricRow label="Market Data" value={status.scanHealth.marketDataState} />
            <MetricRow
              label="Primary live gate"
              value={primaryGate.label}
              valueClassName={status.scanHealth.marketDataGateReady ? 'text-emerald-500' : 'text-muted-foreground'}
            />
            <ReasonBox reason={status.scanHealth.reason} />
          </SummaryCard>

          <SummaryCard title="Market Universe">
            <MetricRow label="Reference freshness" value={status.marketUniverse.freshness} />
            <MetricRow label="Classification quality" value={status.marketUniverse.dataQuality} />
            <MetricRow label="Verified/Disc." value={`${formatNumber(status.marketUniverse.eligibleCount, 0)}`} />
            <MetricRow label="Classified" value={formatNumber(status.marketUniverse.classificationCoverageCount, 0)} />
            <ReasonBox reason={status.marketUniverse.reason} />
          </SummaryCard>

          <SummaryCard title="Sector Priority">
            <MetricRow label="Live Symbols" value={formatNumber(status.sectorPriority.coverage.eligibleLiveSymbols, 0)} />
            <MetricRow label="Classified" value={formatNumber(status.sectorPriority.coverage.classifiedLiveSymbols, 0)} />
            <MetricRow label="Ranked Sectors" value={formatNumber(status.sectorPriority.coverage.rankedSectorCount, 0)} />
            <MetricRow label="State" value={status.sectorPriority.state} />
            <MetricRow label="Candidates (F/P/W)" value={`${status.sectorPriority.finalCandidates.length}/${status.sectorPriority.preBreakoutCandidates.length}/${status.sectorPriority.withheldCandidates.length}`} />
            <ReasonBox reason={status.sectorPriority.coverage.reason} />
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
                {status.symbolRadars.map((sym) => {
                  const gate = getGateStatus(
                    sym.scanHealth.marketDataGateReady,
                    sym.scanHealth.marketDataState,
                    sym.liveIngestion.verifiedMarketEventCount,
                    sym.connectionState
                  );
                  
                  return (
                    <tr key={sym.symbol} className="bg-card">
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
                })}
                {status.symbolRadars.length === 0 && (
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

function MetricRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
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
