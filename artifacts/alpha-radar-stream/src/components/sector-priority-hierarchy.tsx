import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatNumber, formatTime } from '@/lib/utils';
import type { SectorPriorityCandidate, SectorPrioritySnapshot } from '@workspace/api-client-react';
import {
  Activity,
  Building2,
  CheckCircle2,
  CircleAlert,
  Layers,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';

interface SectorPriorityHierarchyProps {
  snapshot?: SectorPrioritySnapshot | null;
}

function stateTone(state: SectorPrioritySnapshot['state']) {
  if (state === 'ranked') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (state === 'insufficient') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-muted-foreground/30 bg-muted/50 text-muted-foreground';
}

function sectorEligibilityTone(eligibility: string) {
  if (eligibility === 'ranked') return 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/5';
  if (eligibility === 'insufficient') return 'text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/5';
  return 'text-muted-foreground border-border bg-muted/20';
}

function candidateStageTone(stage: string) {
  if (stage === 'candidate') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (stage === 'confirmed') return 'border-primary/40 bg-primary/10 text-primary';
  if (stage === 'breakout_critical') return 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300';
  if (stage === 'latent') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-muted-foreground/30 bg-muted/50 text-muted-foreground';
}

export function SectorPriorityHierarchy({ snapshot }: SectorPriorityHierarchyProps) {
  if (!snapshot) {
    return (
      <Card className="border-border" data-testid="sector-priority-hierarchy-loading">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            <Layers className="h-4 w-4 text-primary" />
            Sector-First Priority Hierarchy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <Activity className="h-8 w-8 mb-3 opacity-20 animate-pulse" />
            <p className="text-sm">Awaiting sector ranking stream...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const {
    state,
    coverage,
    sectors,
    finalCandidates,
    latentCandidates,
    withheldCandidates,
    reason,
    generatedAt,
  } = snapshot;

  return (
    <section className="space-y-6" aria-label="Sector Priority Hierarchy">
      <Card data-testid="sector-priority-hierarchy">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
                <Layers className="h-4 w-4 text-primary" />
                Sector-First Priority Hierarchy
              </CardTitle>
              <CardDescription className="mt-1">
                Alpha is weighted by sector strength before individual merits. Missing domain data prevents candidate promotion.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={cn('font-mono text-[10px] uppercase', stateTone(state))}
                data-testid="sector-hierarchy-state"
              >
                {state} hierarchy
              </Badge>
              <Badge
                variant="outline"
                className="font-mono text-[10px] border-border bg-muted/40 text-muted-foreground"
                data-testid="sector-hierarchy-time"
              >
                {formatTime(generatedAt)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Coverage Summary */}
          <div className="grid gap-3 sm:grid-cols-4">
            <CoverageMetric label="Eligible Live" value={formatNumber(coverage.eligibleLiveSymbols, 0)} />
            <CoverageMetric label="Classified" value={formatNumber(coverage.classifiedLiveSymbols, 0)} />
            <CoverageMetric label="Ranked Sectors" value={formatNumber(coverage.rankedSectorCount, 0)} emphasize />
            <CoverageMetric label="Req. Members/Sector" value={formatNumber(coverage.requiredConstituentsPerSector, 0)} />
          </div>

          {/* Coverage Notice */}
          <div className="rounded-md border border-dashed border-border bg-background/50 p-3">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Source:</span> {coverage.source}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="sector-eligible-live-population">
                  <span className="font-semibold text-foreground">Eligible live population:</span>{' '}
                  {coverage.eligibleLivePopulation.length > 0
                    ? coverage.eligibleLivePopulation.join(', ')
                    : 'None — no symbol has passed every live coverage gate.'}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="sector-coverage-reason">
                  {coverage.reason}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground mt-1" data-testid="sector-hierarchy-reason">
                  {reason}
                </p>
              </div>
            </div>
          </div>

          {/* Ranked Sectors */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" />
              Ranked Sectors
            </h3>
            
            {sectors && sectors.length > 0 ? (
              <div className="space-y-4">
                {sectors.map((sector) => (
                  <SectorRow key={`${sector.sector}-${sector.industryGroup}`} sector={sector} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
                No sectors meet minimum eligibility requirements.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Candidates Panel */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CandidatePanel
          title="Final Alpha Candidates"
          icon={<Target className="h-4 w-4 text-primary" />}
          candidates={finalCandidates}
          emptyText="No symbols have achieved final alpha candidate status."
        />
        <CandidatePanel
          title="潜伏候选（每个板块最多 5 只）"
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          candidates={latentCandidates}
          emptyText="No fresh sector-relative latent candidates currently meet the criteria."
        />
      </div>
      <CandidatePanel
        title="Promotion Withheld"
        icon={<XCircle className="h-4 w-4 text-muted-foreground" />}
        candidates={withheldCandidates}
        emptyText="No sector-ranked symbols are awaiting independent confirmation."
      />
    </section>
  );
}

function CoverageMetric({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col rounded-md border p-3",
      emphasize ? "border-primary/20 bg-primary/5" : "border-border/60 bg-muted/10"
    )}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <span className={cn("font-mono text-lg font-semibold", emphasize ? "text-primary" : "text-foreground")}>{value}</span>
    </div>
  );
}

function SectorRow({ sector }: { sector: SectorPrioritySnapshot['sectors'][number] }) {
  return (
    <div className={cn(
      "rounded-lg border p-4 transition-colors",
      sectorEligibilityTone(sector.eligibility)
    )} data-testid={`sector-row-${sector.sector}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold bg-background px-2 py-0.5 rounded border border-border/50 text-foreground">
              {sector.rank === null ? 'Rank withheld' : `Rank ${sector.rank}`}
            </span>
            <h4 className="font-medium text-sm text-foreground">{sector.sector ?? 'Classification withheld'}</h4>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {sector.industryGroup ?? 'Industry group unavailable'} · {sector.constituentCount}/{sector.requiredConstituentCount} required members
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn(
            "font-mono text-[10px]",
            sector.dataFresh ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10" : "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10"
          )}>
            {sector.dataFresh ? "data fresh" : "stale data"}
          </Badge>
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Strength</span>
            <span className="font-mono text-sm font-semibold text-foreground">{formatNumber(sector.strength, 2)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
        <EvidenceGate label="Momentum" value={sector.evidence.momentum} />
        <EvidenceGate label="Volume" value={sector.evidence.volumeIntensity} />
        <EvidenceGate label="Order Flow" value={sector.evidence.orderFlowPressure} />
        <EvidenceGate label="Rel. Strength" value={sector.evidence.relativeStrength} />
      </div>

      <div className="mt-3 grid lg:grid-cols-2 gap-3">
        <SourceGate label="Catalyst" available={sector.evidence.catalyst.available} reason={sector.evidence.catalyst.reason} />
        <SourceGate label="Options activity" available={sector.evidence.optionsActivity.available} reason={sector.evidence.optionsActivity.reason} />
      </div>

      {sector.members.length > 0 && (
        <div className="mt-4 border-t border-border/50 pt-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-3">Constituent Members</p>
          <div className="space-y-2">
            {sector.members.map((member) => (
              <div key={member.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/50 p-2 border border-border/40 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold w-12">{member.symbol}</span>
                  <Badge variant="outline" className={cn(
                    "text-[9px] uppercase font-mono px-1.5",
                    member.eligibility === 'ranked' ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" :
                    member.eligibility === 'building' ? "border-primary/30 text-primary" :
                    "border-muted-foreground/30 text-muted-foreground"
                  )}>
                    {member.eligibility}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">State: {member.marketDataState}</span>
                </div>
                <div className="flex items-center gap-4 font-mono text-[10px]">
                  <span className="flex flex-col items-end">
                    <span className="text-[8px] text-muted-foreground uppercase">Base</span>
                    {formatNumber(member.baseRankingScore, 2)}
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-[8px] text-muted-foreground uppercase">Multiplier</span>
                    {formatNumber(member.sectorMultiplier, 2)}x
                  </span>
                  <span className="flex flex-col items-end text-foreground font-semibold">
                    <span className="text-[8px] text-muted-foreground uppercase">Weighted</span>
                    {formatNumber(member.sectorWeightedScore, 2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground border-t border-border/40 pt-2">
        {sector.reason}
      </p>
    </div>
  );
}

function EvidenceGate({ label, value }: { label: string; value: number | null }) {
  const available = value !== null;
  return (
    <div className="flex items-center justify-between rounded border border-border/50 bg-background/50 p-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {available ? (
        <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
          {formatNumber(value, 0)}
          <CheckCircle2 className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/70">
          withheld
          <XCircle className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}

function SourceGate({ label, available, reason }: { label: string; available: boolean; reason: string }) {
  return (
    <div className="flex flex-col rounded border border-border/50 bg-background/50 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Badge variant="outline" className={cn(
          "font-mono text-[9px] uppercase px-1",
          available ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" :
          "border-destructive/30 text-destructive bg-destructive/5"
        )}>
          {available ? 'available' : 'unavailable'}
        </Badge>
      </div>
      <span className="text-[9px] text-muted-foreground leading-tight">{reason}</span>
    </div>
  );
}

function CandidatePanel({ 
  title, 
  icon, 
  candidates, 
  emptyText 
}: { 
  title: string; 
  icon: React.ReactNode; 
  candidates: SectorPriorityCandidate[];
  emptyText: string;
}) {
  return (
    <Card className="flex flex-col h-full border-primary/20">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {icon}
            {title}
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {candidates?.length || 0} symbols
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {candidates && candidates.length > 0 ? (
          <div className="divide-y divide-border/50">
            {candidates.map((cand) => (
              <div key={cand.symbol} className="p-4 hover:bg-muted/10 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-lg font-bold text-primary">{cand.symbol}</span>
                    <Badge variant="outline" className={cn("font-mono text-[9px] uppercase", candidateStageTone(cand.stage))}>
                      {cand.stage}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 font-mono text-[10px]">
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] text-muted-foreground uppercase">Final Rank</span>
                       <span className="font-bold text-foreground">{cand.finalRank === null ? 'Withheld' : `#${cand.finalRank}`}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] text-muted-foreground uppercase">Score</span>
                      <span className="font-bold text-foreground">{formatNumber(cand.finalScore, 2)}</span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground mb-3">
                   {cand.sector ?? 'Sector unavailable'} · {cand.industryGroup ?? 'Industry group unavailable'}
                </div>
                {(cand.stage === 'latent' || cand.stage === 'breakout_critical' || cand.stage === 'confirmed') && (
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                    <span>潜伏评分 <strong className="text-foreground">{formatNumber(cand.latentScore, 0)}</strong></span>
                    <span>临界评分 <strong className="text-foreground">{formatNumber(cand.breakoutCriticalScore, 0)}</strong></span>
                  </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mb-3">
                  <CandEvidence label="Mkt Fresh" passed={cand.evidence.marketFresh} />
                  <CandEvidence label="Sect. Strength" passed={cand.evidence.sectorStrength} />
                  <CandEvidence label="Unf. Exp." passed={cand.evidence.unfinishedExpansion} />
                  <CandEvidence label="Catalyst" passed={cand.evidence.catalyst} />
                  <CandEvidence label="Money Flow" passed={cand.evidence.moneyFlow} />
                  <CandEvidence label="Options" passed={cand.evidence.optionsActivity} />
                  <CandEvidence label="Fundam." passed={cand.evidence.fundamentals} />
                  <CandEvidence label="Valuation" passed={cand.evidence.valuationExpectation} />
                  <CandEvidence label="Risk/Rwd" passed={cand.evidence.riskReward} />
                </div>

                {cand.missing && cand.missing.length > 0 && (
                  <div className="rounded border border-destructive/20 bg-destructive/5 p-2 mb-2">
                    <p className="text-[9px] uppercase font-semibold text-destructive mb-1">Missing Evidence</p>
                    <p className="text-[10px] text-destructive/80 leading-relaxed">
                      {cand.missing.join(" · ")}
                    </p>
                  </div>
                )}
                
                <p className="text-[10px] leading-relaxed text-muted-foreground mt-2 border-t border-border/30 pt-2">
                  {cand.reason}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center p-8 text-center text-sm text-muted-foreground h-full min-h-[200px]">
            {emptyText}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CandEvidence({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-1.5 rounded text-center border",
      passed ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : "border-border/40 bg-muted/20 text-muted-foreground/60"
    )}>
      <span className="text-[8px] uppercase tracking-tighter mb-0.5 leading-tight">{label}</span>
      {passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3 opacity-40" />}
    </div>
  );
}
