import React from 'react';
import { Link } from 'wouter';
import { useRadarStream } from '@/hooks/use-radar-stream';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadarSignalPanel } from '@/components/radar-signal-panel';
import { LiveIngestionAcceptanceCard } from '@/components/live-ingestion-acceptance-card';
import { SignalValidationPanel } from '@/components/signal-validation-panel';
import { ShadowLearningStatusPanel } from '@/components/shadow-learning-status-panel';
import { DataGovernanceCard } from '@/components/data-governance-card';
import { EngineeringGovernanceCard } from '@/components/engineering-governance-card';
import { BackendLifelineCard } from '@/components/backend-lifeline-card';
import { RuntimeSupervisorCard } from '@/components/runtime-supervisor-card';
import { AccountControls } from '@/components/account-controls';
import { AccountAlerts } from '@/components/account-alerts';
import { CatalystOpportunityCenter } from '@/components/catalyst-opportunity-center';
import { SectorPriorityHierarchy } from '@/components/sector-priority-hierarchy';
import { LiveSectorReadinessPanel } from '@/components/live-sector-readiness-panel';
import { AiIndustryPoolCard } from '@/components/ai-industry-pool-card';
import { formatAge, formatNumber, formatPercent, formatTime, cn } from '@/lib/utils';
import {
  AlertCircle,
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  CircleAlert,
  Database,
  Gauge,
  Radio,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  TrendingUp,
  WifiOff,
  Zap,
} from 'lucide-react';
import type { AlphaRadarRankingSnapshot, FocusedScanSnapshot, MarketFeedState, MarketUniverseSummary, RadarConnectionState, RadarReconnectState, RadarSignal, RadarSnapshot, RadarStatus, RadarSymbolStatus } from '@workspace/api-client-react';

export default function Dashboard() {
  const {
    status,
    isLoading,
    isError,
    transportState,
    hasReceivedStatus,
    backendUnavailable,
  } = useRadarStream();
  const isStopped = status?.connectionState === 'stopped';
  const isNotConfigured = status?.connectionState === 'not_configured';

  if (!hasReceivedStatus && isLoading && !status) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground animate-pulse">
          <Activity className="h-8 w-8" />
          <p className="text-sm font-medium tracking-widest uppercase">Initializing Radar</p>
        </div>
      </div>
    );
  }

  if (isNotConfigured) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full border-dashed shadow-none">
          <CardHeader className="text-center">
            <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <CardTitle>Radar Not Configured</CardTitle>
            <CardDescription>
              The upstream Databento feed is missing credentials. Please configure the server environment.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground pb-12">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-semibold text-lg leading-none tracking-tight">Alpha Radar Stream</h1>
                <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-mono">
                  Market Data Verification Console
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              <a
                href="#alert-center"
                className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Go to Alert Center"
                data-testid="link-alert-center"
              >
                <Bell className="h-3 w-3" />
                <span className="hidden sm:inline">Alerts</span>
              </a>
              <Link href="/diagnostics" className="text-xs font-medium uppercase tracking-widest text-muted-foreground hover:text-foreground hidden sm:flex items-center gap-1.5 transition-colors">
                <Activity className="h-3 w-3" />
                Diagnostics
              </Link>
              <MarketFeedStatusBadge
                state={status?.marketFeedState}
                error={isError}
                acceptanceState={status?.liveIngestion.acceptanceState}
              />
              <AccountControls />
            </div>
          </div>
        </div>
      </header>

      {backendUnavailable && (
        <div
          className="mx-auto mt-4 flex max-w-7xl items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
          role="status"
          data-testid="radar-backend-reconnecting"
        >
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>
            Backend unavailable — reconnecting. Displaying the last successful Radar status.
          </span>
        </div>
      )}

      {/* Main Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 grid gap-6 grid-cols-1 lg:grid-cols-12">
        
        {/* Left Column - Meta & Market Snap */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <ConnectionHealthCard status={status} transportState={transportState} isError={isError} />

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Target Info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 font-mono text-sm">
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="font-semibold">{status?.provider || 'Unknown'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Dataset</span>
                  <span className="font-semibold">{status?.dataset || '-'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-semibold text-primary">{status?.symbol || '-'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Started</span>
                  <span>{formatTime(status?.startedAt)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground">Last Heartbeat</span>
                  <span>{formatTime(status?.lastHeartbeatAt)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground">Last Market Update</span>
                  <span>{formatTime(status?.lastUpdatedAt)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground">Radar timestamp</span>
                  <span data-testid="text-radar-timestamp">{formatTime(status?.radar?.dataTimestamp)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Market Snapshot
              </CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 bg-muted/50 p-4 rounded-md flex flex-col items-center justify-center">
                  <span className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Latest Price</span>
                  <span className="text-3xl font-mono font-bold">
                    {formatNumber(status?.market?.latestPrice)}
                  </span>
                </div>
                
                <div className="flex flex-col border border-border/50 rounded-md p-3">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Bid</span>
                  <span className="font-mono text-lg font-semibold">{formatNumber(status?.market?.bidPrice)}</span>
                  <span className="text-xs text-muted-foreground font-mono mt-1">
                    Vol: {formatNumber(status?.market?.bidSize, 0)}
                  </span>
                </div>

                <div className="flex flex-col border border-border/50 rounded-md p-3">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Ask</span>
                  <span className="font-mono text-lg font-semibold">{formatNumber(status?.market?.askPrice)}</span>
                  <span className="text-xs text-muted-foreground font-mono mt-1">
                    Vol: {formatNumber(status?.market?.askSize, 0)}
                  </span>
                </div>

                <div className="col-span-2 grid grid-cols-2 gap-4 mt-2 border-t border-border pt-4">
                   <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Trade Vol</span>
                    <span className="font-mono text-sm mt-1">{formatNumber(status?.market?.lastTradeSize, 0)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Session Vol</span>
                    <span className="font-mono text-sm mt-1">{formatNumber(status?.market?.sessionVolume, 0)}</span>
                  </div>
                </div>
                  <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Quoted Spread</span>
                      <span className="font-mono text-sm mt-1" data-testid="text-quoted-spread">
                        {formatNumber(status?.radar?.spread?.spread, 2)}
                        {status?.radar?.spread?.spreadBps !== null && status?.radar?.spread?.spreadBps !== undefined
                          ? ` · ${formatNumber(status.radar.spread.spreadBps, 1)} bps`
                          : ''}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Window Move</span>
                      <span
                        className={cn(
                          'font-mono text-sm mt-1',
                          (status?.radar?.momentum?.changePercent ?? 0) > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : (status?.radar?.momentum?.changePercent ?? 0) < 0
                              ? 'text-destructive'
                              : '',
                        )}
                        data-testid="text-window-move"
                      >
                        {formatPercent(status?.radar?.momentum?.changePercent)}
                      </span>
                    </div>
                  </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="text-[10px] text-muted-foreground/60 text-center uppercase tracking-widest mt-4">
            Notice: This app does not trade or place orders. Verification only.
          </div>
        </div>

        {/* Right Column - Streams & Tape */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <CatalystOpportunityCenter
            catalystRadar={status?.catalystRadar}
            opportunityCenter={status?.opportunityCenter}
          />

          <RadarSignalPanel alphaRadar={status?.alphaRadar} scanHealth={status?.scanHealth} />
          <DataGovernanceCard governance={status?.governance} />
          <BackendLifelineCard />
          <RuntimeSupervisorCard />
          <EngineeringGovernanceCard />

          <LiveIngestionAcceptanceCard diagnostics={status?.liveIngestion} />
          <LiveSectorReadinessPanel status={status ?? null} />

          <SignalValidationPanel />
          <ShadowLearningStatusPanel />
          <section id="alert-center" className="scroll-mt-24" aria-label="Alert Center">
            <AccountAlerts />
          </section>

          <SectorPriorityHierarchy snapshot={status?.sectorPriority} />

          <RadarUniverseCard
            symbols={status?.symbolRadars ?? []}
            ranking={status?.alphaRanking ?? null}
          />

          <MarketUniverseFoundationCard
            summary={status?.marketUniverse ?? null}
            liveSymbolCount={status?.symbolRadars?.length ?? 0}
          />

          <FocusedScanRoutingCard status={status?.focusedScans ?? null} />
          <AiIndustryPoolCard />

          <RadarScoreCard radar={status?.radar ?? null} />

          <RadarComponentsCard radar={status?.radar ?? null} />

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Active Channels
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status?.streams && status.streams.length > 0 ? (
                <div className="space-y-3">
                  {status.streams.map((stream, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 border border-border rounded-md bg-card" data-testid={`card-channel-${stream.schema}`}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-2 w-2 rounded-full",
                          stream.state === 'receiving' ? "bg-primary animate-pulse" : 
                          stream.state === 'waiting' ? "bg-amber-500" : "bg-destructive"
                        )} />
                        <span className="font-mono font-medium text-sm">{stream.schema}</span>
                      </div>
                      <div className="flex items-center gap-6 font-mono text-sm text-muted-foreground">
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] uppercase">Events</span>
                          <span className="text-foreground">{formatNumber(stream.eventCount, 0)}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] uppercase">Last Event</span>
                          <span className="text-foreground">{formatTime(stream.lastEventAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground text-sm flex flex-col items-center justify-center">
                  <WifiOff className="h-8 w-8 mb-2 opacity-20" />
                  No active channels. Engage stream to connect.
                </div>
              )}
            </CardContent>
          </Card>

          <ActivityObservationsCard radar={status?.radar ?? null} />

          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Recent Tape
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
              {status?.recentTrades && status.recentTrades.length > 0 ? (
                <div className="overflow-auto max-h-[400px]">
                  <table className="w-full text-sm font-mono text-left whitespace-nowrap">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">Price</th>
                        <th className="px-4 py-3 font-medium text-right">Size</th>
                        <th className="px-4 py-3 font-medium text-center">Side</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {status.recentTrades.map((trade, idx) => (
                        <tr key={idx} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 text-muted-foreground">{formatTime(trade.timestamp)}</td>
                          <td className="px-4 py-2 font-medium">{formatNumber(trade.price, 3)}</td>
                          <td className="px-4 py-2 text-right">{formatNumber(trade.size, 0)}</td>
                          <td className="px-4 py-2 text-center" data-testid={`text-trade-side-${idx}`}>
                            {trade.side ? (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] uppercase font-bold",
                                trade.side === 'B' ? "bg-green-500/10 text-green-600 dark:text-green-400" :
                                trade.side === 'A' ? "bg-red-500/10 text-red-600 dark:text-red-400" : 
                                "bg-muted text-muted-foreground"
                              )}>
                                {trade.side === 'B' ? 'BUY' : trade.side === 'A' ? 'SELL' : trade.side}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center text-muted-foreground">
                  <Activity className="h-10 w-10 mb-3 opacity-20" />
                  <p className="text-sm">No trades intercepted yet.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function MarketUniverseFoundationCard({
  summary,
  liveSymbolCount,
}: {
  summary: MarketUniverseSummary | null;
  liveSymbolCount: number;
}) {
  const freshnessStyle = summary?.freshness === 'fresh'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : summary?.freshness === 'stale'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-muted-foreground/30 bg-muted/50 text-muted-foreground';
  const qualityStyle = summary?.classificationQuality === 'good'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : summary?.classificationQuality === 'degraded'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-destructive/30 bg-destructive/10 text-destructive';

  return (
    <Card className="scroll-mt-20" data-testid="market-universe-foundation">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <Database className="h-4 w-4 text-primary" />
              Broad Market Reference Foundation
            </CardTitle>
            <CardDescription className="mt-1">
              Low-frequency security reference only. Discovery does not subscribe symbols to live microstructure data.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={`font-mono text-[10px] ${freshnessStyle}`} data-testid="market-universe-freshness">
              {summary?.freshness ?? 'missing'} reference
            </Badge>
            <Badge variant="outline" className={`font-mono text-[10px] ${qualityStyle}`} data-testid="market-universe-quality">
              {summary?.classificationQuality ?? 'unavailable'} classification
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UniverseMetric label="Discovered" value={formatNumber(summary?.totalCount, 0)} />
          <UniverseMetric label="Verified candidates" value={formatNumber(summary?.eligibleCount, 0)} />
          <UniverseMetric label="Authorized classifications" value={formatNumber(summary?.classificationCoverageCount, 0)} />
          <UniverseMetric label="Live deep scans" value={formatNumber(liveSymbolCount, 0)} emphasize />
        </div>

        <div className="grid gap-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Reference source</p>
            <p className="font-mono text-[11px] text-muted-foreground break-words">
              {summary?.source ?? 'Awaiting server reference refresh'}
            </p>
            <p className="text-muted-foreground">
              Snapshot: {formatTime(summary?.sourceTimestamp)} · refreshed {formatTime(summary?.refreshedAt)}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Classification source</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {summary?.classificationSource ?? 'No authorized classification source'}
            </p>
            <p className="text-muted-foreground">
              {summary?.classificationReason ?? 'Classification is unavailable until an authorized reference refresh completes.'}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-border bg-background/50 p-3">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs leading-relaxed text-muted-foreground" data-testid="market-universe-reason">
                {summary?.reason ?? 'The server has not completed its first reference refresh.'}
              </p>
              {summary?.eligibleSample && summary.eligibleSample.length > 0 && (
                <p className="mt-2 font-mono text-[11px] text-primary">
                  Candidate sample: {summary.eligibleSample.join(' · ')}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FocusedScanRoutingCard({ status }: { status: FocusedScanSnapshot | null }) {
  const stateStyle = status?.state === 'scanning'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : status?.state === 'ready'
      ? 'border-primary/40 bg-primary/10 text-primary'
      : status?.state === 'blocked'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-muted-foreground/30 bg-muted/50 text-muted-foreground';
  const authorizationStyle = status?.authorization.state === 'available'
    ? 'text-emerald-700 dark:text-emerald-300'
    : status?.authorization.state === 'blocked' || status?.authorization.state === 'unavailable'
      ? 'text-destructive'
      : 'text-amber-700 dark:text-amber-300';

  return (
    <Card className="scroll-mt-20" data-testid="focused-scan-routing">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <Radio className="h-4 w-4 text-primary" />
              Focused Live-Scan Routing
            </CardTitle>
            <CardDescription className="mt-1">
              Bounded, isolated scans for future verified market leaders. The protected five-symbol pool and Alpha Ranking are not changed.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={`font-mono text-[10px] uppercase ${stateStyle}`}
            data-testid="focused-scan-state"
          >
            {status?.state ?? 'unavailable'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <RoutingGate
            label="Databento capability"
            value={status?.authorization.state ?? 'unavailable'}
            className={authorizationStyle}
          />
          <RoutingGate
            label="Verified reference"
            value={status?.reference.available ? 'available' : 'unavailable'}
            className={status?.reference.available ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}
          />
          <RoutingGate
            label="Focused capacity"
            value={`${status?.capacity.active ?? 0}/${status?.capacity.maximum ?? 0}`}
            className="text-foreground"
          />
        </div>

        <div className="rounded-md border border-dashed border-border bg-background/50 p-3">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs leading-relaxed text-muted-foreground" data-testid="focused-scan-reason">
                {status?.reason ?? 'Focused-scan capability is awaiting the current server status.'}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {status?.leaderEvidence.reason ?? 'No verified market-leader evidence is available.'}
              </p>
            </div>
          </div>
        </div>

        {status?.activeScans && status.activeScans.length > 0 ? (
          <div className="space-y-2" data-testid="focused-scan-active-list">
            {status.activeScans.map((scan) => (
              <div key={scan.symbol} className="rounded-md border border-border/70 bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{scan.symbol}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {scan.marketFeedState}
                    </Badge>
                  </div>
                  <span className={cn('font-mono text-[10px]', scan.dataFresh ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>
                    {scan.dataFresh ? 'fresh evidence' : 'freshness gate pending'}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{scan.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="focused-scan-empty">
            No focused live scans are active. Reference records, cached data, heartbeats, and manual UI input cannot create one.
          </p>
        )}

        {status?.candidates && status.candidates.length > 0 && (
          <div className="border-t border-border/60 pt-3">
            <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Recent routing decisions</p>
            <div className="space-y-2">
              {status.candidates.slice(0, 4).map((candidate) => (
                <div key={`${candidate.symbol}-${candidate.updatedAt}`} className="flex gap-3 text-xs">
                  <span className="w-14 shrink-0 font-mono font-medium">{candidate.symbol}</span>
                  <span className="w-24 shrink-0 font-mono text-muted-foreground">{candidate.state.replaceAll('_', ' ')}</span>
                  <span className="min-w-0 text-muted-foreground">{candidate.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoutingGate({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-3">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-mono text-sm font-semibold uppercase', className)}>{value}</p>
    </div>
  );
}

function UniverseMetric({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-3">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-mono text-lg font-semibold', emphasize ? 'text-primary' : 'text-foreground')}>{value}</p>
    </div>
  );
}

function RadarUniverseCard({
  symbols,
  ranking,
}: {
  symbols: RadarSymbolStatus[];
  ranking: AlphaRadarRankingSnapshot | null;
}) {
  const entries = ranking?.entries ?? [];
  const displayItems = entries.length > 0
    ? entries.map((entry) => ({ entry, symbol: symbols.find((symbol) => symbol.symbol === entry.symbol) }))
    : symbols.map((symbol) => ({ entry: null, symbol }));

  return (
    <Card data-testid="radar-universe">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <ScanLine className="h-4 w-4 text-primary" />
              Live Pre-Breakout Scan Universe & Ranking
            </CardTitle>
            <CardDescription className="mt-1">
              Independent Databento live windows and cross-symbol Alpha Ranking for NVDA, MU, VRT, CRDO, and AMD.
            </CardDescription>
          </div>
          {ranking?.reorderPending ? (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-300">
              Reorder pending · {ranking.pendingObservationCount}/{ranking.requiredObservationCount}
            </Badge>
          ) : ranking?.leaderSymbol ? (
            <Badge className="border border-primary/40 bg-primary/10 font-mono text-[10px] text-primary">
              Alpha rank leader · {ranking.leaderSymbol}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              Building live windows
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 xl:grid-cols-2" data-testid="alpha-ranking-board">
          {displayItems.map(({ entry, symbol }) => {
            const sym = entry?.symbol ?? symbol?.symbol ?? 'UNK';
            const scanHealth = symbol?.scanHealth;
            const active =
              scanHealth?.marketDataState === 'fresh'
              && scanHealth.marketDataGateReady === true;
            const detectionState = entry?.detectionState ?? symbol?.alphaRadar.preBreakout.state ?? 'unavailable';
            const confirmationStatus = entry?.confirmationStatus ?? symbol?.alphaRadar.preBreakout.confirmation.status ?? 'unavailable';
            const recentHistory = symbol?.signalHistory.slice(-3) ?? [];
            const missingEvidence = symbol?.alphaRadar.preBreakout.confirmation.missingEvidence ?? [];
            return (
              <div
                key={sym}
                className={cn(
                  'rounded-md border p-3 flex flex-col gap-3',
                  active ? 'border-border/80 bg-card' : 'border-border/60 bg-muted/30',
                  entry?.eligibility === 'ranked' ? 'border-primary/20 shadow-sm' : ''
                )}
                data-testid={`ranking-entry-${sym}`}
              >
                {/* Header: Rank, Symbol, Scores */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex flex-col items-center justify-center w-8 h-8 rounded font-mono font-bold text-base",
                      entry?.rank === 1 ? "bg-primary/20 text-primary border border-primary/30" : "bg-muted text-muted-foreground border border-border"
                    )}>
                      {entry?.rank ?? '-'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">{sym}</span>
                        <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-primary animate-pulse' : 'bg-muted-foreground')} />
                      </div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground flex gap-1.5 items-center mt-0.5">
                        <span className={cn(
                          entry?.eligibility === 'ranked' ? 'text-primary font-medium' : 'text-muted-foreground',
                          "uppercase"
                        )}>
                          {entry?.eligibility ?? 'building'}
                        </span>
                        {entry?.orderStatus === 'pending' && (
                          <>
                            <span className="text-border">•</span>
                            <span className="text-amber-600 dark:text-amber-400">stabilizing</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end text-right">
                    <div className="text-lg font-mono font-bold text-foreground flex items-baseline gap-1">
                      {entry?.rankingScore !== null && entry?.rankingScore !== undefined ? formatNumber(entry.rankingScore, 1) : '-'}
                      <span className="text-[9px] text-muted-foreground uppercase font-sans font-normal mb-0.5">Index</span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground flex items-baseline gap-1 mt-0.5">
                      {entry?.alphaScore !== null && entry?.alphaScore !== undefined ? formatNumber(entry.alphaScore, 1) : '-'}
                      <span className="text-[8px] uppercase font-sans font-normal">Alpha</span>
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2 border-y border-border/60 py-2.5 font-mono text-[9px] sm:grid-cols-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-wide text-muted-foreground font-sans">State</span>
                    <span className={cn('uppercase font-semibold truncate', detectionStateColor(detectionState))}>
                      {detectionState.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-wide text-muted-foreground font-sans">Velocity</span>
                    <span className={cn((entry?.alphaVelocity ?? symbol?.alphaRadar.alphaVelocity.rate30s ?? 0) > 0 ? 'text-primary' : 'text-foreground')}>
                      {signedRate(entry?.alphaVelocity ?? symbol?.alphaRadar.alphaVelocity.rate30s ?? null)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-wide text-muted-foreground font-sans">Confidence</span>
                    <span className="text-foreground">{entry?.confidence !== undefined ? formatNumber(entry.confidence, 0) + '%' : '-'}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-wide text-muted-foreground font-sans">Trajectory</span>
                    <span className={cn(
                      'uppercase',
                      entry?.trajectory === 'strengthening' ? 'text-emerald-600 dark:text-emerald-400' :
                      entry?.trajectory === 'weakening' ? 'text-destructive' : 'text-foreground'
                    )}>
                      {entry?.trajectory ?? '-'}
                    </span>
                  </div>
                </div>

                {/* Server Reason */}
                {entry?.reason && (
                  <div className="text-[9px] text-muted-foreground bg-muted/40 p-2 rounded-sm border border-border/50">
                    {entry.reason}
                  </div>
                )}
                {entry?.factorContributions && (
                  <div
                    className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[8px] uppercase text-muted-foreground"
                    data-testid={`ranking-factors-${sym}`}
                  >
                    <span>Index mix</span>
                    <span>Alpha {formatNumber(entry.factorContributions.alphaScore, 1)}</span>
                    <span>Velocity {formatNumber(entry.factorContributions.alphaVelocity, 1)}</span>
                    <span>Acceleration {formatNumber(entry.factorContributions.componentAcceleration, 1)}</span>
                    <span>Trajectory {formatNumber(entry.factorContributions.signalTrajectory, 1)}</span>
                  </div>
                )}

                <div
                  className="rounded-md border border-border/60 bg-background/50 p-2.5"
                  data-testid={`protected-scan-health-${sym}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      Protected scan health
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          'border font-mono text-[9px] uppercase',
                          scanHealth?.schedulerState === 'scheduled'
                            ? 'border-primary/35 bg-primary/10 text-primary'
                            : scanHealth?.schedulerState === 'delayed'
                              ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              : 'border-border bg-muted text-muted-foreground',
                        )}
                        data-testid={`scheduler-state-${sym}`}
                      >
                        {scanHealth?.schedulerState ?? 'inactive'} scheduler
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          'border font-mono text-[9px] uppercase',
                          scanHealth?.marketDataState === 'fresh'
                            ? 'border-primary/35 bg-primary/10 text-primary'
                            : scanHealth?.marketDataState === 'stale' || scanHealth?.marketDataState === 'offline'
                              ? 'border-destructive/30 bg-destructive/10 text-destructive'
                              : 'border-border bg-muted text-muted-foreground',
                        )}
                        data-testid={`scan-market-state-${sym}`}
                      >
                        {scanHealth?.marketDataState ?? 'unavailable'} data
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[9px] sm:grid-cols-3">
                    <ScanHealthValue
                      label="Cadence"
                      value={scanHealth ? `${scanModeText(scanHealth.scanMode)} · ${formatMilliseconds(scanHealth.scanIntervalMs)}` : '—'}
                    />
                    <ScanHealthValue
                      label="Last completed scan"
                      value={scanHealth?.lastScanAt ? `${formatTime(scanHealth.lastScanAt)} · ${formatMilliseconds(scanHealth.lastScanAgeMs)} ago` : 'Never'}
                    />
                    <ScanHealthValue
                      label="Scheduler timing"
                      value={scanTimingText(scanHealth?.nextScanAt, scanHealth?.scanLagMs)}
                    />
                    <ScanHealthValue
                      label="Last real market event"
                      value={scanHealth?.lastMarketEventAt ? `${formatTime(scanHealth.lastMarketEventAt)} · ${formatMilliseconds(scanHealth.lastMarketEventAgeMs)} ago` : 'None verified'}
                    />
                    <ScanHealthValue
                      label="Market-data gate"
                      value={scanHealth?.marketDataGateReady ? 'Verified ready' : 'Not verified'}
                      tone={scanHealth?.marketDataGateReady ? 'positive' : 'muted'}
                    />
                    <ScanHealthValue
                      label="Degradation"
                      value={(scanHealth?.degradation ?? 'unavailable').replaceAll('_', ' ')}
                      tone={scanHealth?.degradation === 'ready' ? 'positive' : scanHealth?.degradation === 'offline' || scanHealth?.degradation === 'stale_market_data' ? 'negative' : 'muted'}
                    />
                  </div>
                  <p
                    className="mt-2 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground"
                    data-testid={`scan-health-reason-${sym}`}
                  >
                    {scanHealth?.reason ?? 'The server has not supplied protected scanner health for this symbol. Market-data verification remains unavailable.'}
                  </p>
                </div>

                {/* Confirmation & Missing Evidence */}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Confirmation</span>
                  <Badge
                    variant="outline"
                    className={cn('border font-mono text-[9px] uppercase', universeConfirmationStyle(confirmationStatus))}
                    data-testid={`confirmation-status-${sym}`}
                  >
                    {confirmationStatus}
                  </Badge>
                </div>
                <div className="border-t border-border/60 pt-2" data-testid={`confirmation-missing-${sym}`}>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    {missingEvidence.length > 0 ? 'Still required' : 'Converged evidence'}
                  </p>
                  <p className={cn('mt-1 text-[10px] leading-relaxed', missingEvidence.length > 0 ? 'text-muted-foreground' : 'text-primary')}>
                    {missingEvidence.length > 0
                      ? missingEvidence.slice(0, 3).join(' · ')
                      : 'All confirmation categories are satisfied.'}
                  </p>
                </div>

                {/* Signal History */}
                <div className="border-t border-border/60 pt-2" data-testid={`signal-history-${sym}`}>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Recent trajectory</p>
                  {recentHistory.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {recentHistory.map((hist, index) => (
                        <div
                          key={`${hist.occurredAt}-${hist.toState}-${index}`}
                          className="flex items-start justify-between gap-2 text-[9px]"
                        >
                          <span className={cn('font-mono uppercase', hist.dataFresh ? detectionStateColor(hist.toState) : 'text-muted-foreground')}>
                            {hist.toState.replaceAll('_', ' ')} · {hist.toConfirmationStatus}
                          </span>
                          <span className="shrink-0 font-mono text-muted-foreground">{formatTime(hist.occurredAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground">No state transition recorded yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function detectionStateColor(state: RadarSymbolStatus['alphaRadar']['preBreakout']['state']): string {
  if (state === 'confirmed') return 'text-primary';
  if (state === 'breakout_critical') return 'text-amber-600 dark:text-amber-300';
  if (state === 'latent') return 'text-sky-600 dark:text-sky-300';
  return 'text-muted-foreground';
}

function universeConfirmationStyle(
  status: RadarSymbolStatus['alphaRadar']['preBreakout']['confirmation']['status'],
): string {
  if (status === 'confirmed') return 'border-primary/40 bg-primary/10 text-primary';
  if (status === 'pending') return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'rejected') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-border bg-muted text-muted-foreground';
}

function signedRate(value: number | null): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${formatNumber(value, 1)}/min`;
}

function ScanHealthValue({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
}) {
  return (
    <div className="min-w-0">
      <p className="text-[8px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 break-words font-medium',
          tone === 'positive'
            ? 'text-primary'
            : tone === 'negative'
              ? 'text-destructive'
              : tone === 'muted'
                ? 'text-muted-foreground'
                : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function formatMilliseconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${formatNumber(value / 1_000, value % 1_000 === 0 ? 0 : 1)}s`;
}

function scanModeText(mode: RadarSymbolStatus['scanHealth']['scanMode']): string {
  if (mode === 'pre_open') return 'Pre-open';
  if (mode === 'opening') return 'Opening';
  return 'Normal';
}

function scanTimingText(nextScanAt: string | null | undefined, scanLagMs: number | null | undefined): string {
  if (!nextScanAt) return 'No scan scheduled';
  if (scanLagMs !== null && scanLagMs !== undefined && scanLagMs > 0) {
    return `Overdue ${formatMilliseconds(scanLagMs)}`;
  }
  return `Next ${formatTime(nextScanAt)}`;
}

function ConnectionHealthCard({
  status,
  transportState,
  isError,
}: {
  status: RadarStatus | null;
  transportState: 'connecting' | 'connected' | 'reconnecting';
  isError: boolean;
}) {
  const reconnectLabel = describeReconnect(status?.reconnectState, status?.reconnectAttempt, status?.nextReconnectAt);
  const browserLinkLabel =
    transportState === 'connected'
      ? 'SSE connected'
      : transportState === 'reconnecting'
        ? 'Recovering · REST fallback active'
        : 'Opening SSE link';
  const hasFailure = isError || Boolean(status?.error);
  const marketIsStale = status?.marketFeedState === 'stale';

  return (
    <Card className={cn(
      'border-l-4',
      hasFailure
        ? 'border-l-destructive'
        : marketIsStale || transportState === 'reconnecting'
          ? 'border-l-amber-500'
          : 'border-l-primary',
    )}>
      <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Connection Health
          </CardTitle>
          <CardDescription className="mt-1 text-xs">
            Live feed and browser transport are monitored separately.
          </CardDescription>
        </div>
        <Radio className={cn('h-4 w-4', hasFailure ? 'text-destructive' : 'text-primary')} />
      </CardHeader>
      <CardContent className="space-y-3 font-mono text-sm">
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
          <span className="text-muted-foreground">Market data</span>
          <MarketFeedStatusBadge
            state={status?.marketFeedState}
            error={isError}
            acceptanceState={status?.liveIngestion.acceptanceState}
          />
        </div>
        <HealthRow
          label="Databento transport"
          value={connectionTransportLabel(status?.connectionState)}
          detail="Connection health only; it does not confirm a current market event."
        />
        <HealthRow
          label="Last heartbeat"
          value={formatTime(status?.lastHeartbeatAt)}
          detail={formatAge(status?.lastHeartbeatAt)}
        />
        <HealthRow
          label="Last market update"
          value={formatTime(status?.lastUpdatedAt)}
          detail={formatAge(status?.lastUpdatedAt)}
        />
        <HealthRow
          label="Browser link"
          value={browserLinkLabel}
          detail={transportState === 'connected' ? 'Status SSE connected; it does not verify a market event' : 'Automatic browser-link recovery enabled'}
          icon={transportState === 'reconnecting' ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-500" /> : undefined}
        />
        <HealthRow
          label="Reconnect"
          value={reconnectLabel}
          detail={status?.reconnectState === 'scheduled' ? `Attempt ${status.reconnectAttempt} of 5` : 'Safe bounded retry policy'}
        />
        {status?.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
            <span className="font-semibold uppercase tracking-wide">Feed error: </span>
            {status.error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RadarScoreCard({ radar }: { radar: RadarSnapshot | null }) {
  const statusLabel = radar ? radarStatusLabel(radar.status) : 'Insufficient Data';
  const statusTone =
    radar?.status === 'breakout_setup'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : radar?.status === 'watch'
        ? 'border-primary/30 bg-primary/10 text-primary'
        : radar?.status === 'data_stale'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-border bg-muted/50 text-muted-foreground';
  const score = radar?.score ?? null;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0 bg-gradient-to-r from-primary/[0.08] to-transparent">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            <Gauge className="h-4 w-4 text-primary" />
            Alpha Radar
          </CardTitle>
          <CardDescription className="mt-2 text-xs">
            A transparent, read-only summary of recent NVDA market activity.
          </CardDescription>
        </div>
        <Badge className={cn('border font-mono text-[10px] uppercase tracking-wider', statusTone)} data-testid="status-radar-classification">
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-5 pt-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex items-end gap-2">
          <span className="font-mono text-6xl font-bold leading-none tracking-tighter" data-testid="text-alpha-radar-score">
            {score ?? '—'}
          </span>
          <span className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">/ 100</span>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className={cn('font-semibold uppercase tracking-wide', freshnessTone(radar?.freshness))} data-testid="status-radar-freshness">
              {freshnessLabel(radar?.freshness)}
            </span>
            <span className="font-mono text-muted-foreground" data-testid="text-radar-age">
              {formatAge(radar?.dataTimestamp)}
            </span>
            <span className="font-mono text-muted-foreground">
              {radar?.sampleCount ?? 0} observations
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {score === null
              ? 'The score stays unavailable until enough fresh quote and trade observations arrive.'
              : `Calculated from momentum, volume intensity, classified buy/sell pressure, and quoted spread over the most recent ${radar?.windowSeconds ?? 60}s window.`}
          </p>
          <p className="text-[10px] leading-relaxed text-muted-foreground/90">
            This is a factual activity classification, not a forecast, trade instruction, or recommendation.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function RadarComponentsCard({ radar }: { radar: RadarSnapshot | null }) {
  const signals = radar
    ? [
        {
          key: 'momentum',
          title: 'Momentum',
          icon: TrendingUp,
          signal: radar.momentum,
          value: formatPercent(radar.momentum.changePercent),
          subtitle: `${radar.windowSeconds}s price movement`,
        },
        {
          key: 'volume',
          title: 'Volume intensity',
          icon: BarChart3,
          signal: radar.volumeIntensity,
          value: radar.volumeIntensity.ratio === null ? '-' : `${formatNumber(radar.volumeIntensity.ratio, 1)}×`,
          subtitle:
            radar.volumeIntensity.recentVolume === null
              ? 'Trade volume comparison'
              : `${formatNumber(radar.volumeIntensity.recentVolume, 0)} recent shares`,
        },
        {
          key: 'pressure',
          title: 'Classified pressure',
          icon: ArrowLeftRight,
          signal: radar.pressure,
          value: radar.pressure.score === null ? '-' : `${formatNumber(radar.pressure.score, 0)}% buy`,
          subtitle: `${radar.pressure.classifiedTrades} classified trades`,
        },
        {
          key: 'spread',
          title: 'Quoted spread',
          icon: ScanLine,
          signal: radar.spread,
          value: radar.spread.spreadBps === null ? '-' : `${formatNumber(radar.spread.spreadBps, 1)} bps`,
          subtitle: radar.spread.spread === null ? 'Bid / ask quality' : `${formatNumber(radar.spread.spread, 2)} wide`,
        },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Score components
        </CardTitle>
        <CardDescription className="mt-1 text-xs">
          Each component is timestamped independently so quiet or incomplete inputs remain visible.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {radar ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {signals.map(({ key, title, icon: Icon, signal, value, subtitle }) => (
              <SignalCard key={key} title={title} icon={<Icon className="h-4 w-4" />} signal={signal} value={value} subtitle={subtitle} />
            ))}
          </div>
        ) : (
          <EmptyRadarState />
        )}
      </CardContent>
    </Card>
  );
}

function SignalCard({
  title,
  icon,
  signal,
  value,
  subtitle,
}: {
  title: string;
  icon: React.ReactNode;
  signal: RadarSignal;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3" data-testid={`card-signal-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="text-primary">{icon}</span>
          {title}
        </div>
        <span className={cn('text-[10px] font-semibold uppercase tracking-wide', freshnessTone(signal.freshness))}>
          {freshnessLabel(signal.freshness)}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-2xl font-semibold" data-testid={`text-signal-value-${title.toLowerCase().replaceAll(' ', '-')}`}>{value}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</div>
        </div>
        <span className="rounded bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
          {signal.score === null ? '—' : `${Math.round(signal.score)}/100`}
        </span>
      </div>
      <p className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">{signal.detail}</p>
      <div className="mt-2 font-mono text-[10px] text-muted-foreground/80">
        {formatTime(signal.dataTimestamp)} · {formatAge(signal.dataTimestamp)}
      </div>
    </div>
  );
}

function ActivityObservationsCard({ radar }: { radar: RadarSnapshot | null }) {
  return (
    <Card>
      <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Factual activity observations
          </CardTitle>
          <CardDescription className="mt-1 text-xs">
            Describes recent feed behavior only; it does not recommend an action.
          </CardDescription>
        </div>
        <CircleAlert className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {radar?.activityFlags.length ? (
          <div className="space-y-2">
            {radar.activityFlags.map((flag) => (
              <div key={flag.type} className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5" data-testid={`observation-${flag.type}`}>
                <p className="text-xs font-semibold">{flag.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{flag.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground" data-testid="text-no-activity-observations">
            No unusual activity is currently identified from the available comparison window.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyRadarState() {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      Waiting for the first safe market-data snapshot.
    </div>
  );
}

function HealthRow({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-right">
        {icon}
        <span>
          <span className="block font-semibold text-foreground">{value}</span>
          <span className="block text-[10px] text-muted-foreground">{detail}</span>
        </span>
      </span>
    </div>
  );
}

function describeReconnect(
  state: RadarReconnectState | undefined,
  attempt: number | undefined,
  nextReconnectAt: string | null | undefined,
): string {
  switch (state) {
    case 'scheduled':
      return `Retrying at ${formatTime(nextReconnectAt)}`;
    case 'reconnecting':
      return `Retry ${attempt ?? 0} in progress`;
    case 'exhausted':
      return 'Retries paused';
    default:
      return 'Stable';
  }
}

function MarketFeedStatusBadge({
  state,
  error,
  acceptanceState,
}: {
  state?: MarketFeedState,
  error: boolean,
  acceptanceState?: RadarStatus['liveIngestion']['acceptanceState'],
}) {
  if (error || state === 'offline') {
    return (
      <Badge variant="destructive" className="gap-1.5 py-1 px-2.5 bg-destructive/10 text-destructive hover:bg-destructive/20 font-mono text-[11px] uppercase tracking-wider">
        <AlertCircle className="h-3 w-3" />
        Offline
      </Badge>
    );
  }

  if (acceptanceState === 'awaiting_live_event') {
    return (
      <Badge variant="outline" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <CircleAlert className="h-3 w-3" />
        Not verified
      </Badge>
    );
  }

  if (state === 'streaming') {
    return (
      <Badge variant="default" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
        </span>
        Streaming
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
      <CircleAlert className="h-3 w-3" />
      Stale
    </Badge>
  );
}

function connectionTransportLabel(state: RadarConnectionState | undefined): string {
  switch (state) {
    case 'streaming':
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Offline';
  }
}

function radarStatusLabel(status: RadarSnapshot['status']): string {
  switch (status) {
    case 'breakout_setup':
      return 'Breakout Setup';
    case 'watch':
      return 'Watch';
    case 'data_stale':
      return 'Data Stale';
    case 'insufficient':
      return 'Insufficient Data';
    default:
      return 'Neutral';
  }
}

function freshnessLabel(freshness: RadarSnapshot['freshness'] | undefined): string {
  switch (freshness) {
    case 'fresh':
      return 'Fresh';
    case 'stale':
      return 'Stale';
    case 'quiet':
      return 'Quiet';
    default:
      return 'Insufficient data';
  }
}

function freshnessTone(freshness: RadarSnapshot['freshness'] | undefined): string {
  switch (freshness) {
    case 'fresh':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'stale':
      return 'text-amber-600 dark:text-amber-400';
    case 'quiet':
      return 'text-muted-foreground';
    default:
      return 'text-amber-600 dark:text-amber-400';
  }
}
