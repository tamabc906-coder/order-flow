// Chỉ cache vỏ app để mở nhanh/offline. Dữ liệu (data/*.json) và trang HTML luôn đi mạng trước, rớt mạng mới
// dùng bản cũ. Push điện thoại làm giai đoạn sau. Đổi CACHE khi đổi ?v= trong index.html.
// Bẫy 26/09/2026: addAll() mặc định lấy qua bộ đệm HTTP (GitHub Pages max-age=600) → bản v4 bị nhét index.html
// cũ và trang lấy từ cache trước nên kẹt mãi. Vì vậy: cài bằng cache:'reload', điều hướng (HTML) đi mạng trước.
const CACHE = 'of-shell-v23';
const SHELL = ['./', './index.html', './styles.css?v=10', './app.js?v=23', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const netFirst = req => fetch(req, {cache: 'no-cache'}).then(r => {
  const copy = r.clone();
  if (r.ok) caches.open(CACHE).then(c => c.put(req, copy));
  return r;
}).catch(() => caches.match(req, {ignoreSearch: req.mode === 'navigate'}));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/') || e.request.mode === 'navigate') {
    e.respondWith(netFirst(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
