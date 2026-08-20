import { Activity, AlertTriangle, BarChart3, Clock3, Gauge, Waves, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatAge, formatNumber, formatTime } from '@/lib/utils';
import type { AlphaRadarSnapshot, ProtectedScanHealth, RadarSignalMetric } from '@workspace/api-client-react';

type RadarSignalPanelProps = {
  alphaRadar: AlphaRadarSnapshot | undefined;
  scanHealth?: ProtectedScanHealth;
};

const qualityStyles = {
  good: 'bg-primary/10 text-primary border-primary/20',
  degraded: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400',
  stale: 'bg-destructive/10 text-destructive border-destructive/20',
  missing: 'bg-muted text-muted-foreground border-border',
} as const;

const freshnessStyles = {
  fresh: 'text-primary',
  delayed: 'text-amber-600 dark:text-amber-400',
  stale: 'text-destructive',
  missing: 'text-muted-foreground',
} as const;

export function RadarSignalPanel({ alphaRadar, scanHealth }: RadarSignalPanelProps) {
  if (!alphaRadar) {
    return null;
  }
  const scoreAvailable = alphaRadar.scoreState === 'available' && alphaRadar.score !== null;
  const unusualActivityIsLive = scoreAvailable && alphaRadar.unusualActivity.detected;
  const diagnostics = alphaRadar.diagnostics;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <Gauge className="h-4 w-4 text-primary" />
              Alpha Radar Activity
            </CardTitle>
            <CardDescription className="mt-1">
              Explainable live market-activity summary — not a forecast or trading instruction.
            </CardDescription>
          </div>
          <Badge className={cn('shrink-0 border font-mono text-[10px] uppercase tracking-wider', statusStyle(alphaRadar.status, alphaRadar.scoreState))}>
            {alphaRadar.status ?? scoreStateLabel(alphaRadar.scoreState)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-[auto_1fr] gap-4 rounded-lg bg-muted/50 p-4">
          <div className={cn(
            'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 bg-background font-mono',
            scoreAvailable ? 'border-primary/25' : alphaRadar.scoreState === 'stale' ? 'border-destructive/25' : 'border-border',
          )}>
            <span className="text-2xl font-bold">{alphaRadar.score === null ? '—' : Math.round(alphaRadar.score)}</span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {scoreAvailable ? '/ 100' : alphaRadar.scoreState === 'stale' ? 'Data stale' : 'Collecting'}
            </span>
          </div>
          <div className="min-w-0 self-center">
            <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-wider text-muted-foreground">
              <span>Data confidence</span>
              <span className="font-mono text-foreground">{alphaRadar.confidence}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
              <div
                className={cn('h-full rounded-full transition-all', alphaRadar.confidence >= 65 ? 'bg-primary' : alphaRadar.confidence >= 35 ? 'bg-amber-500' : 'bg-muted-foreground')}
                style={{ width: `${alphaRadar.confidence}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('border px-2 py-0.5 font-mono text-[10px] uppercase', qualityStyles[alphaRadar.dataQuality])}>
                {alphaRadar.dataQuality} data
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                Updated {formatTime(alphaRadar.generatedAt)} · {formatAge(alphaRadar.generatedAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-card p-3" data-testid="alpha-radar-diagnostics">
          <div className="mb-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Scoring window diagnostics</span>
            <span className="font-mono text-foreground" data-testid="text-scoring-gate-reason">
              {formatGateReason(diagnostics.scoring_gate_reason)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-5">
            <DiagnosticValue label="fresh_quotes" value={diagnostics.fresh_quotes} />
            <DiagnosticValue label="fresh_trades" value={diagnostics.fresh_trades} />
            <DiagnosticValue label="fresh_prices" value={diagnostics.fresh_prices} />
            <DiagnosticValue label="fresh_volume" value={diagnostics.fresh_volume} />
            <DiagnosticValue
              label="valid_window_age"
              value={
                diagnostics.valid_window_age === null
                  ? '—'
                  : `${formatNumber(diagnostics.valid_window_age, 1)}s`
              }
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2" data-testid="alpha-radar-scan-state">
          <div className="rounded-lg border border-border/70 bg-card p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5 text-primary" />
              Adaptive scan
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold text-foreground">
                  {formatTime(scanHealth?.lastScanAt ?? alphaRadar.scan.lastScannedAt)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {scanModeLabel(scanHealth?.scanMode ?? alphaRadar.scan.scanMode)} · every {formatScanInterval(scanHealth?.scanIntervalMs ?? alphaRadar.scan.scanIntervalMs)}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'border font-mono text-[9px] uppercase tracking-wide',
                  scanHealth?.schedulerState === 'scheduled'
                    ? 'border-primary/35 bg-primary/10 text-primary'
                    : scanHealth?.schedulerState === 'delayed'
                      ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : alphaRadar.scan.eventTriggered
                    ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border text-muted-foreground',
                )}
              >
                {scanHealth
                  ? `${scanHealth.schedulerState} scheduler`
                  : alphaRadar.scan.eventTriggered ? 'event scan' : 'scheduled'}
              </Badge>
            </div>
            <p className="mt-3 border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
              {scanHealth?.reason ?? formatGateReason(alphaRadar.scan.triggerReason)}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-card p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Alpha velocity
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 font-mono">
              <VelocityValue label="30s change" value={alphaRadar.alphaVelocity.delta30s} suffix=" pts" />
              <VelocityValue label="60s change" value={alphaRadar.alphaVelocity.delta60s} suffix=" pts" />
              <VelocityValue label="30s speed" value={alphaRadar.alphaVelocity.rate30s} suffix=" pts/min" />
              <VelocityValue label="60s speed" value={alphaRadar.alphaVelocity.rate60s} suffix=" pts/min" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Component change speed
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ChangeIndicator label="Momentum acceleration" value={alphaRadar.changeIndicators.momentumAcceleration} />
            <ChangeIndicator label="Volume acceleration" value={alphaRadar.changeIndicators.volumeAcceleration} />
            <ChangeIndicator label="Order-flow shift" value={alphaRadar.changeIndicators.orderFlowShift} />
            <ChangeIndicator label="Spread tightening" value={alphaRadar.changeIndicators.spreadTightening} />
          </div>
        </div>

        <PreBreakoutDetectionCard alphaRadar={alphaRadar} />

        <div className="grid gap-3 sm:grid-cols-2">
          <SignalMetricCard icon={<Activity className="h-4 w-4" />} label="Price momentum" metric={alphaRadar.momentum} />
          <SignalMetricCard icon={<Waves className="h-4 w-4" />} label="Bid / ask spread" metric={alphaRadar.spread} invertScore />
          <SignalMetricCard icon={<BarChart3 className="h-4 w-4" />} label="Volume intensity" metric={alphaRadar.volumeIntensity} />
          <SignalMetricCard icon={<Gauge className="h-4 w-4" />} label="Order-flow pressure" metric={alphaRadar.orderFlowPressure} />
          <SignalMetricCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Unusual activity"
            metric={alphaRadar.unusualActivity}
            emphasis={unusualActivityIsLive ? 'attention' : 'normal'}
            valuePrefix={scoreAvailable ? unusualActivityIsLive ? 'Elevated · ' : 'Normal · ' : ''}
          />
        </div>

        {alphaRadar.warnings.length > 0 ? (
          <div className="space-y-2">
            {alphaRadar.warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DiagnosticValue({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 sm:flex-col sm:items-start">
      <span className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function formatGateReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function scanModeLabel(mode: AlphaRadarSnapshot['scan']['scanMode']): string {
  if (mode === 'pre_open') return 'Pre-open focus';
  if (mode === 'opening') return 'Opening focus';
  return 'Normal cadence';
}

function formatScanInterval(milliseconds: number): string {
  return `${formatNumber(milliseconds / 1000, milliseconds % 1000 === 0 ? 0 : 1)}s`;
}

function VelocityValue({ label, value, suffix }: { label: string; value: number | null; suffix: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xs font-semibold', value !== null && value > 0 ? 'text-primary' : value !== null && value < 0 ? 'text-destructive' : 'text-foreground')}>
        {formatSignedValue(value, suffix)}
      </p>
    </div>
  );
}

function ChangeIndicator({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/60 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-mono text-sm font-semibold', value !== null && value > 0 ? 'text-primary' : value !== null && value < 0 ? 'text-destructive' : 'text-foreground')}>
        {formatSignedValue(value, ' pts/min')}
      </p>
    </div>
  );
}

function formatSignedValue(value: number | null, suffix: string): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${formatNumber(value, 1)}${suffix}`;
}

function PreBreakoutDetectionCard({ alphaRadar }: { alphaRadar: AlphaRadarSnapshot }) {
  const detection = alphaRadar.preBreakout;
  const confirmation = detection.confirmation;
  return (
    <div className="rounded-lg border border-border/70 bg-card p-3" data-testid="pre-breakout-detection">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Pre-Breakout Detection
        </div>
        <Badge className={cn('border font-mono text-[9px] uppercase tracking-wide', preBreakoutStateStyle(detection.state))}>
          {preBreakoutStateLabel(detection.state)}
        </Badge>
      </div>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
        <DetectionValue label="Independent evidence" value={`${detection.evidenceCount} signals`} />
        <DetectionValue label="Velocity gate" value={detection.velocityGateSatisfied ? 'Positive / met' : 'Not met'} />
        <DetectionValue label="Data window" value={detection.dataFresh ? 'Fresh / eligible' : 'Unavailable'} />
        <DetectionValue label="Last transition" value={formatTime(detection.lastTransitionAt)} />
      </div>
      {detection.transitionReasons.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-2">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Latest transition · {detection.transitionEvidenceCount} independent signals
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detection.transitionReasons.map((reason) => (
              <Badge key={`transition-${reason}`} variant="outline" className="border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-700 dark:text-amber-300">
                {reason}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {detection.reasons.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-2">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Current confirming evidence</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detection.reasons.map((reason) => (
              <Badge key={reason} variant="outline" className="border-primary/30 bg-primary/5 text-[10px] text-primary">
                {reason}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {detection.deteriorationReasons.length > 0 ? (
        <p className="mt-3 border-t border-destructive/20 pt-2 text-[11px] leading-relaxed text-destructive">
          {detection.deteriorationReasons.join(' · ')}
        </p>
      ) : null}
      {detection.cooldownRemainingMs !== null ? (
        <p className="mt-3 text-[10px] text-muted-foreground">
          Cooldown active · {formatNumber(detection.cooldownRemainingMs / 1000, 1)}s before a downgrade can be confirmed.
        </p>
      ) : null}
      <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3" data-testid="confirmation-gate">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Multi-factor confirmation</p>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground">{confirmation.reason}</p>
          </div>
          <Badge className={cn('border font-mono text-[9px] uppercase tracking-wide', confirmationStatusStyle(confirmation.status))}>
            {confirmation.status}
          </Badge>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-2 font-mono text-[10px]">
          <span className="text-muted-foreground">Persistent observations</span>
          <span className="font-semibold text-foreground" data-testid="text-confirmation-persistence">
            {confirmation.persistenceScans} / {confirmation.requiredPersistenceScans}
          </span>
        </div>
        {confirmation.evidence.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="confirmation-evidence">
            {confirmation.evidence.map((evidence) => (
              <div
                key={evidence.key}
                className={cn(
                  'rounded border px-2.5 py-2',
                  evidence.satisfied
                    ? 'border-primary/25 bg-primary/5'
                    : 'border-amber-500/25 bg-amber-500/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-foreground">{evidence.label}</span>
                  <span className={cn('font-mono text-[9px] uppercase', evidence.satisfied ? 'text-primary' : 'text-amber-700 dark:text-amber-300')}>
                    {evidence.satisfied ? 'met' : 'missing'}
                  </span>
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">{evidence.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
            Evidence checks resume only after a complete, fresh live window is available.
          </p>
        )}
      </div>
      {detection.state === 'unavailable' ? (
        <p className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          Detection is unavailable until the current live window is complete, fresh, and score-eligible. Historical observations cannot create a state.
        </p>
      ) : null}
      {alphaRadar.preBreakoutWatch ? (
        <p className="mt-3 border-t border-amber-500/20 pt-2 text-[11px] leading-relaxed text-muted-foreground" data-testid="status-pre-breakout-watch">
          The state uses multiple fresh, independent signals and confirmation scans. It is a factual monitoring state, not a buy or trading instruction.
        </p>
      ) : null}
    </div>
  );
}

function preBreakoutStateLabel(state: AlphaRadarSnapshot['preBreakout']['state']): string {
  return state.replaceAll('_', ' ');
}

function preBreakoutStateStyle(state: AlphaRadarSnapshot['preBreakout']['state']): string {
  if (state === 'confirmed') return 'border-primary/50 bg-primary/15 text-primary';
  if (state === 'pre_breakout') return 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (state === 'accelerating') return 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  if (state === 'watch') return 'border-border bg-muted text-muted-foreground';
  return 'border-border text-muted-foreground';
}

function confirmationStatusStyle(status: AlphaRadarSnapshot['preBreakout']['confirmation']['status']): string {
  if (status === 'confirmed') return 'border-primary/50 bg-primary/15 text-primary';
  if (status === 'pending') return 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'rejected') return 'border-destructive/35 bg-destructive/10 text-destructive';
  return 'border-border bg-muted text-muted-foreground';
}

function DetectionValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-[11px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SignalMetricCard({
  icon,
  label,
  metric,
  emphasis = 'normal',
  valuePrefix = '',
}: {
  icon: React.ReactNode;
  label: string;
  metric: RadarSignalMetric;
  invertScore?: boolean;
  emphasis?: 'normal' | 'attention';
  valuePrefix?: string;
}) {
  const metricScore =
    metric.scoreEligible && metric.score !== null
      ? `${Math.round(metric.score)}/100`
      : metric.observedAt && metric.freshness !== 'fresh'
        ? 'Historical'
        : metric.observedAt
          ? 'Not scored'
          : 'Collecting';
  return (
    <div className={cn(
      'rounded-md border p-3',
      emphasis === 'attention' ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/70 bg-card',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={cn('shrink-0', emphasis === 'attention' ? 'text-amber-600 dark:text-amber-400' : 'text-primary')}>{icon}</span>
          <span>{label}</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{metricScore}</span>
      </div>
      <div className="mt-3 font-mono text-lg font-semibold tracking-tight">
        {valuePrefix}{formatMetricValue(metric)}
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{metric.source}</div>
      <div className="mt-3 flex items-end justify-between gap-2 border-t border-border/60 pt-2 font-mono text-[10px]">
        <span className={freshnessStyles[metric.freshness]}>
          {metric.freshness === 'missing'
            ? 'No live input'
            : !metric.scoreEligible && metric.freshness !== 'fresh'
              ? `Historical · ${metric.freshness} · ${formatAge(metric.observedAt)}`
              : `${metric.freshness} · ${formatAge(metric.observedAt)}`}
        </span>
        <span className="text-right text-muted-foreground">
          {metric.referenceValue === null ? formatTime(metric.observedAt) : `${metric.referenceLabel}: ${formatReference(metric)}`}
        </span>
      </div>
    </div>
  );
}

function formatMetricValue(metric: RadarSignalMetric): string {
  if (metric.value === null) return '—';
  if (metric.unit === '%') return `${metric.value >= 0 ? '+' : ''}${formatNumber(metric.value, 3)}%`;
  if (metric.unit === '% net' || metric.unit === '% depth') return `${metric.value >= 0 ? '+' : ''}${formatNumber(metric.value, 1)}${metric.unit === '% net' ? '% net' : '% depth'}`;
  if (metric.unit === 'bps') return `${formatNumber(metric.value, 1)} bps`;
  if (metric.unit === 'x baseline') return `${formatNumber(metric.value, 2)}×`;
  return `${formatNumber(metric.value)} ${metric.unit}`;
}

function formatReference(metric: RadarSignalMetric): string {
  if (metric.referenceValue === null) return '—';
  if (metric.referenceLabel?.includes('volume')) return formatNumber(metric.referenceValue, 0);
  if (metric.referenceLabel === 'absolute spread') return formatNumber(metric.referenceValue, 4);
  return formatNumber(metric.referenceValue, 2);
}

function scoreStateLabel(scoreState: AlphaRadarSnapshot['scoreState']): string {
  return scoreState === 'stale' ? 'Data Stale' : 'Insufficient Data';
}

function statusStyle(
  status: AlphaRadarSnapshot['status'],
  scoreState: AlphaRadarSnapshot['scoreState'],
): string {
  if (scoreState === 'stale') {
    return 'border-destructive/30 bg-destructive/10 text-destructive';
  }
  if (scoreState === 'insufficient') {
    return 'border-border bg-muted text-muted-foreground';
  }
  switch (status) {
    case 'Breakout Setup':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'Watch':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'Neutral':
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}