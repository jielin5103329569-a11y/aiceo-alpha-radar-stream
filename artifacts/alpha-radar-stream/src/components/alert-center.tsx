/**
 * AlertCenter – Task #18 – Verified Alpha Alert Surface
 *
 * VERIFICATION / ALERT ONLY – NOT A TRADING INSTRUCTION.
 * This component never claims browser push is enabled unless the
 * `browserPushEnabled` prop is explicitly `true`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  Eye,
  FlaskConical,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn, formatAge, formatNumber, formatTime } from '@/lib/utils';
import type {
  AlphaRadarSignalHistoryEntry,
  PreBreakoutDetectionState,
  PreBreakoutConfirmationStatus,
} from '@workspace/api-client-react';
import {
  getNotificationSupportStatus,
  requestNotificationPermission,
  type NotificationSupportStatus,
} from '@/lib/browser-notifications';

// ─── Prop-level types ────────────────────────────────────────────────────────

/**
 * A single persisted alert record surfaced from the server.
 * Derived from AlphaRadarSignalHistoryEntry with UI-layer additions.
 */
export interface AlertRecord {
  /** Stable client-side identifier (e.g. ISO timestamp + symbol) */
  id: string;
  /** ISO timestamp the event occurred at */
  occurredAt: string;
  /** Symbol this alert pertains to (e.g. "NVDA") */
  symbol: string;
  /** Human-readable tier label */
  tier: 'confirmed' | 'breakout_critical' | 'latent' | 'take_profit_watch' | 'trend_reversal_confirmed' | 'watch' | 'unavailable';
  /** Score at time of alert (0-100 or null) */
  score: number | null;
  /** Confidence percentage 0-100 */
  confidence: number;
  /** Alpha velocity value if available */
  alphaVelocity: number | null;
  /** Trusted sector classification captured with the alert, if available. */
  sector: string | null;
  /** Trusted industry classification captured with the alert, if available. */
  industry: string | null;
  /** Optional server-owned ranking of fresh, eligible leaders in this alert's sector. */
  sectorLeaderContext: {
    sector: string;
    leaders: Array<{
      rank: number;
      symbol: string;
      grade: 'confirmed' | 'critical' | 'latent' | 'watch';
    }>;
    strongestBreakoutSymbol: string | null;
  } | null;
  /** Evidence items that were satisfied */
  satisfiedEvidence: string[];
  /** Evidence items that were missing */
  missingEvidence: string[];
  /** Whether the underlying data was fresh when alert fired */
  dataFresh: boolean;
  /** Human-readable reason string from the server */
  reason: string;
  /** Count of evidence satisfied at time of alert */
  evidenceCount: number;
  /** Whether the user has read/acknowledged this alert */
  isRead: boolean;
  /** Whether the user has explicitly acknowledged this alert */
  isAcknowledged: boolean;
  /** Originating detection state transition */
  fromState: PreBreakoutDetectionState;
  toState: PreBreakoutDetectionState;
  /** Confirmation status transition */
  fromConfirmationStatus: PreBreakoutConfirmationStatus;
  toConfirmationStatus: PreBreakoutConfirmationStatus;
}

type NotificationMinimumTier = 'confirmed' | 'breakout_critical' | 'latent' | 'watch';

/**
 * Notification settings persisted server-side (or local-only as fallback).
 */
export interface AlertNotificationSettings {
  /** Whether the user wants browser notifications for new alerts */
  browserNotificationsEnabled: boolean;
  /** Minimum tier to trigger a notification */
  minimumTier: NotificationMinimumTier;
  /** Whether to notify on "watch" tier specifically */
  notifyOnWatch: boolean;
}

/**
 * Mutation-like interface the parent passes in.
 * The component calls these; it doesn't wire API calls directly.
 */
export interface AlertCenterMutations {
  /** Mark a single alert as read */
  markRead: (alertId: string) => void;
  /** Acknowledge a single alert */
  acknowledge: (alertId: string) => void;
  /** Mark all alerts as read */
  markAllRead: () => void;
  /** Toggle browser notifications (save to server/localStorage) */
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  /** Update minimum tier setting */
  setMinimumTier: (tier: NotificationMinimumTier) => Promise<void>;
  /** Request a server-audited test Push. false means it was not delivered. */
  sendTestNotification: () => Promise<boolean>;
}

export interface AlertCenterProps {
  /** Alert history records from the server */
  alerts: AlertRecord[];
  /** Current notification settings */
  settings: AlertNotificationSettings;
  /** Loading state – true while initial data is being fetched */
  isLoading: boolean;
  /** Background refetch state after an alert action or interval refresh */
  isRefreshing: boolean;
  /** True if there was a fetch error */
  isError: boolean;
  /** The latest account action error, if an alert mutation could not complete */
  actionError?: string | null;
  /**
   * Whether browser push permission is actually granted.
   * The component NEVER claims push is enabled unless this is explicitly true.
   */
  browserPushEnabled: boolean;
  /** Mutation callbacks */
  mutations: AlertCenterMutations;
  /** Optional class for outer wrapper */
  className?: string;
}

// ─── Tier helpers ─────────────────────────────────────────────────────────────

const TIER_ORDER: AlertRecord['tier'][] = [
  'trend_reversal_confirmed',
  'take_profit_watch',
  'confirmed',
  'breakout_critical',
  'latent',
  'watch',
  'unavailable',
];
const NOTIFICATION_TIER_ORDER: NotificationMinimumTier[] = [
  'confirmed',
  'breakout_critical',
  'latent',
  'watch',
];

function tierLabel(tier: AlertRecord['tier']): string {
  switch (tier) {
    case 'trend_reversal_confirmed': return '🔴 趋势反转/止盈确认';
    case 'take_profit_watch': return '⚠️ 止盈/减仓关注';
    case 'confirmed':     return '🔥 最强爆发';
    case 'breakout_critical': return '🟠 爆发临界';
    case 'latent':        return '🟡 潜伏候选';
    case 'watch':         return 'Watch';
    default:              return 'Unavailable';
  }
}

function tierStyle(tier: AlertRecord['tier']): string {
  switch (tier) {
    case 'trend_reversal_confirmed':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'take_profit_watch':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'confirmed':
      return 'border-primary/30 bg-primary/10 text-primary';
    case 'breakout_critical':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    case 'latent':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'watch':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function freshnessStyle(fresh: boolean): string {
  return fresh
    ? 'text-primary'
    : 'text-amber-600 dark:text-amber-400';
}

// ─── Notification status helpers ──────────────────────────────────────────────

function notifStatusLabel(status: NotificationSupportStatus): string {
  switch (status) {
    case 'granted':           return 'Permission granted';
    case 'blocked':           return 'Permission blocked by browser';
    case 'ios-pwa-required':  return 'Add to Home Screen required (iOS)';
    case 'unsupported':       return 'Not supported in this browser';
    default:                  return 'Permission not yet requested';
  }
}

function notifStatusIcon(status: NotificationSupportStatus): React.ReactNode {
  switch (status) {
    case 'granted':          return <CheckCircle2 className="h-4 w-4 text-primary" />;
    case 'blocked':          return <BellOff className="h-4 w-4 text-destructive" />;
    case 'ios-pwa-required': return <Smartphone className="h-4 w-4 text-amber-600" />;
    case 'unsupported':      return <WifiOff className="h-4 w-4 text-muted-foreground" />;
    default:                 return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-dashed border-border bg-muted/40 px-4 py-3">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Verification Only —</span>{' '}
        These alerts report observed market-activity patterns detected by the Alpha Radar
        scoring engine. They are{' '}
        <span className="font-semibold">not trading instructions</span>, forecasts, or
        recommendations to buy, sell, or hold any security.
      </p>
    </div>
  );
}

interface AlertRowProps {
  alert: AlertRecord;
  onRead: (id: string) => void;
  onAcknowledge: (id: string) => void;
}

function AlertRow({ alert, onRead, onAcknowledge }: AlertRowProps) {
  const isHighTier = alert.tier === 'confirmed' || alert.tier === 'breakout_critical';

  return (
    <div
      className={cn(
        'relative rounded-lg border bg-card p-4 transition-colors',
        !alert.isRead
          ? 'border-primary/25 shadow-sm'
          : 'border-border/60',
      )}
      data-testid={`alert-row-${alert.id}`}
    >
      {/* Unread dot */}
      {!alert.isRead && (
        <span
          aria-label="Unread"
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary"
        />
      )}

      {/* Header row */}
      <div className="flex flex-wrap items-start gap-2">
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 border font-mono text-[10px] uppercase tracking-wide',
            tierStyle(alert.tier),
          )}
        >
          {tierLabel(alert.tier)}
        </Badge>

        <span className="font-mono text-sm font-semibold leading-tight">{alert.symbol}</span>

        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {formatTime(alert.occurredAt)} · {formatAge(alert.occurredAt)}
        </span>
      </div>

      {/* Score + confidence row */}
      <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Score</span>
          <span className={cn('font-bold', isHighTier ? 'text-primary' : 'text-foreground')}>
            {alert.score !== null ? Math.round(alert.score) : '—'}
          </span>
          <span className="text-muted-foreground">/100</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Conf</span>
          <span>{alert.confidence}%</span>
        </div>
        {alert.alphaVelocity !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">αVelocity</span>
            <span className={alert.alphaVelocity >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
              {alert.alphaVelocity >= 0 ? '+' : ''}{formatNumber(alert.alphaVelocity, 2)}
            </span>
          </div>
        )}
        <span className={cn('text-[10px]', freshnessStyle(alert.dataFresh))}>
          {alert.dataFresh ? 'fresh data' : 'stale data'}
        </span>
      </div>

      {/* Reason */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{alert.reason}</p>

      {(alert.sector || alert.industry) && (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`alert-classification-${alert.id}`}>
          {alert.sector ?? "—"}{alert.industry ? ` / ${alert.industry}` : ""}
        </p>
      )}

      {alert.sectorLeaderContext && (
        <div className="mt-2 rounded-md border border-primary/15 bg-primary/[0.03] px-2.5 py-2" data-testid={`alert-sector-leaders-${alert.id}`}>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-semibold text-foreground">{alert.sectorLeaderContext.sector} Top {alert.sectorLeaderContext.leaders.length}</span>
            {alert.sectorLeaderContext.leaders.map((leader) => {
              const label = alert.sectorLeaderContext?.strongestBreakoutSymbol === leader.symbol
                ? '🔥 最强爆发'
                : leader.grade === 'critical'
                  ? '🟠 爆发临界'
                  : leader.grade === 'latent'
                    ? '🟡 潜伏候选'
                    : '观察';
              return (
                <Badge
                  key={leader.symbol}
                  variant="outline"
                  className={cn(
                    'border font-mono text-[9px]',
                    alert.sectorLeaderContext?.strongestBreakoutSymbol === leader.symbol
                      ? 'border-primary/35 bg-primary/10 text-primary'
                      : leader.grade === 'critical'
                        ? 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400'
                        : leader.grade === 'latent'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          : 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  #{leader.rank} {leader.symbol} · {label}
                </Badge>
              );
            })}
          </div>
          {alert.sectorLeaderContext.strongestBreakoutSymbol === null && (
            <p className="mt-1 text-[10px] text-muted-foreground">最强爆发：暂无确认</p>
          )}
        </div>
      )}

      {/* Evidence */}
      {(alert.satisfiedEvidence.length > 0 || alert.missingEvidence.length > 0) && (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2.5">
          {alert.satisfiedEvidence.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground w-14 shrink-0">Evidence</span>
              {alert.satisfiedEvidence.map((ev) => (
                <span
                  key={ev}
                  className="inline-flex items-center gap-0.5 rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 font-mono text-[9px] text-primary"
                >
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  {ev}
                </span>
              ))}
            </div>
          )}
          {alert.missingEvidence.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground w-14 shrink-0">Missing</span>
              {alert.missingEvidence.map((ev) => (
                <span
                  key={ev}
                  className="inline-flex items-center gap-0.5 rounded border border-muted-foreground/20 bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                  {ev}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action badges */}
      <div className="mt-3 flex items-center gap-2">
        {!alert.isRead && (
          <button
            onClick={() => onRead(alert.id)}
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
            aria-label="Mark as read"
          >
            <Eye className="h-3 w-3" />
            Mark read
          </button>
        )}
        {alert.isRead && !alert.isAcknowledged && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
            aria-label="Acknowledge alert"
          >
            <CheckCheck className="h-3 w-3" />
            Acknowledge
          </button>
        )}
        {alert.isRead && (
          <Badge variant="outline" className="border-border/50 font-mono text-[9px] text-muted-foreground">
            <Eye className="mr-1 h-2.5 w-2.5" /> Read
          </Badge>
        )}
        {alert.isAcknowledged && (
          <Badge variant="outline" className="border-primary/20 bg-primary/5 font-mono text-[9px] text-primary">
            <CheckCheck className="mr-1 h-2.5 w-2.5" /> Ack'd
          </Badge>
        )}
      </div>
    </div>
  );
}

interface NotificationPanelProps {
  browserPushEnabled: boolean;
  settings: AlertNotificationSettings;
  mutations: AlertCenterMutations;
}

function NotificationPanel({ browserPushEnabled, settings, mutations }: NotificationPanelProps) {
  const [supportStatus, setSupportStatus] = useState<NotificationSupportStatus>('default');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testFired, setTestFired] = useState(false);

  // Refresh on mount
  useEffect(() => {
    setSupportStatus(getNotificationSupportStatus());
  }, []);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (checked && supportStatus === 'default') {
        // Need to request permission first
        setIsRequesting(true);
        const result = await requestNotificationPermission();
        setSupportStatus(result);
        setIsRequesting(false);
        if (result !== 'granted') return;
      }
      setIsSaving(true);
      try {
        await mutations.setNotificationsEnabled(checked);
      } finally {
        setIsSaving(false);
      }
    },
    [supportStatus, mutations],
  );

  const handleTest = useCallback(async () => {
    const delivered = await mutations.sendTestNotification();
    if (!delivered) return;
    setTestFired(true);
    setTimeout(() => setTestFired(false), 2500);
  }, [mutations]);

  const canEnable = supportStatus === 'granted' || supportStatus === 'default';
  const effectivelyEnabled = browserPushEnabled && supportStatus === 'granted';

  return (
    <div className="space-y-4">
      {/* Toggle row */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {notifStatusIcon(supportStatus)}
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight">Browser notifications</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {notifStatusLabel(supportStatus)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(isRequesting || isSaving) && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Switch
            checked={effectivelyEnabled}
            onCheckedChange={handleToggle}
            disabled={!canEnable || isRequesting || isSaving}
            aria-label="Toggle browser notifications"
            data-testid="switch-browser-notifications"
          />
        </div>
      </div>

      {/* Feature detection guidance */}
      {supportStatus === 'ios-pwa-required' && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              iPhone/iPad: Add to Home Screen required
            </p>
          </div>
          <ol className="ml-6 list-decimal space-y-1 text-xs text-amber-700 dark:text-amber-400">
            <li>
              In Safari, tap the{' '}
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px]">
                Share ↑
              </span>{' '}
              icon in the toolbar.
            </li>
            <li>
              Scroll down and tap{' '}
              <span className="font-semibold">"Add to Home Screen"</span>.
            </li>
            <li>
              Tap <span className="font-semibold">"Add"</span> to confirm.
            </li>
            <li>Open the app from your Home Screen icon.</li>
            <li>Return here and enable notifications.</li>
          </ol>
          <p className="text-[10px] text-amber-600/70 dark:text-amber-500/70">
            Browser push notifications are only available inside a home-screen PWA on iOS 16.4+.
          </p>
        </div>
      )}

      {supportStatus === 'blocked' && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">Notifications blocked</p>
              <p className="text-xs text-muted-foreground">
                Notification permission was denied. To re-enable, open your browser's site
                settings (the lock icon in the address bar) and change Notifications to Allow,
                then reload.
              </p>
            </div>
          </div>
        </div>
      )}

      {supportStatus === 'unsupported' && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              This browser does not support the Notifications API. Try a modern desktop browser
              (Chrome, Firefox, Edge, or Safari 16.4+ PWA).
            </p>
          </div>
        </div>
      )}

      {/* Test button – only shown when permission is granted */}
      {supportStatus === 'granted' && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleTest}
            disabled={testFired}
            data-testid="button-test-notification"
          >
            {testFired ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Sent
              </>
            ) : (
              <>
                <FlaskConical className="h-3.5 w-3.5" />
                Send test alert
              </>
            )}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Fires a sample verification-only notification to confirm delivery.
          </p>
        </div>
      )}

      {/* Status truth statement */}
      <div className="rounded border border-border/50 bg-background/50 px-3 py-2 text-[10px] text-muted-foreground">
        Push delivery:{' '}
        <span
          className={cn('font-semibold', effectivelyEnabled ? 'text-primary' : 'text-muted-foreground')}
          data-testid="text-push-delivery-status"
        >
          {effectivelyEnabled ? 'Active' : 'Inactive'}
        </span>
        {' · '}
        Browser permission:{' '}
        <span className="font-mono">
          {supportStatus === 'granted' ? 'granted' : supportStatus === 'blocked' ? 'denied' : supportStatus}
        </span>
      </div>

      {/* Tier threshold */}
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Notify on tier
        </p>
        <div className="flex flex-wrap gap-2">
          {NOTIFICATION_TIER_ORDER.map((tier) => (
            <button
              key={tier}
              onClick={() => mutations.setMinimumTier(tier)}
              className={cn(
                'rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors',
                settings.minimumTier === tier
                  ? tierStyle(tier) + ' font-semibold'
                  : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
              data-testid={`button-tier-${tier}`}
            >
              {tierLabel(tier)}+
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AlertCenter({
  alerts,
  settings,
  isLoading,
  isRefreshing,
  isError,
  actionError,
  browserPushEnabled,
  mutations,
  className,
}: AlertCenterProps) {
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const unreadCount = alerts.filter((a) => !a.isRead).length;
  const hasAlerts = alerts.length > 0;

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading && !hasAlerts) {
    return (
      <Card className={cn('w-full', className)} data-testid="alert-center-loading">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            <BellRing className="h-4 w-4 text-primary animate-pulse" />
            Alert Center
          </CardTitle>
          <CardDescription>Loading alert history…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card className={cn('w-full border-destructive/30', className)} data-testid="alert-center-error">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-destructive">
            <TriangleAlert className="h-4 w-4" />
            Alert Center — Unavailable
          </CardTitle>
          <CardDescription>
            Could not load alert history. Check server connectivity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <CircleAlert className="h-8 w-8 opacity-30" />
            <p className="text-sm">Alert data is temporarily unavailable.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('w-full', className)} data-testid="alert-center">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              <BellRing className="h-4 w-4 text-primary" />
              Alert Center
              {unreadCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">
                  {unreadCount}
                </span>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              Verified Alpha signal alerts — verification only, not a trading instruction.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={mutations.markAllRead}
                data-testid="button-mark-all-read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Mark all read</span>
              </Button>
            )}
            <Button
              variant={showNotifPanel ? 'secondary' : 'outline'}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowNotifPanel((v) => !v)}
              data-testid="button-toggle-notif-panel"
              aria-expanded={showNotifPanel}
            >
              <Bell className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Notifications</span>
              {browserPushEnabled && (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Disclaimer ──────────────────────────────────────────────────── */}
        <DisclaimerBanner />

        {actionError && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            role="alert"
            data-testid="alert-action-error"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{actionError}</p>
          </div>
        )}

        {/* ── Notification settings panel ─────────────────────────────────── */}
        {showNotifPanel && (
          <>
            <Separator />
            <div>
              <p className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                Notification settings
              </p>
              <NotificationPanel
                browserPushEnabled={browserPushEnabled}
                settings={settings}
                mutations={mutations}
              />
            </div>
            <Separator />
          </>
        )}

        {/* ── Alert history ──────────────────────────────────────────────── */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Alert history{' '}
              {hasAlerts && (
                <span className="font-mono text-foreground">({alerts.length})</span>
              )}
            </p>
            {isRefreshing && !isLoading && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Refreshing
              </div>
            )}
          </div>

          {/* Empty state */}
          {!hasAlerts && (
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-14 text-center text-muted-foreground"
              data-testid="alert-center-empty"
            >
              <Sparkles className="h-8 w-8 opacity-20" />
              <div className="space-y-1">
                <p className="text-sm font-medium">No alerts recorded yet</p>
                <p className="text-xs">
                  Alerts appear here when the Alpha Radar engine detects a verified
                  signal transition. This is not a trading signal source.
                </p>
              </div>
            </div>
          )}

          {/* Alert list */}
          {hasAlerts && (
            <div className="space-y-3" data-testid="alert-center-list">
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onRead={mutations.markRead}
                  onAcknowledge={mutations.acknowledge}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer notice ───────────────────────────────────────────────── */}
        <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Verification only · Not a trading instruction · No orders placed
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Utility: convert an AlphaRadarSignalHistoryEntry from the API into an
 * AlertRecord suitable for AlertCenter. The `symbol` and `id` must be
 * supplied by the caller (the API schema doesn't include them at the entry level).
 */
export function historyEntryToAlertRecord(
  entry: AlphaRadarSignalHistoryEntry,
  symbol: string,
  overrides?: Partial<Pick<AlertRecord, 'isRead' | 'isAcknowledged'>>,
): AlertRecord {
  const tier: AlertRecord['tier'] =
    entry.toState === 'confirmed'     ? 'confirmed'
    : entry.toState === 'breakout_critical' ? 'breakout_critical'
    : entry.toState === 'latent' ? 'latent'
    : entry.toState === 'watch'        ? 'watch'
    : 'unavailable';

  return {
    id: `${symbol}-${entry.occurredAt}`,
    occurredAt: entry.occurredAt,
    symbol,
    tier,
    score: entry.score,
    confidence: entry.confidence,
    alphaVelocity: entry.alphaVelocity,
    sector: null,
    industry: null,
    sectorLeaderContext: null,
    satisfiedEvidence: entry.satisfiedEvidence,
    missingEvidence: entry.missingEvidence,
    dataFresh: entry.dataFresh,
    reason: entry.reason,
    evidenceCount: entry.evidenceCount,
    isRead: overrides?.isRead ?? false,
    isAcknowledged: overrides?.isAcknowledged ?? false,
    fromState: entry.fromState,
    toState: entry.toState,
    fromConfirmationStatus: entry.fromConfirmationStatus,
    toConfirmationStatus: entry.toConfirmationStatus,
  };
}
