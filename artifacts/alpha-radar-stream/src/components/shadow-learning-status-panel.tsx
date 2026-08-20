import {
  getGetShadowLearningValidationQueryKey,
  GetShadowLearningValidationHorizonDays,
  useGetShadowLearningValidation,
} from '@workspace/api-client-react';
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  Clock3,
  FileLock2,
  ShieldAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber, formatPercent } from '@/lib/utils';

function Metric({
  label,
  baseline,
  shadow,
  unavailable,
  unit = 'percent',
}: {
  label: string;
  baseline: number | null;
  shadow: number | null;
  unavailable: boolean;
  unit?: 'percent' | 'minutes';
}) {
  const value = (input: number | null) => unavailable || input === null
    ? '—'
    : unit === 'minutes'
      ? `${formatNumber(input, 1)}m`
      : formatPercent(input);
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
        <div>
          <div className="text-[9px] text-muted-foreground">Base</div>
          <div>{value(baseline)}</div>
        </div>
        <div className="border-l border-border/50 pl-2">
          <div className="text-[9px] text-muted-foreground">Shadow</div>
          <div className="text-primary">{value(shadow)}</div>
        </div>
      </div>
    </div>
  );
}

export function ShadowLearningStatusPanel() {
  const params = { horizonDays: GetShadowLearningValidationHorizonDays.NUMBER_5 };
  const { data, isLoading, isError } = useGetShadowLearningValidation(params, {
    query: {
      queryKey: getGetShadowLearningValidationQueryKey(params),
      refetchInterval: 30000,
    },
  });

  if (isLoading && !data) {
    return (
      <Card className="animate-pulse border-dashed" data-testid="shadow-learning-panel">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
            <Beaker className="h-4 w-4" /> Loading Shadow Learning
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-destructive/30 bg-destructive/5" data-testid="shadow-learning-panel">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-destructive">
            <ShieldAlert className="h-4 w-4" /> Shadow Learning Unavailable
          </CardTitle>
          <CardDescription>Server-owned shadow validation could not be retrieved. Live scoring is unaffected.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const unavailable = data.persistenceState === 'unavailable';
  const insufficient = data.promotion.status === 'insufficient_sample';
  const candidate = data.promotion.status === 'candidate';
  const statusClass = candidate
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
    : unavailable
      ? 'border-destructive/40 text-destructive'
      : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400';

  return (
    <Card className="border-border/80 shadow-sm" data-testid="shadow-learning-panel">
      <CardHeader className="border-b border-border/40 bg-muted/10 pb-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <Beaker className="h-4 w-4 text-primary" />
              Shadow Learning Validation
            </CardTitle>
            <CardDescription className="mt-1.5 max-w-[580px] text-xs leading-relaxed">
              Observational strategy comparison only. Shadow results cannot change live scoring, alert routing, focused symbols, freshness gates, or scan cadence.
            </CardDescription>
          </div>
          <Badge variant="outline" className={`w-fit text-[10px] font-mono uppercase tracking-wider ${statusClass}`}>
            {candidate ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <FileLock2 className="mr-1 h-3 w-3" />}
            {data.promotion.status.replaceAll('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-3 text-xs md:grid-cols-3">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Strategy version</div>
            <div className="mt-1 break-all font-mono text-foreground">{data.strategy?.strategyVersion ?? 'Awaiting eligible shadow trigger'}</div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Clock3 className="h-3 w-3" /> Window: {data.strategy?.scanWindow ?? '—'} · Model: {data.strategy?.modelVersion ?? '—'}
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Completed 5D sample</div>
            <div className="mt-1 font-mono text-lg">
              {formatNumber(data.baseline.sampleSize, 0)} <span className="text-muted-foreground">base</span>
              <span className="mx-1 text-muted-foreground">/</span>
              {formatNumber(data.shadow.sampleSize, 0)} <span className="text-muted-foreground">shadow</span>
            </div>
            <div className="text-[10px] text-muted-foreground">Minimum: {data.promotion.rules.minimumCompleteSample} complete per cohort</div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Evidence state</div>
            <div className="mt-1 font-medium">{data.promotion.evidenceState === 'complete' ? 'Immutable archive complete' : 'Withheld'}</div>
            <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{data.reason}</div>
          </div>
        </div>

        {(unavailable || insufficient) && (
          <div className="flex gap-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold uppercase tracking-wider">Promotion withheld</div>
              <div className="mt-1 leading-relaxed">{data.promotion.reason}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Hit rate" baseline={data.baseline.hitRatePercent} shadow={data.shadow.hitRatePercent} unavailable={unavailable || insufficient} />
          <Metric label="Favorable avg. return" baseline={data.baseline.averageReturnPercent} shadow={data.shadow.averageReturnPercent} unavailable={unavailable || insufficient} />
          <Metric label="Max drawdown" baseline={data.baseline.maximumDrawdownPercent} shadow={data.shadow.maximumDrawdownPercent} unavailable={unavailable || insufficient} />
          <Metric label="False positive rate" baseline={data.baseline.falsePositiveRatePercent} shadow={data.shadow.falsePositiveRatePercent} unavailable={unavailable || insufficient} />
          <Metric label="Lead time" baseline={data.baseline.averageLeadTimeMinutes} shadow={data.shadow.averageLeadTimeMinutes} unavailable={unavailable || insufficient} unit="minutes" />
        </div>

        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider text-foreground">Promotion gate: </span>
          {data.promotion.rules.independentSplit} Requires +{formatPercent(data.promotion.rules.requiredHitRateAdvantagePercent)} hit rate and +{formatPercent(data.promotion.rules.requiredReturnAdvantagePercent)} favorable return on holdout, without worse drawdown. Candidate is manual review only.
        </div>
      </CardContent>
    </Card>
  );
}