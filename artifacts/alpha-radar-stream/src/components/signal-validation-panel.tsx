import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { 
  useGetSignalValidation, 
  useGetSignalValidationAudit, 
  GetSignalValidationHorizonDays,
  getGetSignalValidationQueryKey,
  getGetSignalValidationAuditQueryKey,
} from '@workspace/api-client-react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  Database, 
  Activity, 
  History,
  ShieldAlert,
  Fingerprint,
  Lock,
  Unlock,
  Info
} from 'lucide-react';
import { formatNumber, formatPercent, formatTime, cn } from '@/lib/utils';

export function SignalValidationPanel() {
  const { data, isLoading, isError } = useGetSignalValidation(
    { horizonDays: GetSignalValidationHorizonDays.NUMBER_5, limit: 10 },
    {
      query: {
        queryKey: getGetSignalValidationQueryKey({
          horizonDays: GetSignalValidationHorizonDays.NUMBER_5,
          limit: 10,
        }),
        refetchInterval: 30000,
      },
    }
  );

  const [auditSignalId, setAuditSignalId] = useState<string | null>(null);

  if (isLoading && !data) {
    return (
      <Card className="animate-pulse border-dashed">
        <CardHeader className="pb-4 border-b border-border/50">
          <CardTitle className="text-sm text-muted-foreground flex gap-2 uppercase tracking-widest font-mono">
            <ShieldCheck className="h-4 w-4" /> Loading Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="h-48 bg-muted/10"></CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm text-destructive flex gap-2 uppercase tracking-widest font-mono">
            <ShieldAlert className="h-4 w-4" /> Validation Error
          </CardTitle>
          <CardDescription className="text-destructive/80 mt-1">Could not retrieve validation metrics.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

   const { metrics, metricDefinitions, persistenceState, reason, totalSignals, signals } = data;
  const isInsufficient = metrics.sampleState === 'insufficient_sample';

  return (
    <>
      <Card className="scroll-mt-20 border-border/80 shadow-sm" data-testid="signal-validation-panel">
        <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
               <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Model Validation & Accuracy
               </CardTitle>
               <CardDescription className="mt-1.5 text-xs text-muted-foreground/80 max-w-[500px] leading-relaxed">
                  Historical signal integrity and outcome verification. Evaluates triggered pre-breakout windows against 5-day horizon checkpoints.
               </CardDescription>
            </div>
            <div className="shrink-0">
               {persistenceState === 'unavailable' ? (
                 <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] font-mono tracking-wider">
                   Persistence Unavailable
                 </Badge>
               ) : (
                 <Badge variant="outline" className="border-primary/40 text-primary text-[10px] font-mono tracking-wider bg-primary/5">
                    History Protected
                 </Badge>
               )}
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="pt-5 space-y-6">
          {persistenceState === 'unavailable' && (
            <div className="text-xs p-3 border border-dashed border-destructive/50 bg-destructive/10 text-destructive rounded-md flex items-start gap-3">
               <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
               <div>
                  <div className="font-semibold uppercase tracking-wider text-[10px]">Warning</div>
                   <div className="mt-1 opacity-90 leading-relaxed">{reason}</div>
               </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="validation-metrics">
             <MetricBox 
               label="Hit Rate" 
               value={isInsufficient ? <span className="text-[10px] tracking-widest text-muted-foreground font-sans uppercase">Insufficient Sample</span> : (metrics.hitRatePercent != null ? formatPercent(metrics.hitRatePercent) : '-')} 
               subtitle={isInsufficient ? `Sample: ${metrics.sampleSize}/${metrics.minimumSampleSize}` : undefined}
               highlight={!isInsufficient}
               tooltip={metricDefinitions?.hit}
             />
             <MetricBox 
               label="Avg Favorable Return" 
               value={isInsufficient ? "-" : (metrics.averageReturnPercent != null ? formatPercent(metrics.averageReturnPercent) : '-')} 
               highlight={!isInsufficient && (metrics.averageReturnPercent ?? 0) > 0}
             />
             <MetricBox 
               label="Max Drawdown" 
               value={isInsufficient ? "-" : (metrics.maximumDrawdownPercent != null ? formatPercent(metrics.maximumDrawdownPercent) : '-')} 
             />
             <MetricBox 
               label="False Positives" 
               value={isInsufficient ? "-" : (metrics.falsePositiveRatePercent != null ? formatPercent(metrics.falsePositiveRatePercent) : '-')} 
               tooltip={metricDefinitions?.falsePositive}
             />
             <MetricBox 
               label="Lead Time" 
               value={isInsufficient ? "-" : (metrics.averageLeadTimeMinutes != null ? `${formatNumber(metrics.averageLeadTimeMinutes, 1)}m` : '-')} 
               tooltip={metricDefinitions?.leadTime}
             />
          </div>

          <div>
             <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex flex-wrap gap-2 justify-between items-end">
               <span>Recent Immutable Records</span>
               <span className="font-mono font-normal">Total stored: {formatNumber(totalSignals)}</span>
             </h4>
             <div className="border border-border/60 rounded-md overflow-x-auto bg-card">
               <table className="w-full text-xs font-mono text-left whitespace-nowrap min-w-[700px]">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                     <tr>
                       <th className="px-4 py-2.5 font-medium">Time</th>
                       <th className="px-4 py-2.5 font-medium">Symbol</th>
                       <th className="px-4 py-2.5 font-medium">Type</th>
                       <th className="px-4 py-2.5 font-medium text-right">Confidence</th>
                       <th className="px-4 py-2.5 font-medium text-center">Status</th>
                       <th className="px-4 py-2.5 font-medium text-right">Audit</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                     {signals.length === 0 ? (
                       <tr>
                         <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                            <div className="flex flex-col items-center justify-center opacity-60">
                               <Database className="h-6 w-6 mb-2" />
                               No recent records available.
                            </div>
                         </td>
                       </tr>
                     ) : (
                       signals.map(sig => (
                         <tr key={sig.id} className="hover:bg-muted/30 transition-colors group">
                           <td className="px-4 py-2.5 text-muted-foreground">{formatTime(sig.occurredAt)}</td>
                           <td className="px-4 py-2.5 font-bold text-foreground">{sig.symbol}</td>
                           <td className="px-4 py-2.5">
                             <div className="flex items-center gap-2">
                               <span className={cn("px-1.5 py-0.5 rounded uppercase text-[9px] font-bold tracking-wider", 
                                 sig.direction === 'upside' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                                 sig.direction === 'downside' ? "bg-destructive/10 text-destructive" : 
                                 "bg-muted text-muted-foreground"
                               )}>{sig.direction}</span>
                               <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={sig.state}>{sig.state}</span>
                             </div>
                           </td>
                           <td className="px-4 py-2.5 text-right font-medium text-foreground">{formatNumber(sig.confidence, 1)}%</td>
                           <td className="px-4 py-2.5 text-center">
                              {sig.catalystStatus === 'unavailable' ? (
                                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground border border-border/50 bg-muted/20 px-1.5 py-0.5 rounded" title="Contextual news and earnings data unavailable">Catalyst unavailable</span>
                              ) : (
                                 <span className="text-[9px] uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded">{sig.catalystStatus}</span>
                              )}
                           </td>
                           <td className="px-4 py-2.5 text-right">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                 className="h-6 text-[10px] px-2.5 uppercase font-mono tracking-widest opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity focus:opacity-100 bg-background hover:bg-muted" 
                                onClick={() => setAuditSignalId(sig.id)}
                                data-testid={`button-audit-${sig.symbol}`}
                              >
                                 Audit
                              </Button>
                           </td>
                         </tr>
                       ))
                     )}
                  </tbody>
               </table>
             </div>
          </div>
        </CardContent>
      </Card>
      
      <SignalAuditDialog signalId={auditSignalId} open={!!auditSignalId} onOpenChange={(val) => !val && setAuditSignalId(null)} />
    </>
  );
}

function MetricBox({ label, value, subtitle, highlight, tooltip }: { label: string, value: React.ReactNode, subtitle?: string, highlight?: boolean, tooltip?: string }) {
  return (
    <div className="border border-border/60 bg-card p-3 rounded-md flex flex-col justify-between group relative">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
         {label}
         {tooltip && (
            <div className="group-hover:opacity-100 opacity-50 transition-opacity cursor-help" title={tooltip}>
               <Info className="h-3 w-3" />
            </div>
         )}
      </div>
      <div className={cn("font-mono text-lg font-semibold truncate", highlight ? "text-primary" : "text-foreground")}>{value}</div>
      {subtitle && <div className="text-[9px] text-muted-foreground mt-1.5 truncate">{subtitle}</div>}
    </div>
  )
}

function SignalAuditDialog({ 
  signalId, 
  open, 
  onOpenChange 
}: { 
  signalId: string | null, 
  open: boolean, 
  onOpenChange: (open: boolean) => void 
}) {
  const { data: audit, isLoading, isError } = useGetSignalValidationAudit(
    signalId ?? '',
    {
      query: {
        enabled: !!signalId,
        queryKey: getGetSignalValidationAuditQueryKey(signalId ?? ''),
      },
    }
  );
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0 rounded-md border-border/60 shadow-xl" data-testid="signal-audit-dialog">
         {isLoading && !audit ? (
            <div className="p-16 flex flex-col items-center justify-center text-muted-foreground animate-pulse">
               <ShieldCheck className="h-10 w-10 mb-4 opacity-40 text-primary" />
               <p className="text-sm font-mono uppercase tracking-widest">Verifying Integrity Identity...</p>
            </div>
         ) : isError || !audit ? (
            <div className="p-16 flex flex-col items-center justify-center text-destructive">
               <ShieldAlert className="h-10 w-10 mb-4 opacity-40" />
               <p className="text-sm font-mono uppercase tracking-widest">Failed to retrieve audit record.</p>
            </div>
         ) : (
            <>
              <div className="sticky top-0 bg-background/95 backdrop-blur z-20 border-b border-border/60 p-6 pb-4">
                <DialogTitle className="flex items-center gap-2 font-mono uppercase tracking-widest text-sm text-foreground">
                   <FileText className="h-4 w-4 text-primary" />
                   Evidence Audit & Integrity
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-xs">
                   Immutable trigger state and historical verification checkpoints for <span className="font-bold text-foreground bg-muted px-1 py-0.5 rounded">{audit.signal.symbol}</span>.
                </DialogDescription>
              </div>
              
              <div className="p-6 pt-4 space-y-8">
                {/* Integrity Identity */}
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                    <Fingerprint className="h-3.5 w-3.5" /> Integrity Identity
                  </h4>
                  <div className={cn(
                    "grid grid-cols-2 md:grid-cols-5 gap-4 text-xs font-mono border p-4 rounded-md",
                    audit.integrity === 'verified' ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"
                  )}>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Status</div>
                      <div className={cn("font-bold uppercase tracking-widest flex items-center gap-1.5", audit.integrity === 'verified' ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                         {audit.integrity === 'verified' ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />} {audit.integrity}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Record ID</div>
                      <div className="truncate font-medium text-foreground" title={audit.signal.id}>{audit.signal.id}</div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">SHA-256 Hash</div>
                      <div className="truncate text-foreground/70" title={audit.signal.recordHash}>{audit.signal.recordHash}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Schema</div>
                      <div className="text-foreground">v{audit.signal.schemaVersion}</div>
                    </div>
                  </div>
                </div>
                
                {/* Trigger Details */}
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" /> Context at Trigger
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono border border-border/50 p-4 rounded-md bg-muted/20">
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Time</div>
                      <div className="text-foreground">{formatTime(audit.signal.occurredAt)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Trigger Price</div>
                      <div className="text-foreground font-semibold">{formatNumber(audit.signal.triggerPrice, 2)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Confidence</div>
                      <div className="text-primary font-semibold">{formatNumber(audit.signal.confidence, 1)}%</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Type</div>
                      <div className="text-foreground">{audit.signal.signalType.replace('_', ' ')}</div>
                    </div>
                  </div>
                </div>
                
                {/* Trigger Evidence */}
                <div>
                   <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                     <ShieldCheck className="h-3.5 w-3.5" /> Trigger Evidence Chain
                   </h4>
                   <div className="border border-border/50 rounded-md divide-y divide-border/50 bg-card overflow-hidden">
                     {audit.signal.evidenceSummary.length === 0 ? (
                       <div className="p-4 text-xs text-muted-foreground text-center bg-muted/10">No evidence captured.</div>
                     ) : (
                       audit.signal.evidenceSummary.map(ev => (
                          <div key={ev.key} className="p-3.5 flex items-start gap-3.5 text-xs font-mono hover:bg-muted/30 transition-colors">
                             <div className={cn(
                               "w-2 h-2 mt-1 rounded-full shrink-0", 
                               ev.satisfied ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-destructive/40"
                             )} />
                             <div className="min-w-0">
                               <div className={cn("font-semibold mb-1 tracking-wide", ev.satisfied ? "text-foreground" : "text-muted-foreground")}>{ev.label}</div>
                               <div className="text-muted-foreground text-[10px] whitespace-normal break-words leading-relaxed">{ev.detail}</div>
                             </div>
                          </div>
                       ))
                     )}
                   </div>
                </div>

                {/* Checkpoints */}
                <div>
                   <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                     <History className="h-3.5 w-3.5" /> Outcome Checkpoints
                   </h4>
                   <div className="border border-border/50 rounded-md bg-card overflow-x-auto">
                     <table className="w-full text-xs font-mono text-left whitespace-nowrap min-w-[500px]">
                       <thead className="bg-muted/40 text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                          <tr>
                            <th className="px-4 py-3 font-medium">Horizon</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3 font-medium text-center">Hit</th>
                            <th className="px-4 py-3 font-medium text-right">Return</th>
                            <th className="px-4 py-3 font-medium text-right">Max Drawdown</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-border/40">
                         {audit.signal.checkpoints.length === 0 ? (
                            <tr>
                               <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground bg-muted/10">No checkpoints established.</td>
                            </tr>
                         ) : (
                           audit.signal.checkpoints.map(cp => (
                              <tr key={cp.horizonDays} className="hover:bg-muted/30 transition-colors">
                                 <td className="px-4 py-3">
                                   <div className="font-semibold text-foreground">{cp.horizonDays}D</div>
                                   {cp.observedAt && <div className="text-[9px] text-muted-foreground mt-0.5">{formatTime(cp.observedAt)}</div>}
                                 </td>
                                 <td className="px-4 py-3">
                                   <span className={cn(
                                     "px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-widest",
                                     cp.checkpointStatus === 'complete' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                                     cp.checkpointStatus === 'pending' ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : 
                                     "bg-muted text-muted-foreground"
                                   )}>
                                     {cp.checkpointStatus}
                                   </span>
                                 </td>
                                 <td className="px-4 py-3 font-medium text-center">
                                   {cp.hit === true ? <span className="text-emerald-600 dark:text-emerald-400">YES</span> : 
                                    cp.hit === false ? <span className="text-muted-foreground">NO</span> : <span className="text-muted-foreground">-</span>}
                                 </td>
                                 <td className="px-4 py-3 text-right">
                                   <span className={cn(
                                     (cp.favorableReturnPercent ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : 
                                     (cp.favorableReturnPercent ?? 0) < 0 ? "text-destructive" : ""
                                   )}>
                                     {cp.favorableReturnPercent !== null ? formatPercent(cp.favorableReturnPercent) : '-'}
                                   </span>
                                 </td>
                                 <td className="px-4 py-3 text-destructive text-right">
                                   {cp.maxDrawdownPercent !== null ? formatPercent(cp.maxDrawdownPercent) : '-'}
                                 </td>
                              </tr>
                           ))
                         )}
                       </tbody>
                     </table>
                   </div>
                </div>

                {/* Catalyst Status */}
                <div>
                   <h4 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                     <AlertTriangle className="h-3.5 w-3.5" /> Catalyst Context
                   </h4>
                   <div className="text-xs font-mono p-3.5 border border-border/50 rounded-md bg-muted/10 text-muted-foreground leading-relaxed">
                     {audit.signal.catalystStatus === 'unavailable' ? 'Catalyst unavailable for this record. Contextual news and earnings data missing.' : audit.signal.catalystStatus}
                   </div>
                </div>
              </div>
            </>
         )}
      </DialogContent>
    </Dialog>
  )
}
