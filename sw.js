// Lưu khung app trên máy để mở ngay và mở được khi mất mạng. Đổi VERSION mỗi lần sửa giao diện.
const VERSION = 'svs-v8';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Chỉ xử lý file của app; gọi API (script.google.com) đi thẳng ra mạng.
// Trả ngay bản đã lưu cho nhanh, đồng thời tải bản mới về để lần mở sau dùng.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request)
      .then(res => { if (res.ok) c.put(e.request, res.clone()); return res; })
      .catch(() => hit);
    return hit || net;
  }));
});
