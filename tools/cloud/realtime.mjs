// Real-time feed from the cloud hub: the same live documents the local Command Center streams
// (state/live-*.json), served by the edge the moment they change.
//   GET /live/stream[?docs=events,agents]   Server-Sent Events: one "doc" event per document on connect,
//                                            then one each time a document changes (fs.watch, debounced)
//   GET /live/<doc>                          the current document as JSON {path, data}
//   OPTIONS /live/...                        CORS preflight (token auth, no cookies, so origin "*" is safe)
// Auth: a tenant API key (wyk_..., tools/cloud/tenants.mjs) or the owner token (WHALYOM_OWNER_TOKEN,
// 16+ characters), as "Authorization: Bearer <token>" or ?token=<token> (EventSource cannot set headers).
// Tokens are never logged, echoed or written anywhere.
// Tenant scope: a tenant sees only rows of its own products (field product or slug); owner-wide docs
// (integrations: which keys the hub has) and global counters are owner-only. The owner sees everything.
// Privacy: the docs are already whitelisted by tools/server.mjs and tools/live-snapshot.mjs; this module
// still drops personal-data keys (email, phone, ip, name of a person, tokens) and redacts email addresses
// and phone numbers in every string before anything leaves the hub.
// Limits: maxClients streams in total, maxPerPrincipal per token, a heartbeat comment every heartbeatMs.
// Mount: const live = createRealtime({ root, tenants }); in the edge request handler,
//   if (live.handle(req, res, url)) return;      and live.close() when the server closes.
// CLI:   node tools/cloud/realtime.mjs docs
//        node tools/cloud/realtime.mjs view <doc> [--products slug1,slug2]   (owner view without --products)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, root as repoRoot } from '../lib/env.mjs';

// The same documents tools/server.mjs streams to the local Command Center.
export const LIVE_DOCS = ['roster', 'agents', 'events', 'state', 'nyk', 'graph', 'transitions', 'products', 'sites', 'funnel', 'sequences', 'leadscores', 'attribution', 'aivisibility', 'integrations'];
// Documents only the owner may read: they describe the hub itself, not a product.
export const OWNER_ONLY = new Set(['integrations']);
// Documents with no product data at all (the public agent catalog): the same for everyone.
const SHARED = new Set(['roster']);

const PII_KEY = /^(e-?mail|email_address|phone|phone_number|mobile|tel|ip|ip_address|remote_addr|user_agent|ua|first_name|last_name|full_name|contact_name|address|street|password|passcode|token|secret|api_key|apikey|access_token|refresh_token|authorization|cookie|session_id|visitor_id|vid|lead_email|customer_email)$/i;
const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;
const PHONE_RE = /\+\d[\d\s().-]{7,}\d/g;

// Removes personal-data keys and redacts emails and phone numbers in strings, at any depth.
export function scrub(v, depth = 0) {
  if (depth > 12) return null;
  if (typeof v === 'string') return v.replace(EMAIL_RE, '[redacted]').replace(PHONE_RE, '[redacted]');
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!PII_KEY.test(k)) out[k] = scrub(x, depth + 1);
    return out;
  }
  return v;
}

const productOf = (row) => (row && typeof row === 'object' ? (typeof row.product === 'string' ? row.product : typeof row.slug === 'string' ? row.slug : null) : null);

// A document as one tenant may see it. products: Set of the tenant's slugs. Returns null when the tenant
// may not read this document at all.
export function tenantView(name, doc, products) {
  if (!doc || typeof doc !== 'object') return null;
  if (OWNER_ONLY.has(name)) return null;
  if (SHARED.has(name)) return doc;
  const mine = (row) => { const p = productOf(row); return p != null && products.has(p); };
  if (name === 'agents') {
    const agents = doc.agents && typeof doc.agents === 'object' ? doc.agents : {};
    return { ...doc, agents: Object.fromEntries(Object.entries(agents).filter(([, a]) => mine(a))) };
  }
  if (name === 'state') {
    // The run indicator belongs to one product; the counters span every product, so a tenant gets none.
    const own = typeof doc.product === 'string' ? products.has(doc.product) : doc.product && typeof doc.product === 'object' ? mine(doc.product) : false;
    return { updated_at: doc.updated_at ?? null, mode: own ? doc.mode ?? null : 'idle', run: own ? doc.run ?? null : null, phase: own ? doc.phase ?? null : null, product: own ? doc.product : null, note: own ? doc.note ?? null : null, counts: null };
  }
  if (name === 'graph') {
    const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
    const keep = new Set(nodes.filter((n) => mine(n) || (n?.type === 'product' && typeof n.id === 'string' && products.has(n.id.replace(/^p:/, '')))).map((n) => n.id));
    const edges = (Array.isArray(doc.edges) ? doc.edges : []).filter((e) => keep.has(e?.from) || keep.has(e?.to));
    // Agents and pods carry no product: they stay only when an edge ties them to one of the tenant's nodes.
    for (const e of edges) { keep.add(e.from); keep.add(e.to); }
    const kept = nodes.filter((n) => keep.has(n?.id) && (productOf(n) == null || mine(n)));
    const ids = new Set(kept.map((n) => n.id));
    const keptEdges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const counts = {}; for (const n of kept) counts[n.type] = (counts[n.type] ?? 0) + 1;
    return { ...doc, nodes: kept, edges: keptEdges, counts };
  }
  // Every other document: arrays of rows keyed by product or slug. Rows without a product are hub-wide
  // and stay out; scalar fields (updated_at, source, window_days) pass through.
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (Array.isArray(v)) out[k] = v.filter(mine);
    else if (v && typeof v === 'object') out[k] = null; // hub-wide totals or nested maps: owner only
    else out[k] = v;
  }
  return out;
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const BLOCKED = new Set(['canceled', 'cancelled', 'suspended', 'deleted']);
// A positive integer option, or the default when it is missing, zero, negative or not a number
// (a typo in OM_LIVE_MAX_CLIENTS must never turn the limits off).
const posInt = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };
// A stream whose socket buffer grows past this is a reader that stopped reading: it is dropped.
const MAX_BUFFER = 1024 * 1024;

export function createRealtime(options = {}) {
  const ROOT = options.root ?? repoRoot;
  const STATE = options.stateDir ?? path.join(ROOT, 'state');
  const ENV = options.env ?? process.env;
  const OWNER = String(options.ownerToken ?? ENV.WHALYOM_OWNER_TOKEN ?? '');
  const ownerOn = OWNER.length >= 16;
  const MAX = posInt(options.maxClients ?? ENV.OM_LIVE_MAX_CLIENTS, 100);
  const PER = posInt(options.maxPerPrincipal, 5);
  const BEAT = posInt(options.heartbeatMs, 20000);
  const DEBOUNCE = posInt(options.debounceMs, 250);
  // How often an open stream re-checks its token: a canceled tenant, a removed product or a rotated
  // tenant key stops the feed within this window (checked before any document is sent).
  const RECHECK = posInt(options.recheckMs, 5000);
  const tenants = typeof options.tenants === 'function' ? options.tenants : () => options.tenants ?? null;
  const watchFn = options.watch ?? fs.watch;

  const clients = new Set(); // {res, principal, docs:Set, last:Map(name -> hash), ping}
  const timers = new Map();
  let watcher = null;

  const tokenOf = (req, url) => {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers?.authorization ?? ''));
    return m ? m[1] : url.searchParams.get('token') || '';
  };
  // Returns {kind:'owner', key} | {kind:'tenant', key, products:Set} | null. key identifies the
  // principal for the per-token limit without keeping the token itself.
  const principal = (token) => {
    if (!token || token.length > 200) return null;
    if (ownerOn && sameSecret(token, OWNER)) return { kind: 'owner', key: 'owner' };
    const store = tenants();
    const t = store?.authTenant?.(token);
    if (!t || BLOCKED.has(String(t.status ?? '').toLowerCase())) return null;
    return { kind: 'tenant', key: `t:${t.id}`, products: new Set(Array.isArray(t.products) ? t.products.filter((s) => typeof s === 'string') : []) };
  };

  const read = (name) => readJson(path.join(STATE, `live-${name}.json`), null);
  const view = (name, doc, who) => {
    if (doc == null) return null;
    const v = who.kind === 'owner' ? doc : tenantView(name, doc, who.products);
    return v == null ? null : scrub(v);
  };
  const allowedDocs = (who) => LIVE_DOCS.filter((n) => who.kind === 'owner' || !OWNER_ONLY.has(n));

  const HEAD = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, last-event-id', 'access-control-allow-methods': 'GET, OPTIONS' };
  const json = (res, code, obj, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...HEAD, ...extra }); res.end(JSON.stringify(obj)); };

  // Re-resolves the stream's token (kept in memory only, never logged or written). Closes the stream
  // when the token no longer grants access; refreshes the product scope otherwise.
  const stillAllowed = (c, force = false) => {
    if (!force && Date.now() - c.checkedAt < RECHECK) return true;
    c.checkedAt = Date.now();
    let who = null;
    try { who = principal(c.token); } catch { who = null; }
    if (!who || who.key !== c.principal.key) { drop(c); return false; }
    c.principal = who;
    return true;
  };
  const push = (c, name, doc) => {
    if (!clients.has(c) || !stillAllowed(c)) return;
    if ((c.res.writableLength ?? 0) > MAX_BUFFER) { drop(c); return; }
    const data = view(name, doc, c.principal);
    if (data == null) return;
    const text = JSON.stringify({ path: `live/${name}`, data });
    const h = crypto.createHash('sha1').update(text).digest('hex');
    if (c.last.get(name) === h) return; // unchanged for this viewer (another tenant's row moved)
    c.last.set(name, h);
    try { c.res.write(`event: doc\ndata: ${text}\n\n`); } catch { drop(c); }
  };
  const broadcast = (name) => {
    if (!LIVE_DOCS.includes(name)) return;
    const doc = read(name); // a file caught mid-write fails to parse; the next change event resends
    if (doc == null) return;
    for (const c of clients) if (c.docs.has(name)) push(c, name, doc);
  };
  const schedule = (name) => { clearTimeout(timers.get(name)); const t = setTimeout(() => { timers.delete(name); broadcast(name); }, DEBOUNCE); t.unref?.(); timers.set(name, t); };

  const startWatch = () => {
    if (watcher || !fs.existsSync(STATE)) return;
    try {
      watcher = watchFn(STATE, (ev, file) => { const m = file && String(file).match(/^live-([a-z]+)\.json$/); if (m) schedule(m[1]); });
      watcher.on?.('error', () => { try { watcher?.close(); } catch { /* already closed */ } watcher = null; });
    } catch { watcher = null; }
  };
  const stopWatch = () => { if (!clients.size && watcher) { try { watcher.close(); } catch { /* already closed */ } watcher = null; } };
  function drop(c) {
    if (!clients.delete(c)) return;
    clearInterval(c.ping);
    try { c.res.end(); } catch { /* socket gone */ }
    stopWatch();
  }

  function handle(req, res, url) {
    if (!url || !url.pathname.startsWith('/live/')) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...HEAD, 'access-control-max-age': '86400' }); res.end(); return true; }
    if (req.method !== 'GET') { json(res, 405, { error: 'GET only' }, { allow: 'GET, OPTIONS' }); return true; }
    const who = principal(tokenOf(req, url));
    if (!who) { json(res, 401, { error: 'a tenant API key or the owner token is required' }, { 'www-authenticate': 'Bearer' }); return true; }
    const docs = allowedDocs(who);

    if (url.pathname === '/live/stream') {
      const want = url.searchParams.get('docs');
      const picked = want ? want.split(',').map((s) => s.trim()).filter((s) => docs.includes(s)) : docs;
      if (want && !picked.length) { json(res, 400, { error: 'no readable documents requested', docs }); return true; }
      if (clients.size >= MAX) { json(res, 503, { error: 'live feed is full; try again shortly' }, { 'retry-after': '30' }); return true; }
      let mine = 0; for (const c of clients) if (c.principal.key === who.key) mine++;
      if (mine >= PER) { json(res, 429, { error: `at most ${PER} live streams per account` }, { 'retry-after': '30' }); return true; }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no', ...HEAD, 'cache-control': 'no-cache, no-store' });
      res.write(`retry: 5000\n: whalyom live (${who.kind})\n\n`);
      const c = { res, principal: who, token: tokenOf(req, url), checkedAt: Date.now(), docs: new Set(picked), last: new Map(), ping: null };
      c.ping = setInterval(() => {
        if (!stillAllowed(c, true)) return;
        if ((res.writableLength ?? 0) > MAX_BUFFER) { drop(c); return; }
        try { res.write(': ping\n\n'); } catch { drop(c); }
      }, BEAT);
      c.ping.unref?.();
      clients.add(c);
      startWatch();
      for (const n of picked) { const d = read(n); if (d != null) push(c, n, d); }
      req.on?.('close', () => drop(c));
      res.on?.('close', () => drop(c));
      return true;
    }

    const name = url.pathname.slice('/live/'.length);
    if (!/^[a-z]{1,30}$/.test(name) || !LIVE_DOCS.includes(name)) { json(res, 404, { error: 'unknown live document', docs }); return true; }
    if (!docs.includes(name)) { json(res, 403, { error: 'this document is owner-only' }); return true; }
    const data = view(name, read(name), who);
    if (data == null) { json(res, 404, { error: 'not built yet' }); return true; }
    json(res, 200, { path: `live/${name}`, data });
    return true;
  }

  function close() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    for (const c of [...clients]) drop(c);
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } watcher = null; }
  }

  return { handle, close, notify: schedule, stats: () => ({ clients: clients.size, watching: Boolean(watcher), max: MAX, per_account: PER }) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, name] = process.argv.slice(2);
  const pi = process.argv.indexOf('--products');
  if (cmd === 'docs') console.log(LIVE_DOCS.map((d) => `${d}${OWNER_ONLY.has(d) ? '  (owner only)' : ''}`).join('\n'));
  else if (cmd === 'view' && LIVE_DOCS.includes(name)) {
    const doc = readJson(path.join(repoRoot, 'state', `live-${name}.json`), null);
    if (doc == null) { console.error(`state/live-${name}.json is not built yet`); process.exit(1); }
    const v = pi > 0 ? tenantView(name, doc, new Set(String(process.argv[pi + 1] ?? '').split(',').filter(Boolean))) : doc;
    console.log(v == null ? '(not readable for a tenant)' : JSON.stringify(scrub(v), null, 2));
  } else { console.error('Usage: node tools/cloud/realtime.mjs docs | view <doc> [--products slug1,slug2]'); process.exit(2); }
}
