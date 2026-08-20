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
import { useCallback, useState } from "react";
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

function normalizeEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function mapAlert(alert: VerifiedAlphaAlert): AlertRecord {
  const tier = tierBySeverity[alert.severity] ?? "unavailable";
  const satisfiedEvidence = normalizeEvidence(alert.satisfiedEvidence);
  const missingEvidence = normalizeEvidence(alert.missingEvidence);
  return {
    id: alert.id,
    occurredAt: alert.generatedAt,
    symbol: alert.symbol,
    tier,
    score: alert.alphaScore,
    confidence: alert.confidence,
    alphaVelocity: alert.alphaVelocity30s ?? null,
    sector: alert.sector ?? null,
    industry: alert.industry ?? null,
    satisfiedEvidence,
    missingEvidence,
    dataFresh: true,
    reason: alert.triggerReason.replace(/_/g, " "),
    evidenceCount: satisfiedEvidence.length,
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
  const [actionError, setActionError] = useState<string | null>(null);
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
    setActionError(null);
    try {
      await updateSettings.mutateAsync({
        data: {
          browserNotificationsEnabled: next.browserNotificationsEnabled,
          minimumTier: next.minimumTier === "unavailable" ? "accelerating" : next.minimumTier,
          notifyOnWatch: next.notifyOnWatch,
        },
      });
      await refresh();
    } catch {
      setActionError("Notification settings could not be saved. Please try again.");
    }
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

  const applyReceiptMutation = useCallback((
    operation: () => Promise<unknown>,
    failureMessage: string,
  ) => {
    setActionError(null);
    void (async () => {
      try {
        await operation();
        await refresh();
      } catch {
        setActionError(failureMessage);
      }
    })();
  }, [refresh]);

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
      isRefreshing={alerts.isFetching || settings.isFetching}
      isError={alerts.isError || settings.isError}
      actionError={actionError}
      browserPushEnabled={Boolean(currentSettings.browserNotificationsEnabled && canDeliverPush)}
      mutations={{
        markRead: (id) => {
          applyReceiptMutation(
            () => markRead.mutateAsync({ alertId: id }),
            "This alert could not be marked as read. Please try again.",
          );
        },
        acknowledge: (id) => {
          applyReceiptMutation(
            () => acknowledge.mutateAsync({ alertId: id }),
            "This alert could not be acknowledged. Please try again.",
          );
        },
        markAllRead: () => {
          applyReceiptMutation(
            () => markAllRead.mutateAsync(),
            "Alert history could not be marked as read. Please try again.",
          );
        },
        setNotificationsEnabled: async (enabled) => {
          try {
            if (enabled && !(await enablePush())) {
              setActionError("Browser notifications could not be enabled on this device.");
              return;
            }
            await saveSettings({ ...currentSettings, browserNotificationsEnabled: enabled });
          } catch {
            setActionError("Browser notifications could not be updated. Please try again.");
          }
        },
        setMinimumTier: async (minimumTier) => {
          await saveSettings({ ...currentSettings, minimumTier, notifyOnWatch: minimumTier === "watch" });
        },
        sendTestNotification: async () => {
          setActionError(null);
          try {
            const result = await sendTest.mutateAsync();
            if (result.status === "sent") return true;
            setActionError(
              result.status === "unavailable"
                ? "Test delivery is unavailable because server Push is not configured."
                : result.status === "no_subscriptions"
                  ? "Test delivery needs an active browser Push subscription."
                  : "Test notification could not be delivered. Please try again.",
            );
            return false;
          } catch {
            setActionError("Test notification could not be requested. Please try again.");
            return false;
          }
        },
      }}
    />
  );
}