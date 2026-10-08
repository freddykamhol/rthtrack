self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const current = windows.find((client) => new URL(client.url).origin === self.location.origin)
    return current ? current.focus() : self.clients.openWindow('/')
  }))
})
