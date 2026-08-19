import React from 'react';
import { useStartRadarConnection, useStopRadarConnection } from '@workspace/api-client-react';
import { useRadarStream } from '@/hooks/use-radar-stream';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadarSignalPanel } from '@/components/radar-signal-panel';
import { formatAge, formatNumber, formatPercent, formatTime, cn } from '@/lib/utils';
import {
  AlertCircle,
  Activity,
  ArrowLeftRight,
  BarChart3,
  CircleAlert,
  Gauge,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  TrendingUp,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { MarketFeedState, RadarConnectionState, RadarReconnectState, RadarSignal, RadarSnapshot, RadarStatus, RadarSymbolStatus } from '@workspace/api-client-react';

export default function Dashboard() {
  const { status, isLoading, isError, transportState } = useRadarStream();
  const startConnection = useStartRadarConnection();
  const stopConnection = useStopRadarConnection();
  const { toast } = useToast();

  const isConnected = status?.connectionState === 'connected' || status?.connectionState === 'streaming';
  const isConnecting = status?.connectionState === 'connecting';
  const isStopped = status?.connectionState === 'stopped';
  const isNotConfigured = status?.connectionState === 'not_configured';

  const handleStart = () => {
    startConnection.mutate(undefined, {
      onError: (err) => {
        toast({
          title: "Failed to start stream",
          description: "Check server configuration.",
          variant: "destructive"
        });
      }
    });
  };

  const handleStop = () => {
    stopConnection.mutate(undefined, {
      onError: (err) => {
        toast({
          title: "Failed to stop stream",
          description: "Server may have already terminated the connection.",
          variant: "destructive"
        });
      }
    });
  };

  if (isLoading && !status) {
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
          <div className="flex h-16 items-center justify-between">
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
            
            <div className="flex items-center gap-4">
              <MarketFeedStatusBadge state={status?.marketFeedState} error={isError} />
              
              {isConnected ? (
                <Button
                  variant="outline" 
                  size="sm" 
                  className="gap-2"
                  onClick={handleStop}
                  disabled={stopConnection.isPending}
                  data-testid="button-terminate-stream"
                >
                  <PowerOff className="h-4 w-4" />
                  <span className="hidden sm:inline">Terminate Stream</span>
                </Button>
              ) : (
                <Button
                  size="sm" 
                  className="gap-2"
                  onClick={handleStart}
                  disabled={startConnection.isPending || isConnecting}
                  data-testid="button-engage-stream"
                >
                  <Power className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {isConnecting ? 'Connecting...' : 'Engage Stream'}
                  </span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

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
          <RadarSignalPanel alphaRadar={status?.alphaRadar} />

          <RadarUniverseCard
            symbols={status?.symbolRadars ?? []}
            leader={status?.preBreakoutLeader ?? null}
          />

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

function RadarUniverseCard({
  symbols,
  leader,
}: {
  symbols: RadarSymbolStatus[];
  leader: RadarStatus['preBreakoutLeader'];
}) {
  return (
    <Card data-testid="radar-universe">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <ScanLine className="h-4 w-4 text-primary" />
              Live Pre-Breakout Scan Universe
            </CardTitle>
            <CardDescription className="mt-1">
              Independent Databento live windows for NVDA, MU, VRT, CRDO, and AMD. States require fresh, converging evidence.
            </CardDescription>
          </div>
          {leader ? (
            <Badge className="border border-primary/40 bg-primary/10 font-mono text-[10px] text-primary">
              Velocity leader · {leader.symbol} · {leader.confirmationStatus}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              Building live windows
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {symbols.map((symbol) => {
            const detection = symbol.alphaRadar.preBreakout;
            const confirmation = detection.confirmation;
            const recentHistory = symbol.signalHistory.slice(-3);
            const active = symbol.marketFeedState === 'streaming' && detection.dataFresh;
            return (
              <div
                key={symbol.symbol}
                className={cn(
                  'rounded-md border p-3',
                  active ? 'border-border/80 bg-card' : 'border-border/60 bg-muted/30',
                )}
                data-testid={`radar-symbol-${symbol.symbol}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-foreground">{symbol.symbol}</span>
                  <span className={cn('h-2 w-2 rounded-full', active ? 'bg-primary animate-pulse' : 'bg-muted-foreground')} />
                </div>
                <p className="mt-2 text-[9px] uppercase tracking-wide text-muted-foreground">Detection state</p>
                <p className={cn('mt-1 font-mono text-[11px] font-semibold uppercase', detectionStateColor(detection.state))}>
                  {detection.state.replaceAll('_', ' ')}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Confirmation</span>
                  <Badge
                    variant="outline"
                    className={cn('border font-mono text-[9px] uppercase', universeConfirmationStyle(confirmation.status))}
                    data-testid={`confirmation-status-${symbol.symbol}`}
                  >
                    {confirmation.status}
                  </Badge>
                </div>
                <div className="mt-3 border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <span>Velocity</span>
                    <span className={cn((symbol.alphaRadar.alphaVelocity.rate30s ?? 0) > 0 ? 'text-primary' : 'text-foreground')}>
                      {signedRate(symbol.alphaRadar.alphaVelocity.rate30s)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2">
                    <span>Evidence</span>
                    <span className="text-foreground">{detection.evidenceCount}</span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2">
                    <span>Persistence</span>
                    <span className="text-foreground">
                      {confirmation.persistenceScans}/{confirmation.requiredPersistenceScans}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2">
                    <span>Freshness</span>
                    <span className={active ? 'text-primary' : 'text-muted-foreground'}>
                      {active ? 'fresh' : symbol.marketFeedState}
                    </span>
                  </div>
                </div>
                <div className="mt-3 border-t border-border/60 pt-2" data-testid={`confirmation-missing-${symbol.symbol}`}>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    {confirmation.missingEvidence.length > 0 ? 'Still required' : 'Converged evidence'}
                  </p>
                  <p className={cn('mt-1 text-[10px] leading-relaxed', confirmation.missingEvidence.length > 0 ? 'text-muted-foreground' : 'text-primary')}>
                    {confirmation.missingEvidence.length > 0
                      ? confirmation.missingEvidence.slice(0, 3).join(' · ')
                      : 'All confirmation categories are satisfied.'}
                  </p>
                </div>
                <div className="mt-3 border-t border-border/60 pt-2" data-testid={`signal-history-${symbol.symbol}`}>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Recent trajectory</p>
                  {recentHistory.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {recentHistory.map((entry, index) => (
                        <div
                          key={`${entry.occurredAt}-${entry.toState}-${entry.toConfirmationStatus}-${index}`}
                          className="flex items-start justify-between gap-2 text-[9px]"
                        >
                          <span className={cn('font-mono uppercase', entry.dataFresh ? detectionStateColor(entry.toState) : 'text-muted-foreground')}>
                            {entry.toState.replaceAll('_', ' ')} · {entry.toConfirmationStatus}
                          </span>
                          <span className="shrink-0 font-mono text-muted-foreground">{formatTime(entry.occurredAt)}</span>
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
  if (state === 'pre_breakout') return 'text-amber-600 dark:text-amber-300';
  if (state === 'accelerating') return 'text-sky-600 dark:text-sky-300';
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
          <MarketFeedStatusBadge state={status?.marketFeedState} error={isError} />
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
          detail={transportState === 'connected' ? 'Live event stream' : 'Automatic recovery enabled'}
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

function MarketFeedStatusBadge({ state, error }: { state?: MarketFeedState, error: boolean }) {
  if (error || state === 'offline') {
    return (
      <Badge variant="destructive" className="gap-1.5 py-1 px-2.5 bg-destructive/10 text-destructive hover:bg-destructive/20 font-mono text-[11px] uppercase tracking-wider">
        <AlertCircle className="h-3 w-3" />
        Offline
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
