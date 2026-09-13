import React from 'react';
import { 
  getGetResearchSidecarSnapshotQueryKey, 
  useGetResearchSidecarSnapshot,
  type ResearchObservationEvent,
  type ResearchResonance
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatTime } from '@/lib/utils';
import { BookOpen, Network, ShieldAlert, FileText, FlaskConical, Tag, Shield } from 'lucide-react';

function laneColor(lane: string) {
  if (lane === 'alex_moonvest') return 'text-indigo-600 border-indigo-500/30 bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-400/30 dark:bg-indigo-400/10';
  if (lane === 'serenity') return 'text-fuchsia-600 border-fuchsia-500/30 bg-fuchsia-500/10 dark:text-fuchsia-400 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10';
  return 'text-muted-foreground border-border bg-muted';
}

function Section({ label, content }: { label: string; content?: string }) {
  if (!content) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <p className="text-foreground text-xs leading-relaxed">{content}</p>
    </div>
  );
}

function IdentityDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-foreground text-[11px] truncate" title={value}>{value}</span>
    </div>
  );
}

function ObservationCard({ obs }: { obs: ResearchObservationEvent }) {
  return (
    <div className="border border-border/60 bg-card rounded-md p-4 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 border-b border-border/50 pb-3">
         <div>
           <div className="flex flex-wrap items-center gap-2 mb-1.5">
             <Badge variant="outline" className={cn("font-mono text-[9px] uppercase", laneColor(obs.sourceLane))}>
               {obs.sourceLane.replace('_', ' ')}
             </Badge>
             <span className="font-mono text-xs font-bold text-foreground">{obs.source}</span>
             <span className="text-[10px] text-muted-foreground font-mono">{obs.sourceReference}</span>
             <span className="text-[9px] font-mono text-muted-foreground opacity-50 ml-1">
                {obs.eventKey} · v{obs.recordVersion} · {obs.recordHash.slice(0,6)}
             </span>
           </div>
           <h4 className="text-sm font-semibold tracking-tight">{obs.viewpoint}</h4>
         </div>
         <div className="flex flex-col items-start md:items-end text-left md:text-right shrink-0">
           <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-mono text-[9px] uppercase mb-1.5 border-dashed">
             <Shield className="h-3 w-3 mr-1.5 inline" />
             {obs.researchOnlyLabel}
           </Badge>
           <span className="text-[10px] font-mono text-muted-foreground">Observed: {formatTime(obs.observedDate)}</span>
           <span className="text-[10px] font-mono text-muted-foreground opacity-60">System: {formatTime(obs.createdAt)}</span>
         </div>
      </div>
      
      {/* Ticker / Identity */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 bg-muted/20 p-2.5 rounded-md border border-border/40">
        <IdentityDetail label="Ticker" value={obs.ticker || '—'} />
        <IdentityDetail label="Identity State" value={obs.tickerIdentityState.replace('_', ' ')} />
        <IdentityDetail label="US Admission" value={obs.usTickerAdmission.replace('_', ' ')} />
        <IdentityDetail label="Confidence" value={obs.confidence} />
        
        {obs.usTickerIdentityEvidence && (
          <div className="col-span-2 lg:col-span-4 mt-1 flex flex-col">
             <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Identity Evidence</span>
             <span className="font-mono text-[10px] text-foreground mt-0.5">{obs.usTickerIdentityEvidence}</span>
          </div>
        )}
      </div>

      {/* Thesis & Fundamentals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-3">
          <Section label="Thesis" content={obs.thesis} />
          <Section label="Valuation / Reversal Basis" content={obs.valuationReversalBasis} />
          
          {obs.industryChainTags && obs.industryChainTags.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-2">
               <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center">
                  <Tag className="h-2.5 w-2.5 mr-1"/> Industry Chain Context
               </span>
               <div className="flex flex-wrap gap-1.5">
                 {obs.industryChainTags.map(t => (
                   <span key={t} className="bg-secondary/60 text-secondary-foreground px-1.5 py-0.5 rounded text-[10px] font-mono border border-border/50">
                     {t}
                   </span>
                 ))}
                 {obs.canonicalIndustryChainKey && (
                   <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-mono border border-primary/30">
                     Key: {obs.canonicalIndustryChainKey}
                   </span>
                 )}
               </div>
            </div>
          )}
        </div>
        
        <div className="space-y-3">
          <Section label="Financials" content={obs.financials} />
          <Section label="Cash & Balance Sheet" content={obs.cashBalanceSheet} />
          <Section label="Buybacks" content={obs.buybacks} />
        </div>
      </div>

      {/* Forward Looking */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-border/50 pt-3">
         <Section label="Catalysts" content={obs.catalysts} />
         <Section label="Risks" content={obs.risks} />
         <Section label="Outcomes" content={obs.outcomes} />
      </div>

      {/* Evidence Map */}
      {obs.evidence && Object.keys(obs.evidence).length > 0 && (
        <div className="border-t border-border/30 pt-3 mt-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold block mb-2">Supporting Evidence Data</span>
          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            {Object.entries(obs.evidence).map(([k, v]) => (
              <div key={k} className="flex bg-muted/40 rounded border border-border/50 overflow-hidden max-w-full">
                <span className="bg-muted/80 px-2 py-1 border-r border-border/50 text-muted-foreground shrink-0">{k}</span>
                <span className="px-2 py-1 truncate" title={String(v)}>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResonanceCard({ res }: { res: ResearchResonance }) {
   return (
      <div className="border border-border/60 bg-background rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:border-primary/30 transition-colors">
         <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
               <Network className="h-3.5 w-3.5 text-primary" />
               <span className="font-mono text-xs font-semibold uppercase text-foreground">{res.resonanceBasis.replace('_', ' ')}</span>
               <span className="text-muted-foreground font-mono text-[10px]">{res.resonanceKey}</span>
               <span className="text-[9px] font-mono text-muted-foreground opacity-50 ml-1">
                 v{res.recordVersion} · {res.recordHash.slice(0,6)}
               </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
               <span className="text-muted-foreground">Derived: {formatTime(res.derivedAt)}</span>
               <span className="text-muted-foreground opacity-50">·</span>
               <span className="text-muted-foreground">Left: {res.leftObservationId.slice(0, 8)}</span>
               <span className="text-muted-foreground opacity-50">·</span>
               <span className="text-muted-foreground">Right: {res.rightObservationId.slice(0, 8)}</span>
            </div>
         </div>
         
         <div className="flex flex-wrap sm:flex-col sm:items-end gap-1.5 shrink-0">
            <div className="flex flex-wrap gap-1">
               {res.sourceLanes && res.sourceLanes.map(l => (
                 <Badge key={l} variant="outline" className={cn("font-mono text-[9px] uppercase", laneColor(l))}>
                   {l.replace('_', ' ')}
                 </Badge>
               ))}
            </div>
            <div className="flex flex-wrap gap-1">
               {res.admittedUsTicker && (
                  <span className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                    Ticker: {res.admittedUsTicker}
                  </span>
               )}
               {res.canonicalIndustryChainKey && (
                  <span className="font-mono text-[10px] bg-secondary/80 text-secondary-foreground px-1.5 py-0.5 rounded border border-secondary-foreground/20">
                    Chain: {res.canonicalIndustryChainKey}
                  </span>
               )}
            </div>
         </div>
      </div>
   );
}

export function ResearchSidecarPanel() {
  const { data, isLoading, isError } = useGetResearchSidecarSnapshot({
    query: {
      queryKey: getGetResearchSidecarSnapshotQueryKey(),
      refetchInterval: 60_000,
      staleTime: 30_000,
    }
  });

  const stateClass = data?.status === 'ready' 
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : data?.status === 'degraded'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-muted-foreground/30 bg-muted/50 text-muted-foreground';

  return (
    <Card id="research-sidecar" className="scroll-mt-20 border-primary/20 bg-background/50 backdrop-blur-sm" data-testid="research-sidecar">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
             <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-primary">
               <BookOpen className="h-4 w-4" />
               Research & Intelligence Sidecar
             </CardTitle>
             <CardDescription className="mt-1.5 max-w-2xl text-xs leading-relaxed">
               Independent market observations and thesis generation. This module operates autonomously from the main live-scan engine.
               <span className="flex items-center gap-1.5 mt-2 font-mono font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-widest text-[10px] bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded w-fit">
                 <ShieldAlert className="h-3 w-3" />
                 Research Use Only • Not A Trading Signal • Does Not Imply System Admission
               </span>
             </CardDescription>
          </div>
          <Badge variant="outline" className={cn('font-mono text-[10px] uppercase', stateClass)}>
             {data ? data.status : isLoading ? 'loading' : 'unavailable'}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
         {isLoading && !data && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-muted/5">
               <BookOpen className="h-8 w-8 mb-3 opacity-20 animate-pulse" />
               <p className="text-xs font-mono uppercase tracking-widest">Fetching Research Intelligence...</p>
            </div>
         )}
         
         {isError && !data && (
            <div className="flex flex-col items-center justify-center py-12 text-destructive bg-destructive/5">
               <ShieldAlert className="h-8 w-8 mb-3 opacity-40" />
               <p className="text-xs font-mono uppercase tracking-widest">Intelligence Sidecar Unavailable</p>
            </div>
         )}

         {data && (
           <div className="p-4 md:p-6 space-y-6 bg-muted/5">
             {/* Reason & Meta */}
             <div className="flex flex-col md:flex-row gap-4 justify-between items-start text-[10px] font-mono text-muted-foreground">
                <div className="flex items-center gap-2.5 bg-background border border-dashed border-border px-3 py-2 rounded-md max-w-2xl">
                   <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                   <span className="leading-relaxed">{data.reason}</span>
                </div>
                <div className="flex flex-col items-start md:items-end gap-1 shrink-0 bg-background border border-border/50 px-3 py-2 rounded-md">
                   <span>Generated: {formatTime(data.generatedAt)}</span>
                   <span className="flex items-center gap-1.5">
                     Lanes: 
                     {data.lanes && data.lanes.map(l => (
                       <span key={l} className={cn("px-1 rounded text-[9px] border", laneColor(l))}>
                         {l.replace('_', ' ')}
                       </span>
                     ))}
                   </span>
                </div>
             </div>
             
             {/* Empty State */}
             {data.observations && data.observations.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground bg-background rounded-md border border-dashed border-border/60">
                   <FileText className="h-6 w-6 mb-3 opacity-20" />
                   <p className="text-xs font-mono uppercase tracking-widest">No active research observations</p>
                </div>
             )}
             
             {/* Content Lists */}
             {data.observations && data.observations.length > 0 && (
               <div className="space-y-4 mt-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-foreground flex items-center gap-2 border-b border-border/50 pb-2">
                    <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                    Active Observations
                  </h3>
                  <div className="grid grid-cols-1 gap-5">
                     {data.observations.map(obs => <ObservationCard key={obs.id} obs={obs} />)}
                  </div>
               </div>
             )}

             {data.resonances && data.resonances.length > 0 && (
               <div className="space-y-4 mt-8 pt-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-foreground flex items-center gap-2 border-b border-border/50 pb-2">
                    <Network className="h-3.5 w-3.5 text-muted-foreground" />
                    Cross-Source Resonances
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                     {data.resonances.map(res => <ResonanceCard key={res.id} res={res} />)}
                  </div>
               </div>
             )}
           </div>
         )}
      </CardContent>
    </Card>
  );
}
