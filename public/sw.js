self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "AttendanceIQ", body: event.data.text() };
  }

  const title = payload.title || "AttendanceIQ";
  const options = {
    body: payload.body || "New notification",
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.focus();
          client.navigate(target);
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
    })
  );
});
