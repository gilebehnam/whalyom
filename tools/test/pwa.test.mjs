// Installable Command Center: manifest fields, icons, and the service worker's cache rules and alerts.
// No network: the service worker runs in a vm sandbox with fake caches, fetch and registration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { root } from '../lib/env.mjs';
import {
  buildManifest, validateManifest, extractTokens, decodePng, encodePng, resizeRgba, makeIcons,
  buildPwa, checkPwa, registrationSnippet, crc32, PWA_ROUTES, BYPASS_PREFIXES, FALLBACK_COLOR,
} from '../pwa.mjs';

const live = path.join(root, 'live');
const html = fs.readFileSync(path.join(live, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(live, 'sw.js'), 'utf8');

// ── manifest ──

test('manifest on disk has the required fields and the page colours', () => {
  const m = JSON.parse(fs.readFileSync(path.join(live, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Whalyom Command Center');
  assert.equal(m.short_name, 'Whalyom');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  const bg = extractTokens(html).bg;
  assert.match(bg, /^#[0-9a-f]{6}$/);
  assert.equal(m.theme_color, bg);
  assert.equal(m.background_color, bg);
  assert.deepEqual(m.icons.map((i) => [i.src, i.sizes, i.type]), [['/icon-192.png', '192x192', 'image/png'], ['/icon-512.png', '512x512', 'image/png']]);
  assert.deepEqual(validateManifest(m), []);
});

test('manifest on disk matches what the builder produces (no drift)', () => {
  const { files } = buildPwa({ html, sourcePng: fs.readFileSync(path.join(root, 'tools', 'whalyom.png')) });
  assert.equal(fs.readFileSync(path.join(live, 'manifest.webmanifest'), 'utf8'), files['manifest.webmanifest']);
});

test('extractTokens reads only the day :root block and ignores bad input', () => {
  const t = extractTokens(':root { --bg: #ABC; --ink: #E8E5DE; --accent: rgba(1,2,3,.5); }\n:root[data-theme="dark"] { --bg: #000000; }');
  assert.deepEqual(t, { bg: '#aabbcc', ink: '#e8e5de' });
  assert.deepEqual(extractTokens(''), {});
  assert.deepEqual(extractTokens(null), {});
  assert.deepEqual(extractTokens('<style>body{}</style>'), {});
});

test('buildManifest falls back on bad colours and rejects bad sizes', () => {
  const m = buildManifest({ tokens: { bg: 'red' }, sizes: [512, 192, 192, 'x'] });
  assert.equal(m.theme_color, FALLBACK_COLOR);
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512']);
  assert.throws(() => buildManifest({ sizes: [] }), /no valid icon sizes/);
  assert.throws(() => buildManifest({ sizes: [10, 99999] }), /no valid icon sizes/);
  assert.deepEqual(buildManifest(), buildManifest()); // deterministic
});

test('validateManifest names each missing field', () => {
  assert.deepEqual(validateManifest(null), ['manifest is not an object']);
  const errs = validateManifest({ name: 'x', display: 'browser', start_url: 'https://evil.example/', theme_color: 'blue', icons: [] });
  for (const k of ['name', 'short_name', 'display', 'start_url', 'theme_color', 'background_color', '192x192', '512x512']) assert.ok(errs.some((e) => e.includes(k)), k);
});

// ── icons ──

test('icons on disk are real PNGs at 192 and 512', () => {
  for (const s of [192, 512]) {
    const img = decodePng(fs.readFileSync(path.join(live, `icon-${s}.png`)));
    assert.equal(img.width, s);
    assert.equal(img.height, s);
  }
  assert.deepEqual(checkPwa({ liveDir: live }), []);
});

const solid = (w, h, rgba) => { const d = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) d.set(rgba, i * 4); return { width: w, height: h, data: d }; };

test('PNG encode/decode round trip is lossless', () => {
  const img = { width: 5, height: 3, data: new Uint8Array(60).map((_, i) => (i * 37) & 0xff) };
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 5);
  assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data));
});

test('resize keeps flat colour, keeps transparency clean, and is deterministic', () => {
  const down = resizeRgba(solid(16, 16, [10, 200, 30, 255]), 12);
  assert.ok([...down.data].every((v, i) => v === [10, 200, 30, 255][i % 4]));
  const up = resizeRgba(solid(4, 4, [255, 0, 0, 0]), 8);
  assert.ok([...up.data].every((v) => v === 0), 'fully transparent stays fully transparent');
  const src = encodePng({ width: 8, height: 8, data: new Uint8Array(256).map((_, i) => (i * 13) & 0xff) });
  const a = makeIcons(src, [6, 16]), b = makeIcons(src, [6, 16]);
  assert.ok(a[6].equals(b[6]) && a[16].equals(b[16]));
  assert.equal(decodePng(a[16]).width, 16);
});

test('PNG and resize guards reject bad input', () => {
  assert.throws(() => decodePng('nope'), TypeError);
  assert.throws(() => decodePng(Buffer.alloc(40)), /not a PNG/);
  const good = encodePng(solid(2, 2, [1, 2, 3, 4]));
  const bad = Buffer.from(good); bad[bad.length - 20] ^= 0xff;
  assert.throws(() => decodePng(bad), /bad CRC|truncated|IDAT|incorrect|invalid/i);
  assert.throws(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) }), /data length/);
  assert.throws(() => resizeRgba(solid(2, 2, [0, 0, 0, 0]), 0), /bad target size/);
  assert.throws(() => resizeRgba({}, 4), /bad source image/);
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
});

test('checkPwa reports missing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-pwa-'));
  try {
    const errs = checkPwa({ liveDir: dir });
    assert.ok(errs.some((e) => e.includes('manifest')));
    assert.ok(errs.some((e) => e.includes('icon-192')));
    assert.ok(errs.some((e) => e.includes('sw.js')));
    fs.writeFileSync(path.join(dir, 'sw.js'), "const BYPASS = ['/stream'];");
    assert.ok(checkPwa({ liveDir: dir }).some((e) => e.includes('/api')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── snippet and routes ──

test('registration snippet links the manifest and registers /sw.js only where served locally', () => {
  const s = registrationSnippet({ themeColor: '#141718' });
  assert.match(s, /<link rel="manifest" href="\/manifest.webmanifest">/);
  assert.match(s, /<meta name="theme-color" content="#141718">/);
  assert.match(s, /register\('\/sw.js', \{ scope: '\/' \}\)/);
  assert.match(s, /__WHALYOM_LOCAL__/);
  assert.match(s, /type: 'decision-waiting'/);
  assert.match(registrationSnippet({ themeColor: 'javascript:alert(1)' }), new RegExp(`content="${FALLBACK_COLOR}"`));
  for (const r of Object.values(PWA_ROUTES)) assert.ok(fs.existsSync(path.join(root, r.file)), r.file);
});

// ── service worker in a sandbox ──

function loadSw({ permission = 'granted', fetchImpl } = {}) {
  const listeners = {};
  const store = new Map();
  const notes = [];
  const shown = [];
  const cache = {
    match: async (k) => store.get(typeof k === 'string' ? k : new URL(k.url).pathname),
    put: async (k, v) => { store.set(typeof k === 'string' ? k : new URL(k.url).pathname, v); },
    add: async () => {},
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    location: { origin: 'http://localhost:4321' },
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
    Notification: { permission },
    registration: {
      showNotification: async (title, opts) => { shown.push({ title, ...opts }); notes.push({ tag: opts.tag, close: () => notes.splice(notes.findIndex((n) => n.tag === opts.tag), 1) }); },
      getNotifications: async ({ tag }) => notes.filter((n) => n.tag === tag),
    },
  };
  const ctx = vm.createContext({
    self, URL, Request, Response, Headers, Promise, console,
    caches: { open: async () => cache, keys: async () => ['whalyom-shell-v0', 'other-app'], delete: async () => true },
    fetch: fetchImpl ?? (async () => new Response('ok', { status: 200 })),
  });
  vm.runInContext(swSource, ctx, { filename: 'sw.js' });
  return { ctx, listeners, shown, notes, store };
}

const fetchEvent = (url, init = {}) => {
  const ev = { request: new Request(url, init), responded: null };
  ev.respondWith = (p) => { ev.responded = p; };
  return ev;
};

test('service worker never intercepts or caches /api and /stream', () => {
  for (const p of BYPASS_PREFIXES) assert.ok(swSource.includes(`'${p}'`), `${p} listed in sw.js`);
  const { ctx, listeners } = loadSw();
  for (const u of ['/api', '/api/owner-decision', '/api/connectors?x=1', '/stream', '/stream?since=3', '/site/acme/index.html']) {
    const ev = fetchEvent(`http://localhost:4321${u}`);
    listeners.fetch(ev);
    assert.equal(ev.responded, null, `${u} must not be intercepted`);
    assert.equal(ctx.isBypassed(new URL(`http://localhost:4321${u}`).pathname), !u.startsWith('/site/'), u);
  }
  const post = fetchEvent('http://localhost:4321/', { method: 'POST', body: 'x' });
  listeners.fetch(post);
  assert.equal(post.responded, null, 'non-GET is never intercepted');
  const sse = fetchEvent('http://localhost:4321/events', { headers: { accept: 'text/event-stream' } });
  listeners.fetch(sse);
  assert.equal(sse.responded, null, 'event streams are never intercepted');
  assert.equal(ctx.isBypassed('/apiary'), false);
  assert.equal(ctx.isBypassed('/streams'), false);
});

test('service worker serves the shell and allowed CDNs, leaves other hosts alone', () => {
  const { listeners } = loadSw();
  for (const u of ['http://localhost:4321/', 'http://localhost:4321/icon-192.png', 'http://localhost:4321/manifest.webmanifest', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://fonts.gstatic.com/s/jost.woff2']) {
    const ev = fetchEvent(u);
    listeners.fetch(ev);
    assert.ok(ev.responded, `${u} handled`);
  }
  for (const u of ['https://evil.example/x.js', 'http://cdnjs.cloudflare.com/x.js', 'http://localhost:4321/other.json']) {
    const ev = fetchEvent(u);
    listeners.fetch(ev);
    assert.equal(ev.responded, null, `${u} not handled`);
  }
});

test('page is network first, cached copy offline, and a plain offline page when nothing is cached', async () => {
  let online = true;
  const { listeners, store } = loadSw({ fetchImpl: async () => { if (!online) throw new TypeError('offline'); return new Response('<p>live</p>', { status: 200 }); } });
  const ev1 = fetchEvent('http://localhost:4321/', { mode: 'same-origin' });
  listeners.fetch(ev1);
  assert.equal(await (await ev1.responded).text(), '<p>live</p>');
  assert.ok(store.has('/'), 'page cached for offline');
  online = false;
  const ev2 = fetchEvent('http://localhost:4321/');
  listeners.fetch(ev2);
  assert.equal(await (await ev2.responded).text(), '<p>live</p>');
  store.clear();
  // Another page navigated to must never replace the cached Command Center.
  online = true;
  const other = fetchEvent('http://localhost:4321/other.html', { mode: 'same-origin' });
  listeners.fetch(other);
  assert.equal(other.responded, null, 'non-root navigations are not intercepted');
  assert.equal(store.has('/'), false);
  online = false;
  const ev3 = fetchEvent('http://localhost:4321/');
  listeners.fetch(ev3);
  const res = await ev3.responded;
  assert.equal(res.status, 503);
  assert.match(await res.text(), /offline/);
});

test('offline copy of the page never stores the owner token', async () => {
  const page = '<script>window.__WHALYOM_LOCAL__={"token":"0123456789abcdef0123456789abcdef","port":4321};</script><p>cc</p>';
  const { listeners, store, ctx } = loadSw({ fetchImpl: async () => new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }) });
  const ev = fetchEvent('http://localhost:4321/');
  listeners.fetch(ev);
  assert.match(await (await ev.responded).text(), /0123456789abcdef/, 'the live page keeps its token');
  const cached = await store.get('/').text();
  assert.doesNotMatch(cached, /0123456789abcdef/);
  assert.match(cached, /"token":""/);
  assert.equal(ctx.scrubToken('{"token" : "abc"}'), '{"token" : ""}');
});

const message = async (listeners, data) => {
  let done = null;
  listeners.message({ data, waitUntil: (p) => { done = p; } });
  return done ? await done : undefined;
};

test('decision-waiting message shows one local notification, only with permission', async () => {
  const { listeners, shown, notes, ctx } = loadSw();
  assert.equal(await message(listeners, { type: 'decision-waiting', count: 2 }), 'shown');
  assert.equal(shown[0].title, 'Whalyom: 2 decisions waiting');
  assert.equal(shown[0].tag, 'whalyom-decision');
  assert.equal(shown[0].data.url, '/');
  assert.equal(await message(listeners, { type: 'decision-waiting', count: 2 }), 'unchanged');
  assert.equal(await message(listeners, { type: 'decision-waiting', count: 3, title: 'Approve\u0000 the launch post' }), 'shown');
  assert.equal(shown[1].body, 'Approve the launch post');
  assert.equal(await message(listeners, { type: 'decision-waiting', count: 1 }), 'updated');
  assert.equal(shown[2].title, 'Whalyom: decision waiting');
  assert.equal(shown[2].renotify, false, 'fewer waiting corrects the count without a new alert');
  assert.equal(await message(listeners, { type: 'decision-waiting', count: 0 }), 'cleared');
  assert.equal(notes.length, 0);
  assert.equal(await message(listeners, { type: 'something-else' }), undefined);
  assert.equal(await message(listeners, null), undefined);
  assert.equal(ctx.parseDecisionMessage({ type: 'decision-waiting', count: 'abc' }).count, 0);
  assert.equal(ctx.parseDecisionMessage({ type: 'decision-waiting', count: 1e9 }).count, 999);
  assert.equal(ctx.parseDecisionMessage({ type: 'decision-waiting', count: 1 }).title, 'Whalyom: decision waiting');

  const denied = loadSw({ permission: 'denied' });
  assert.equal(await message(denied.listeners, { type: 'decision-waiting', count: 1 }), 'no-permission');
  assert.equal(denied.shown.length, 0);
});
