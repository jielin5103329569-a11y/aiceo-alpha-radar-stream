import React from 'react';
import { useStartRadarConnection, useStopRadarConnection, useGetRadarStatus } from '@workspace/api-client-react';
import { useRadarStream } from '@/hooks/use-radar-stream';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { formatNumber, formatTime, cn } from '@/lib/utils';
import { AlertCircle, Activity, Power, PowerOff, Zap, ShieldAlert, WifiOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { RadarConnectionState } from '@workspace/api-client-react';

export default function Dashboard() {
  const { status, isLoading, isError } = useRadarStream();
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
              <ConnectionStatusBadge state={status?.connectionState} error={isError} />
              
              {isConnected ? (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="gap-2"
                  onClick={handleStop}
                  disabled={stopConnection.isPending}
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
                  <span className="text-muted-foreground">Last Ping</span>
                  <span>{formatTime(status?.lastUpdatedAt)}</span>
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
              </div>
            </CardContent>
          </Card>
          
          <div className="text-[10px] text-muted-foreground/60 text-center uppercase tracking-widest mt-4">
            Notice: This app does not trade or place orders. Verification only.
          </div>
        </div>

        {/* Right Column - Streams & Tape */}
        <div className="lg:col-span-8 flex flex-col gap-6">
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
                    <div key={idx} className="flex items-center justify-between p-3 border border-border rounded-md bg-card">
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
                          <td className="px-4 py-2 text-center">
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

function ConnectionStatusBadge({ state, error }: { state?: RadarConnectionState, error: boolean }) {
  if (error || state === 'error') {
    return (
      <Badge variant="destructive" className="gap-1.5 py-1 px-2.5 bg-destructive/10 text-destructive hover:bg-destructive/20 font-mono text-[11px] uppercase tracking-wider">
        <AlertCircle className="h-3 w-3" />
        Connection Lost
      </Badge>
    );
  }

  switch (state) {
    case 'streaming':
      return (
        <Badge variant="default" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          Streaming
        </Badge>
      );
    case 'connected':
      return (
        <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          Connected
        </Badge>
      );
    case 'connecting':
      return (
        <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider animate-pulse">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          Connecting...
        </Badge>
      );
    case 'stopped':
    case 'not_configured':
    default:
      return (
        <Badge variant="outline" className="gap-1.5 py-1 px-2.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground border-dashed">
          <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          Offline
        </Badge>
      );
  }
}
