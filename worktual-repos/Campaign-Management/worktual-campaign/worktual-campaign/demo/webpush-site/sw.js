self.addEventListener("push", (event) => {
  let data = { title: "Update", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data = { title: "Update", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Update";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || data.message || "",
      icon: data.icon,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const trackUrl = typeof data.click_url === "string" ? data.click_url : "";
  const openUrl = data.url || "/";
  event.waitUntil(
    (async () => {
      // Tracker with ?u= redirects to the destination and records the tap.
      if (trackUrl && /[?&]u=/.test(trackUrl)) {
        await self.clients.openWindow(trackUrl);
        return;
      }
      if (trackUrl) {
        try {
          await fetch(trackUrl, {
            method: "POST",
            mode: "cors",
            keepalive: true,
          });
        } catch {
          /* ignore */
        }
      }
      await self.clients.openWindow(openUrl);
    })(),
  );
});
