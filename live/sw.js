// Whalyom Command Center service worker (installable app, offline open, "decision waiting" alerts).
// Served by tools/server.mjs at /sw.js with scope "/". Plain script, no build step, no dependencies.
//   Shell cache   the page ("/"), manifest and icons: network first for the page (the server injects a
//                 fresh per-start token), cached copy only when offline; icons and manifest are served
//                 from cache and refreshed in the background.
//   CDN cache     three.js and the web fonts the page loads (cdnjs, Google Fonts): cache first.
//   Never cached  /api/* (decisions, writes, vault) and /stream (live SSE). Those requests are not even
//                 intercepted, so they always reach the server exactly as the page sent them. /site/* (the
//                 local publisher's output) and every non-GET request are left alone as well.
//   Alerts        the page posts { type: 'decision-waiting', count, title? }; with notification permission
//                 granted this shows one local notification (tag "whalyom-decision", replaced, not stacked);
//                 count 0 clears it. Clicking it focuses the open Command Center or opens it.
// Nothing here sends anything anywhere: notifications are local to this device.
'use strict';

const VERSION = 'v1';
const SHELL_CACHE = `whalyom-shell-${VERSION}`;
const CDN_CACHE = `whalyom-cdn-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const OPTIONAL_SHELL = ['/local-shim.js'];
const BYPASS = ['/api', '/stream'];
const NO_INTERCEPT = ['/site/'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const CDN_MAX = 40;
const TAG = 'whalyom-decision';

// True for paths that must never be served from (or written to) a cache.
function isBypassed(pathname) {
  const p = String(pathname || '');
  return BYPASS.some((b) => p === b || p.startsWith(`${b}/`) || p.startsWith(`${b}?`));
}

// Decides how a request is handled: 'bypass' | 'page' | 'shell' | 'cdn' | 'network'.
function routeFor(request, origin) {
  if (!request || request.method !== 'GET') return 'bypass';
  let url;
  try { url = new URL(request.url); } catch { return 'bypass'; }
  if (url.origin === origin) {
    if (isBypassed(url.pathname)) return 'bypass';
    if (NO_INTERCEPT.some((p) => url.pathname.startsWith(p))) return 'bypass';
    const accept = (request.headers && request.headers.get && request.headers.get('accept')) || '';
    if (accept.includes('text/event-stream')) return 'bypass';
    // Only the Command Center itself is the page; other navigations are never written over its cached copy.
    if (url.pathname === '/' || url.pathname === '/index.html') return 'page';
    if (SHELL.includes(url.pathname) || OPTIONAL_SHELL.includes(url.pathname)) return 'shell';
    return 'network';
  }
  if (url.protocol === 'https:' && CDN_HOSTS.includes(url.hostname)) return 'cdn';
  return 'network';
}

// The served page carries the per-start owner token (window.__WHALYOM_LOCAL__). The offline copy is stored
// with the token blanked: it cannot authorise writes offline anyway, and no secret sits in Cache Storage.
function scrubToken(html) {
  return String(html).replace(/("token"\s*:\s*")[^"]*(")/g, '$1$2');
}

async function putPage(cache, res) {
  const text = await res.clone().text();
  const headers = new Headers({ 'content-type': (res.headers && res.headers.get && res.headers.get('content-type')) || 'text/html; charset=utf-8' });
  await cache.put('/', new Response(scrubToken(text), { status: 200, headers }));
}

const cacheable = (res) => res && (res.ok || res.type === 'opaque');

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function pageFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) await putPage(cache, res).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await cache.match('/')) || (await cache.match(request));
    if (hit) return hit;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whalyom</title><body style="background:#141718;color:#E8E5DE;font:16px system-ui;padding:24px">Whalyom is offline. Open it again once this device is back online.</body>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request).then(async (res) => { if (res && res.ok) await cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || new Response('', { status: 504 });
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) { await cache.put(request, res.clone()); trimCache(CDN_CACHE, CDN_MAX).catch(() => {}); }
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Each file on its own: one missing optional file must not block install.
    // The page itself goes through putPage so its owner token is never stored.
    await Promise.allSettled([
      fetch(new Request('/', { cache: 'reload', credentials: 'same-origin' })).then((res) => (res && res.ok ? putPage(cache, res) : null)),
      ...[...SHELL.filter((p) => p !== '/'), ...OPTIONAL_SHELL].map((p) => cache.add(new Request(p, { cache: 'reload', credentials: 'same-origin' }))),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CDN_CACHE]);
    for (const k of await caches.keys()) if (k.startsWith('whalyom-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, self.location.origin);
  if (route === 'bypass' || route === 'network') return; // the browser handles it; nothing is cached
  if (route === 'page') return event.respondWith(pageFirst(event.request));
  if (route === 'shell') return event.respondWith(staleWhileRevalidate(event.request));
  if (route === 'cdn') return event.respondWith(cacheFirst(event.request));
});

// ── "decision waiting" notifications ──
let lastCount = 0;

// Pure: validates a page message. Returns null when it is not a decision message.
function parseDecisionMessage(data) {
  if (!data || typeof data !== 'object' || data.type !== 'decision-waiting') return null;
  const n = Math.floor(Number(data.count));
  const count = Number.isFinite(n) ? Math.max(0, Math.min(n, 999)) : 0;
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const title = clean(data.title, 120);
  const body = count === 0 ? '' : title || (count === 1 ? 'One decision is waiting for you.' : `${count} decisions are waiting for you.`);
  return { count, title: count === 1 ? 'Whalyom: decision waiting' : `Whalyom: ${count} decisions waiting`, body };
}

async function showDecision(msg) {
  const reg = self.registration;
  if (msg.count === 0) {
    lastCount = 0;
    for (const n of await reg.getNotifications({ tag: TAG })) n.close();
    return 'cleared';
  }
  const perm = self.Notification && self.Notification.permission;
  if (perm !== 'granted') return 'no-permission';
  if (msg.count === lastCount) return 'unchanged';
  if (msg.count < lastCount) { // fewer waiting: correct the open notification quietly, no new alert
    lastCount = msg.count;
    const open = await reg.getNotifications({ tag: TAG });
    if (!open.length) return 'unchanged';
    await reg.showNotification(msg.title, { body: msg.body, tag: TAG, renotify: false, silent: true, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' } });
    return 'updated';
  }
  lastCount = msg.count;
  await reg.showNotification(msg.title, { body: msg.body, tag: TAG, renotify: true, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' } });
  return 'shown';
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'skip-waiting') return void self.skipWaiting();
  const msg = parseDecisionMessage(data);
  if (msg) event.waitUntil(showDecision(msg).catch(() => 'failed'));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try { if (new URL(c.url).origin === self.location.origin && 'focus' in c) return c.focus(); } catch { /* ignore */ }
    }
    return self.clients.openWindow ? self.clients.openWindow('/') : null;
  })());
});
