// Офлайн: оболочку берём из кэша, расписание — из сети, а если сети нет — из кэша
const VERSION = 'rasp-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return; // задания всегда из сети, офлайн-копию держит сама страница

  // Данные и сама страница: сначала сеть (свежая версия), без сети — кэш
  if (url.pathname.includes('/data/') || req.mode === 'navigate' || /\.(js|css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // Картинки и прочее — из кэша
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
