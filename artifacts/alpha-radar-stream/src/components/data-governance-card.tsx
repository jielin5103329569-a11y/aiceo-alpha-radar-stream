import type { DataGovernanceSnapshot } from '@workspace/api-client-react';
import { Database, FileCheck2, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTime } from '@/lib/utils';

const layerLabel: Record<string, string> = {
  raw_market: 'Raw market',
  basic_features: 'Features',
  market_structure: 'Structure',
  stage_state: 'Stage state',
  final_decision: 'Decision',
};

function stateClass(state: string) {
  return state === 'available'
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    : state === 'withheld'
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
      : 'border-destructive/40 bg-destructive/5 text-destructive';
}

export function DataGovernanceCard({ governance }: { governance: DataGovernanceSnapshot | undefined }) {
  if (!governance) {
    return (
      <Card className="border-dashed" data-testid="data-governance-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
            <Database className="h-4 w-4" /> Governed data path
          </CardTitle>
          <CardDescription>Awaiting the server-owned audit projection.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/80 shadow-sm" data-testid="data-governance-card">
      <CardHeader className="border-b border-border/40 bg-muted/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <FileCheck2 className="h-4 w-4 text-primary" /> Governed data path
            </CardTitle>
            <CardDescription className="mt-1.5 text-xs">
              Read-only evidence flow. This view cannot change scoring, alert eligibility, or scan cadence.
            </CardDescription>
          </div>
          <Badge variant="outline" className={`font-mono text-[10px] uppercase ${stateClass(governance.decision.state)}`}>
            {governance.decision.state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-2 sm:grid-cols-5">
          {governance.layers.map((layer) => (
            <div key={layer.id} className="rounded-md border border-border/60 bg-muted/10 p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{layerLabel[layer.id]}</div>
              <Badge variant="outline" className={`mt-2 text-[9px] uppercase ${stateClass(layer.state)}`}>
                {layer.state}
              </Badge>
              <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{layer.reason}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {governance.stages.map((stage) => (
            <div key={stage.id} className="rounded-md border border-border/60 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{stage.id.replaceAll('_', ' ')}</span>
                <Badge variant="outline" className={`text-[9px] ${stateClass(stage.state)}`}>{stage.state}</Badge>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">{stage.productionState}</p>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border/70 bg-muted/10 p-2.5 text-[10px] text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p>{governance.decision.reason}</p>
            <p className="mt-1 font-mono">Audit {governance.auditHash.slice(0, 16)}… · {formatTime(governance.generatedAt)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}