self.addEventListener("push", function (event) {
  var data = { title: "Update", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch (e) {
    data = { title: "Update", body: event.data ? event.data.text() : "" };
  }
  var title = data.title || "Update";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || data.message || "",
      icon: data.icon,
      data: data,
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var trackUrl = typeof data.click_url === "string" ? data.click_url : "";
  var openUrl = data.url || "/";
  event.waitUntil(
    (async function () {
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
        } catch (e) {
          /* ignore */
        }
      }
      await self.clients.openWindow(openUrl);
    })(),
  );
});
