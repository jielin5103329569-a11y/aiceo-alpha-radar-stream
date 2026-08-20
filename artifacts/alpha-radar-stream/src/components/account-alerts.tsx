import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAlertSettingsQueryKey,
  getGetAlertsQueryKey,
  getGetPushCapabilityQueryKey,
  useAcknowledgeAlert,
  useCreatePushSubscription,
  useGetAlertSettings,
  useGetAlerts,
  useGetPushCapability,
  useMarkAlertRead,
  useMarkAllAlertsRead,
  useSendAlertTestNotification,
  useUpdateAlertSettings,
  type AlertSettings,
  type VerifiedAlphaAlert,
} from "@workspace/api-client-react";
import { Bell, LogIn } from "lucide-react";
import { useCallback } from "react";
import { useLocation } from "wouter";
import { AlertCenter, type AlertRecord, type AlertNotificationSettings } from "@/components/alert-center";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const tierBySeverity: Record<string, AlertRecord["tier"]> = {
  critical: "confirmed",
  alert: "pre_breakout",
  watch: "accelerating",
  info: "watch",
};

function mapAlert(alert: VerifiedAlphaAlert): AlertRecord {
  const tier = tierBySeverity[alert.severity] ?? "unavailable";
  return {
    id: alert.id,
    occurredAt: alert.generatedAt,
    symbol: alert.symbol,
    tier,
    score: alert.alphaScore,
    confidence: alert.confidence,
    alphaVelocity: alert.alphaVelocity30s ?? null,
    satisfiedEvidence: alert.satisfiedEvidence,
    missingEvidence: alert.missingEvidence,
    dataFresh: true,
    reason: alert.triggerReason.replace(/_/g, " "),
    evidenceCount: alert.satisfiedEvidence.length,
    isRead: alert.readAt !== null,
    isAcknowledged: alert.acknowledgedAt !== null,
    fromState: alert.detectionState as AlertRecord["fromState"],
    toState: alert.detectionState as AlertRecord["toState"],
    fromConfirmationStatus: alert.confirmationStatus as AlertRecord["fromConfirmationStatus"],
    toConfirmationStatus: alert.confirmationStatus as AlertRecord["toConfirmationStatus"],
  };
}

function mapSettings(settings: AlertSettings | undefined): AlertNotificationSettings {
  return {
    browserNotificationsEnabled: settings?.browserNotificationsEnabled ?? false,
    minimumTier: tierBySeverity[settings?.minimumSeverity ?? "watch"] ?? "accelerating",
    notifyOnWatch: settings?.minimumSeverity === "info",
  };
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const raw = window.atob(padded);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function AccountAlerts() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const alerts = useGetAlerts(undefined, {
    query: { queryKey: getGetAlertsQueryKey(), enabled: isSignedIn === true, refetchInterval: 20_000 },
  });
  const settings = useGetAlertSettings({
    query: { queryKey: getGetAlertSettingsQueryKey(), enabled: isSignedIn === true },
  });
  const pushCapability = useGetPushCapability({
    query: { queryKey: getGetPushCapabilityQueryKey(), enabled: isSignedIn === true, staleTime: 60_000 },
  });
  const updateSettings = useUpdateAlertSettings();
  const markRead = useMarkAlertRead();
  const markAllRead = useMarkAllAlertsRead();
  const acknowledge = useAcknowledgeAlert();
  const saveSubscription = useCreatePushSubscription();
  const sendTest = useSendAlertTestNotification();

  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: getGetAlertsQueryKey() }),
      client.invalidateQueries({ queryKey: getGetAlertSettingsQueryKey() }),
    ]);
  }, [client]);

  const saveSettings = useCallback(async (next: AlertNotificationSettings) => {
    await updateSettings.mutateAsync({
      data: {
        browserNotificationsEnabled: next.browserNotificationsEnabled,
        minimumTier: next.minimumTier === "unavailable" ? "accelerating" : next.minimumTier,
        notifyOnWatch: next.notifyOnWatch,
      },
    });
    await refresh();
  }, [refresh, updateSettings]);

  const enablePush = useCallback(async (): Promise<boolean> => {
    const capability = pushCapability.data;
    if (!capability?.available || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return false;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToArrayBuffer(capability.publicKey),
    });
    const serialized = subscription.toJSON();
    if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) return false;
    await saveSubscription.mutateAsync({
      data: {
        endpoint: serialized.endpoint,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
        deviceLabel: navigator.userAgent.slice(0, 120),
      },
    });
    return true;
  }, [pushCapability.data, saveSubscription]);

  if (!isSignedIn) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Bell className="h-4 w-4" />Verified Alpha Alerts</CardTitle>
          <CardDescription>Sign in to keep account-scoped read state and notification preferences.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setLocation("/sign-in")} data-testid="button-alerts-sign-in">
            <LogIn className="h-4 w-4" />Sign in for alerts
          </Button>
        </CardContent>
      </Card>
    );
  }

  const currentSettings = mapSettings(settings.data);
  const canDeliverPush = pushCapability.data?.available === true;
  return (
    <AlertCenter
      alerts={(alerts.data?.alerts ?? []).map(mapAlert)}
      settings={currentSettings}
      isLoading={alerts.isLoading || settings.isLoading}
      isError={alerts.isError || settings.isError}
      browserPushEnabled={Boolean(currentSettings.browserNotificationsEnabled && canDeliverPush)}
      mutations={{
        markRead: (id) => { void markRead.mutateAsync({ alertId: id }).then(refresh); },
        acknowledge: (id) => { void acknowledge.mutateAsync({ alertId: id }).then(refresh); },
        markAllRead: () => { void markAllRead.mutateAsync().then(refresh); },
        setNotificationsEnabled: async (enabled) => {
          if (enabled && !(await enablePush())) return;
          await saveSettings({ ...currentSettings, browserNotificationsEnabled: enabled });
        },
        setMinimumTier: async (minimumTier) => {
          await saveSettings({ ...currentSettings, minimumTier, notifyOnWatch: minimumTier === "watch" });
        },
        sendTestNotification: async () => {
          const result = await sendTest.mutateAsync();
          return result.status === "sent";
        },
      }}
    />
  );
}