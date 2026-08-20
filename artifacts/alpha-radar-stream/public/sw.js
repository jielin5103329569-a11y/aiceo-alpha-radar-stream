self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const notificationData = payload.data && typeof payload.data === "object" ? payload.data : {};
  const title = payload.title || "Verified Alpha Alert";
  const options = {
    body: payload.body || "Verification/Alert only — not a trading instruction.",
    icon: payload.icon || "favicon.svg",
    badge: payload.badge || "favicon.svg",
    tag: payload.eventKey || notificationData.eventKey || "alpha-radar-alert",
    renotify: false,
    data: {
      url: payload.url || notificationData.url || self.registration.scope,
      eventKey: payload.eventKey || notificationData.eventKey || null,
      sector: notificationData.sector || payload.sector || null,
      industry: notificationData.industry || payload.industry || null,
      sectorLeaderContext: notificationData.sectorLeaderContext || payload.sectorLeaderContext || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      return existing ? existing.focus() : clients.openWindow(targetUrl);
    })
  );
});