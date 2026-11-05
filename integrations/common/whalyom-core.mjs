// Whalyom edge core — the Satellite protocol for fetch-API runtimes (Cloudflare Workers, Vercel/Next.js
// route handlers, Netlify edge functions, Deno, Bun, Node 20+). Zero dependencies; Web Crypto only.
//
// Speaks the same protocol as tools/satellite/whalyom-satellite.mjs, read-only:
//   GET  <trackerPath>        the tracker (if trackerJs is given)
//   POST <collectPath>        public beacon (rate-limited, de-duplicated, honeypot, Origin allow-list)
//   GET  <prefix>/health      signed (v2 only: ts + nonce + HMAC), response signed
//   GET  <prefix>/events      signed, ?since=ISO
// File reads and writes are deliberately not offered here: an edge function has no site root.
//
// Usage:
//   import { createHandler, memoryStore } from './whalyom-core.mjs';
//   const handle = createHandler({ secret, store, origins: ['https://example.test'], trackerJs });
//   const res = await handle(request);   // a Response, or null when the path is not Whalyom's
export const CORE_VERSION = '1.1.0';
export const EVENT_TYPES = ['pageview', 'lead', 'conversion', 'click', 'signup', 'checkout', 'scroll', 'cta', 'form_submit', 'outbound', 'vitals'];

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const keyCache = new Map();
async function hmacHex(secret, message) {
  let key = keyCache.get(secret);
  if (!key) { key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); keyCache.clear(); keyCache.set(secret, key); }
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
// Constant-time for equal-length input; the length of an HMAC-SHA256 hex digest (64) is public.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export const signV2 = (secret, ts, nonce, method, pathAndQuery, body) => hmacHex(secret, `${ts}\n${nonce}\n${method}\n${pathAndQuery}\n${body}`);
export const signResponse = (secret, nonce, status, body) => hmacHex(secret, `resp\n${nonce}\n${status}\n${body}`);

// --- event normalisation (keep in step with normalizeEvent in whalyom-satellite.mjs) --------------
const str = (v, n) => (v === undefined || v === null || typeof v === 'object') ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const num = (v, min, max) => { if (v === undefined || v === null || v === '' || typeof v === 'boolean' || typeof v === 'object') return undefined; const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
const cleanUrl = (v) => { const s = str(v, 500); if (!s) return ''; try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? (u.origin + u.pathname).slice(0, 300) : ''; } catch { return ''; } };
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;
export function normalizeEvent(ev, now = new Date()) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { error: 'bad event' };
  const type = str(ev.type, 20);
  if (!EVENT_TYPES.includes(type)) return { error: 'unknown type' };
  if (str(ev.hp, 200)) return { drop: 'honeypot' };
  const utm = { source: str(ev.utm?.source, 80), medium: str(ev.utm?.medium, 80), campaign: str(ev.utm?.campaign, 120) };
  const term = str(ev.utm?.term, 120); const content = str(ev.utm?.content, 120);
  if (term) utm.term = term;
  if (content) utm.content = content;
  const out = { at: now.toISOString(), type, path: str(ev.path, 300).split(/[?#]/)[0], ref: cleanUrl(ev.ref), utm };
  const eid = str(ev.eid, 40); if (/^[A-Za-z0-9_-]{8,40}$/.test(eid)) out.eid = eid;
  const site = str(ev.site, 60); if (site) out.site = site;
  if (['conversion', 'checkout', 'signup', 'lead'].includes(type)) { const v = num(ev.value, 0, 1e9); if (v !== undefined) out.value = v; }
  if (ev.form !== undefined && ev.form !== null && ev.form !== '') out.form = str(ev.form, 60);
  if (type === 'scroll') { const dpt = num(ev.depth, 0, 100); if (dpt === undefined) return { error: 'bad depth' }; out.depth = Math.round(dpt); }
  if (type === 'cta' || type === 'click') { const l = str(ev.label, 80); if (l) out.label = l; }
  if (type === 'outbound') { const h = str(ev.href, 300).replace(/^https?:\/\//, '').split(/[/?#]/)[0].toLowerCase(); if (!/^[a-z0-9.-]+(:\d+)?$/.test(h)) return { error: 'bad href' }; out.href = h; }
  if (type === 'vitals') {
    const lcp = num(ev.lcp, 0, 120000); const cls = num(ev.cls, 0, 100); const inp = num(ev.inp, 0, 120000);
    if (lcp === undefined && cls === undefined && inp === undefined) return { error: 'no vitals' };
    if (lcp !== undefined) out.lcp = Math.round(lcp);
    if (cls !== undefined) out.cls = Math.round(cls * 1000) / 1000;
    if (inp !== undefined) out.inp = Math.round(inp);
  }
  if (type === 'lead' || type === 'signup') {
    // Personal fields are kept only with explicit consent (consent === true); otherwise the lead is counted without them.
    const c = {};
    if (ev.consent === true) {
    const email = str(ev.email, 254).toLowerCase(); if (email && EMAIL.test(email)) c.email = email;
    const name = str(ev.name, 120); if (name) c.name = name;
    const company = str(ev.company, 120); if (company) c.company = company;
    const phone = str(ev.phone, 40).replace(/[^0-9+()\-. ]/g, ''); if (phone.replace(/\D/g, '').length >= 5) c.phone = phone;
    const message = str(ev.message, 1000); if (message) c.message = message;
    }
    if (Object.keys(c).length) { out.contact = c; out.consent = true; }
    if (ev.fast) out.bot_hint = 'fast-submit';
  }
  return { event: out };
}

// --- per-isolate helpers (best effort: each edge isolate has its own memory) -----------------------
export function rateLimiter(limit, windowMs, maxKeys = 20000) {
  const hits = new Map();
  const fn = (key, now = Date.now()) => {
    const h = (hits.get(key) ?? []).filter((t) => now - t < windowMs); h.push(now); hits.delete(key); hits.set(key, h);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return h.length > limit;
  };
  fn.peek = (key, now = Date.now()) => (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
  return fn;
}

// --- stores -------------------------------------------------------------------------------------
// A store has: append(event), list(since, limit), claimNonce(nonce, ttlSec) -> true if new,
// claimEid(eid) -> true if new, count(), last() -> ISO time of the newest event (or null).
export function memoryStore() {
  const events = []; const nonces = new Map(); const eids = new Set();
  return {
    kind: 'memory',
    async append(e) { events.push(e); if (events.length > 50000) events.splice(0, events.length - 50000); },
    async list(since = '', limit = 20000) { return events.filter((e) => e.at > since).slice(0, limit); },
    async claimNonce(n, ttl = 600) { const now = Date.now(); for (const [k, exp] of nonces) { if (exp > now) break; nonces.delete(k); } if (nonces.has(n) && nonces.get(n) > now) return false; nonces.set(n, now + ttl * 1000); return true; },
    async claimEid(id) { if (eids.has(id)) return false; eids.add(id); if (eids.size > 100000) eids.delete(eids.values().next().value); return true; },
    async count() { return events.length; },
    async last() { return events.at(-1)?.at ?? null; },
  };
}
// Cloudflare Workers KV (binding). Keys sort by time: ev:<ISO at>:<eid>. KV is eventually consistent,
// so replay and de-dupe checks are best effort across colos (the timestamp window still applies).
export function kvStore(kv, { retentionDays = 90 } = {}) {
  return {
    kind: 'kv',
    async append(e) { await kv.put(`ev:${e.at}:${e.eid ?? Math.random().toString(36).slice(2)}`, JSON.stringify(e), { expirationTtl: retentionDays * 86400 }); },
    async list(since = '', limit = 1000) {
      const out = []; let cursor;
      do {
        const page = await kv.list({ prefix: 'ev:', cursor, limit: 1000 });
        for (const k of page.keys) { const at = k.name.slice(3, 27); if (at > since) out.push(k.name); }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor && out.length < limit);
      const vals = await Promise.all(out.slice(0, limit).map((k) => kv.get(k, 'json')));
      return vals.filter(Boolean).sort((a, b) => (a.at < b.at ? -1 : 1));
    },
    async claimNonce(n, ttl = 600) { const k = `nonce:${n}`; if (await kv.get(k)) return false; await kv.put(k, '1', { expirationTtl: Math.max(60, ttl) }); return true; },
    async claimEid(id) { const k = `eid:${id}`; if (await kv.get(k)) return false; await kv.put(k, '1', { expirationTtl: 86400 }); return true; },
    async last() { return null; },
    async count() { let n = 0; let cursor; do { const p = await kv.list({ prefix: 'ev:', cursor }); n += p.keys.length; cursor = p.list_complete ? undefined : p.cursor; } while (cursor); return n; },
  };
}
// Cloudflare D1 (placeholder adapter, untested here). Schema:
//   CREATE TABLE IF NOT EXISTS whalyom_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, eid TEXT UNIQUE, data TEXT NOT NULL);
//   CREATE INDEX IF NOT EXISTS whalyom_events_at ON whalyom_events(at);
//   CREATE TABLE IF NOT EXISTS whalyom_nonces (nonce TEXT PRIMARY KEY, exp INTEGER NOT NULL);
export function d1Store(db) {
  return {
    kind: 'd1',
    async append(e) { await db.prepare('INSERT OR IGNORE INTO whalyom_events (at, eid, data) VALUES (?1, ?2, ?3)').bind(e.at, e.eid ?? null, JSON.stringify(e)).run(); },
    async list(since = '', limit = 20000) { const r = await db.prepare('SELECT data FROM whalyom_events WHERE at > ?1 ORDER BY id LIMIT ?2').bind(since, limit).all(); return (r.results ?? []).map((x) => JSON.parse(x.data)); },
    async claimNonce(n, ttl = 600) { const now = Date.now(); await db.prepare('DELETE FROM whalyom_nonces WHERE exp < ?1').bind(now).run(); const r = await db.prepare('INSERT OR IGNORE INTO whalyom_nonces (nonce, exp) VALUES (?1, ?2)').bind(n, now + ttl * 1000).run(); return (r.meta?.changes ?? 0) > 0; },
    async claimEid(id) { const r = await db.prepare('SELECT 1 FROM whalyom_events WHERE eid = ?1').bind(id).first(); return !r; },
    async count() { const r = await db.prepare('SELECT COUNT(*) AS n FROM whalyom_events').first(); return r?.n ?? 0; },
    async last() { const r = await db.prepare('SELECT MAX(at) AS at FROM whalyom_events').first(); return r?.at ?? null; },
  };
}
// Upstash Redis / Vercel KV over REST (KV_REST_API_URL + KV_REST_API_TOKEN). No SDK needed.
export function upstashStore(url, token, { key = 'whalyom', maxEvents = 50000, fetchImpl = fetch } = {}) {
  const cmd = async (...args) => { const r = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j.result; };
  return {
    kind: 'upstash',
    async append(e) { await cmd('RPUSH', `${key}:events`, JSON.stringify(e)); await cmd('LTRIM', `${key}:events`, -maxEvents, -1); },
    async list(since = '', limit = 20000) { const all = (await cmd('LRANGE', `${key}:events`, 0, -1)) ?? []; return all.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter((e) => e && e.at > since).slice(0, limit); },
    async claimNonce(n, ttl = 600) { return (await cmd('SET', `${key}:nonce:${n}`, '1', 'NX', 'EX', ttl)) === 'OK'; },
    async claimEid(id) { return (await cmd('SET', `${key}:eid:${id}`, '1', 'NX', 'EX', 86400)) === 'OK'; },
    async count() { return (await cmd('LLEN', `${key}:events`)) ?? 0; },
    async last() { const s = await cmd('LINDEX', `${key}:events`, -1); try { return s ? JSON.parse(s).at : null; } catch { return null; } },
  };
}

// --- the handler ----------------------------------------------------------------------------------
export function clientIp(request) {
  const h = request.headers;
  return h.get('cf-connecting-ip') || h.get('x-nf-client-connection-ip') || h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean).at(-1) || '';
}
const jsonResponse = (code, obj, headers = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

export function createHandler(opts) {
  const prefix = (opts.prefix ?? '/_whalyom').replace(/\/$/, '');
  const collectPath = opts.collectPath ?? '/collect';
  const trackerPath = opts.trackerPath ?? '/whalyom.js';
  const origins = (opts.origins ?? []).map((o) => String(o).trim().replace(/\/$/, '').toLowerCase()).filter(Boolean);
  const maxSkew = opts.maxSkewMs ?? 5 * 60 * 1000;
  const store = opts.store ?? memoryStore();
  const getIp = opts.getIp ?? clientIp;
  const collectLimited = rateLimiter(opts.collectPerMinute ?? 120, 60000);
  const leadLimited = rateLimiter(opts.leadsPer10Min ?? 5, 600000);
  const badSig = rateLimiter(opts.badSigPerMinute ?? 20, 60000);
  const kind = opts.kind ?? 'edge';

  const cors = (request) => {
    const o = (request.headers.get('origin') || '').replace(/\/$/, '').toLowerCase();
    if (!origins.length) return { allowed: true, headers: { 'access-control-allow-origin': '*' } };
    if (!o) return { allowed: true, headers: {} };
    if (origins.includes(o)) return { allowed: true, headers: { 'access-control-allow-origin': request.headers.get('origin'), vary: 'Origin' } };
    return { allowed: false, headers: { vary: 'Origin' } };
  };
  const readLimited = async (request, limit) => {
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > limit) return null;
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength > limit) return null;
    return new TextDecoder().decode(buf);
  };

  return async function handle(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const ip = getIp(request);
    if (opts.trackerJs && p === trackerPath && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(request.method === 'HEAD' ? null : opts.trackerJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
    }
    if (p === collectPath) {
      const c = cors(request);
      if (request.method === 'OPTIONS') return new Response(null, { status: c.allowed ? 204 : 403, headers: { ...c.headers, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
      if (request.method !== 'POST') return jsonResponse(405, { error: 'POST only' });
      if (!c.allowed) return jsonResponse(403, { error: 'origin not allowed' }, c.headers);
      if (collectLimited(ip)) return jsonResponse(429, { error: 'slow down' }, { ...c.headers, 'retry-after': '60' });
      const raw = await readLimited(request, 8000);
      if (raw === null) return jsonResponse(413, { error: 'body too large' }, c.headers);
      let ev; try { ev = JSON.parse(raw); } catch { return jsonResponse(400, { error: 'bad json' }, c.headers); }
      const r = normalizeEvent(ev);
      if (r.error) return jsonResponse(400, { error: r.error }, c.headers);
      if (r.drop) return new Response(null, { status: 204, headers: c.headers });
      if (r.event.eid && !(await store.claimEid(r.event.eid))) return new Response(null, { status: 204, headers: c.headers });
      if ((r.event.type === 'lead' || r.event.type === 'signup') && leadLimited(ip)) return jsonResponse(429, { error: 'too many leads' }, { ...c.headers, 'retry-after': '600' });
      await store.append(r.event);
      return new Response(null, { status: 204, headers: c.headers });
    }
    if (!p.startsWith(`${prefix}/`)) return null;
    if (badSig.peek(ip)) return jsonResponse(429, { error: 'slow down' });
    const secret = typeof opts.secret === 'function' ? await opts.secret() : opts.secret;
    if (!secret || secret.length < 32) return jsonResponse(503, { error: 'not configured: set WHALYOM_SECRET (32+ characters)' });
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await readLimited(request, 100000);
    if (body === null) return jsonResponse(413, { error: 'body too large' });
    const h = request.headers;
    const tsRaw = h.get('x-whalyom-ts') || ''; const ts = /^\d{10,16}$/.test(tsRaw) ? Number(tsRaw) : 0;
    const nonce = h.get('x-whalyom-nonce') || ''; const sig = h.get('x-whalyom-sig') || '';
    let why = null;
    if (!ts || Math.abs(Date.now() - ts) > maxSkew || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) why = 'bad signature';
    else if (!safeEqual(sig.toLowerCase(), await signV2(secret, ts, nonce, request.method, p + url.search, body))) why = 'bad signature';
    else if (!(await store.claimNonce(nonce, Math.ceil((maxSkew * 2) / 1000) + 60))) why = 'replayed request';
    if (why) { badSig(ip); return jsonResponse(401, { error: why, sig_versions: [2] }); }
    const ok = async (obj) => { const text = JSON.stringify(obj); return new Response(text, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-whalyom-resp-sig': await signResponse(secret, nonce, 200, text) } }); };
    if (p === `${prefix}/health` && request.method === 'GET') {
      return ok({ ok: true, version: CORE_VERSION, kind, store: store.kind, root: opts.siteId ?? '', writes: false, strict: true, events: await store.count(), last_event: store.last ? await store.last() : null, time: Date.now(), sig_versions: [2], origins: origins.length });
    }
    if (p === `${prefix}/events` && request.method === 'GET') {
      const since = url.searchParams.get('since') ?? '';
      const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get('limit') ?? 20000) || 20000));
      const events = await store.list(since, limit);
      return ok({ events, until: events.at(-1)?.at ?? since });
    }
    return jsonResponse(404, { error: 'not found (this endpoint is read-only: no files or apply)' });
  };
}
