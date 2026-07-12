// 最小 PWA Service Worker —— 应用壳缓存 + 运行时缓存
//
// 策略：
// - 导航请求 network-first（保证新版本及时生效），离线时回退到缓存的 index.html
// - 同源静态资源（main.js / main.css / 图标 / manifest）cache-first
// - 跨源请求（API 调用等）不拦截、不缓存
//
// 注意：本 SW 只做「可安装性 + 离线壳」的最小保障，不作为离线卖点（见锁定 Spec §0.4）。

const CACHE = 'omni-plane-v1';
const SHELL = ['/', '/index.html', '/main.js', '/main.css', '/manifest.json', '/icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 仅处理同源请求；API 等跨源请求直接放行
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
    }),
  );
});
