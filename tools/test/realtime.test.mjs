// Cloud real-time feed (tools/cloud/realtime.mjs): auth, tenant scope, privacy, SSE streaming on change,
// heartbeats and client limits. Temp root, a fake tenant store, an injected watcher: no network beyond
// 127.0.0.1, nothing written to the repo.
// Run alone with: node --test tools/test/realtime.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRealtime, tenantView, scrub, LIVE_DOCS } from '../cloud/realtime.mjs';

const OWNER = 'owner-test-token-0123456789';
const TA = 'wyk_t0000000aaa_' + 'a'.repeat(48);
const TB = 'wyk_t0000000bbb_' + 'b'.repeat(48);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-realtime-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const state = path.join(tmp, 'state');
fs.mkdirSync(state, { recursive: true });
const put = (name, doc) => fs.writeFileSync(path.join(state, `live-${name}.json`), JSON.stringify(doc));

put('events', { updated_at: '2026-11-04T10:00:00Z', events: [
  { at: '2026-11-04T09:00:00Z', product: 'ta-shop', agent: 'om-cro', text: 'Lead jane@example.com called +1 555 123 4567', email: 'jane@example.com' },
  { at: '2026-11-04T09:01:00Z', product: 'tb-shop', agent: 'om-seo', text: 'B private row' },
  { at: '2026-11-04T09:02:00Z', agent: 'om-reporter', text: 'hub-wide row' },
] });
put('products', { updated_at: 'x', products: [{ slug: 'ta-shop', name: 'A' }, { slug: 'tb-shop', name: 'B' }] });
put('agents', { updated_at: 'x', agents: { 'om-cro': { product: 'ta-shop', status: 'running' }, 'om-seo': { product: 'tb-shop', status: 'done' } } });
put('state', { updated_at: 'x', mode: 'running', run: { id: 'r1' }, phase: 'wave', product: 'tb-shop', note: 'B note', counts: { products: 2 } });
put('integrations', { updated_at: 'x', totals: { configured: 3 }, integrations: [{ name: 'stripe', configured: true }] });
put('roster', { updated_at: 'x', total: 2, pods: [{ key: 'command', agents: [] }] });
put('graph', { updated_at: 'x', nodes: [
  { id: 'p:ta-shop', type: 'product' }, { id: 'p:tb-shop', type: 'product' },
  { id: 't:ta-shop:G1', type: 'task', product: 'ta-shop' }, { id: 't:tb-shop:G2', type: 'task', product: 'tb-shop' },
  { id: 'a:om-cro', type: 'agent' }, { id: 'a:om-seo', type: 'agent' },
], edges: [{ from: 'p:ta-shop', to: 't:ta-shop:G1' }, { from: 't:ta-shop:G1', to: 'a:om-cro' }, { from: 't:tb-shop:G2', to: 'a:om-seo' }], counts: {} });

const tenantsStore = { authTenant: (k) => (k === TA ? { id: 't0000000aaa', status: 'active', products: ['ta-shop'] } : k === TB ? { id: 't0000000bbb', status: 'canceled', products: ['tb-shop'] } : null) };

let fire = null;
const watch = (dir, cb) => { fire = cb; return { close() { fire = null; }, on() {} }; };
const live = createRealtime({ root: tmp, stateDir: state, ownerToken: OWNER, env: {}, tenants: tenantsStore, maxClients: 3, maxPerPrincipal: 2, heartbeatMs: 40, debounceMs: 20, watch });
const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://edge'); if (!live.handle(req, res, url)) { res.writeHead(418); res.end(); } });
let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { live.close(); server.closeAllConnections?.(); return new Promise((r) => server.close(r)); });

const get = async (p, token, bearer = true) => {
  const headers = token && bearer ? { authorization: `Bearer ${token}` } : {};
  const u = token && !bearer ? `${base}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : `${base}${p}`;
  const r = await fetch(u, { headers });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};

// Opens an SSE stream and collects parsed events and comment lines until stop() is called.
function stream(query, token) {
  const ac = new AbortController();
  const got = { docs: [], comments: [], status: 0 };
  const done = (async () => {
    const r = await fetch(`${base}/live/stream${query}`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
    got.status = r.status;
    if (r.status !== 200) return;
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of block.split('\n')) if (line.startsWith(':')) got.comments.push(line);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) got.docs.push(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  return { got, stop: async () => { ac.abort(); await done.catch(() => {}); }, ready: () => until(() => got.status !== 0) };
}
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('module exports the same live document list as the local Command Center', () => {
  assert.ok(LIVE_DOCS.includes('events') && LIVE_DOCS.includes('integrations') && LIVE_DOCS.length === 15);
});

test('handle ignores paths outside /live/', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 418);
});

test('no token, a wrong token and a canceled tenant are refused', async () => {
  assert.equal((await get('/live/events')).status, 401);
  assert.equal((await get('/live/events', 'nope-nope-nope-nope')).status, 401);
  assert.equal((await get('/live/events', TB)).status, 401);
  const r = await get('/live/events', 'x');
  assert.ok(!JSON.stringify(r.body).includes('x'.repeat(2)));
});

test('owner sees every row; personal data is still scrubbed', async () => {
  const r = await get('/live/events', OWNER);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.events.length, 3);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('jane@example.com') && !text.includes('555 123'));
  assert.ok(!('email' in r.body.data.events[0]));
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await get('/live/integrations', OWNER)).status, 200);
});

test('a tenant sees only its own products, via Bearer or ?token', async () => {
  for (const bearer of [true, false]) {
    const r = await get('/live/events', TA, bearer);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.events.map((e) => e.product), ['ta-shop']);
  }
  assert.deepEqual((await get('/live/products', TA)).body.data.products.map((p) => p.slug), ['ta-shop']);
  assert.deepEqual(Object.keys((await get('/live/agents', TA)).body.data.agents), ['om-cro']);
  const st = (await get('/live/state', TA)).body.data;
  assert.equal(st.product, null); assert.equal(st.note, null); assert.equal(st.counts, null); assert.equal(st.mode, 'idle');
  assert.equal((await get('/live/integrations', TA)).status, 403);
  assert.equal((await get('/live/roster', TA)).body.data.total, 2);
  assert.equal((await get('/live/nope', TA)).status, 404);
  assert.equal((await get('/live/sites', TA)).status, 404); // not built in this fixture
});

test('graph view keeps the tenant subgraph and the agents tied to it', () => {
  const g = JSON.parse(fs.readFileSync(path.join(state, 'live-graph.json'), 'utf8'));
  const v = tenantView('graph', g, new Set(['ta-shop']));
  assert.deepEqual(v.nodes.map((n) => n.id).sort(), ['a:om-cro', 'p:ta-shop', 't:ta-shop:G1']);
  assert.equal(v.edges.length, 2);
  assert.equal(v.counts.task, 1);
});

test('scrub drops personal keys at any depth', () => {
  assert.deepEqual(scrub({ a: { phone: '1', api_key: 'k', ok: 'mail me@x.io' } }), { a: { ok: 'mail [redacted]' } });
});

test('stream sends each readable doc on connect, then changes the moment they happen, scoped per viewer', async () => {
  const a = stream('?docs=events,integrations', TA);
  const o = stream('?docs=events', OWNER);
  await a.ready(); await o.ready();
  assert.equal(a.got.status, 200);
  await until(() => a.got.docs.length >= 1 && o.got.docs.length >= 1);
  assert.deepEqual(a.got.docs.map((d) => d.path), ['live/events']); // integrations is owner-only: filtered out
  assert.equal(a.got.docs[0].data.events.length, 1);

  // A change to another tenant's row: the owner gets it, tenant A's view is unchanged so nothing is sent.
  const ev = JSON.parse(fs.readFileSync(path.join(state, 'live-events.json'), 'utf8'));
  ev.events.push({ at: '2026-11-04T09:03:00Z', product: 'tb-shop', text: 'B again' });
  put('events', ev);
  fire('change', 'live-events.json');
  await until(() => o.got.docs.length >= 2);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(a.got.docs.length, 1);

  // A change to tenant A's row reaches A.
  ev.events.push({ at: '2026-11-04T09:04:00Z', product: 'ta-shop', text: 'A new' });
  put('events', ev);
  fire('change', 'live-events.json'); fire('change', 'live-events.json'); // debounced into one send
  await until(() => a.got.docs.length >= 2);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(a.got.docs.length, 2);
  assert.deepEqual(a.got.docs[1].data.events.map((e) => e.text), ['Lead [redacted] called [redacted]', 'A new']);
  assert.ok(a.got.comments.some((c) => c === ': ping'), 'heartbeat comments arrive');
  await a.stop(); await o.stop();
  await until(() => live.stats().clients === 0);
  assert.equal(live.stats().watching, false);
});

test('stream limits: per account and in total', async () => {
  const s1 = stream('', TA), s2 = stream('', TA);
  await s1.ready(); await s2.ready();
  const s3 = stream('', TA); await s3.ready();
  assert.equal(s3.got.status, 429);
  const o1 = stream('', OWNER); await o1.ready();
  assert.equal(o1.got.status, 200);
  const o2 = stream('', OWNER); await o2.ready();
  assert.equal(o2.got.status, 503);
  const bad = stream('?docs=integrations', TA); await bad.ready();
  assert.ok([400, 503].includes(bad.got.status));
  for (const s of [s1, s2, s3, o1, o2, bad]) await s.stop();
  await until(() => live.stats().clients === 0);
});

test('non-GET methods are refused and preflight answers', async () => {
  assert.equal((await fetch(`${base}/live/events`, { method: 'POST', headers: { authorization: `Bearer ${OWNER}` } })).status, 405);
  const p = await fetch(`${base}/live/stream`, { method: 'OPTIONS' });
  assert.equal(p.status, 204);
  assert.match(p.headers.get('access-control-allow-headers'), /authorization/);
});

test('an open stream stops when its tenant loses the product or is canceled', async () => {
  const TC = 'wyk_t0000000ccc_' + 'c'.repeat(48);
  const acct = { id: 't0000000ccc', status: 'active', products: ['ta-shop'] };
  const store = { authTenant: (k) => (k === TC ? { ...acct, products: [...acct.products] } : null) };
  const lv = createRealtime({ root: tmp, stateDir: state, ownerToken: OWNER, env: {}, tenants: store, heartbeatMs: 30, debounceMs: 10, recheckMs: 1, watch: () => ({ close() {}, on() {} }) });
  const srv = http.createServer((req, res) => { if (!lv.handle(req, res, new URL(req.url, 'http://edge'))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/live/stream?docs=events`, { headers: { authorization: `Bearer ${TC}` } });
    assert.equal(r.status, 200);
    const body = r.text();
    await until(() => lv.stats().clients === 1);
    // Product removed: the scope shrinks before the next push, so tenant A's rows stop flowing.
    acct.products = [];
    await new Promise((res) => setTimeout(res, 20));
    lv.notify('events');
    await new Promise((res) => setTimeout(res, 60));
    // Canceled: the next re-check closes the stream from the server side.
    acct.status = 'canceled';
    await until(() => lv.stats().clients === 0);
    const docs = (await body).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    assert.equal(docs.length, 2);
    assert.ok(docs[0].data.events.length >= 1 && docs[0].data.events.every((e) => e.product === 'ta-shop'));
    assert.equal(docs[1].data.events.length, 0);
  } finally {
    lv.close(); srv.closeAllConnections?.();
    await new Promise((res) => srv.close(res));
  }
});

test('invalid limit settings fall back to safe defaults instead of turning limits off', () => {
  const lv = createRealtime({ root: tmp, stateDir: state, ownerToken: OWNER, env: { OM_LIVE_MAX_CLIENTS: 'lots' }, tenants: tenantsStore, maxPerPrincipal: -1, watch });
  assert.deepEqual([lv.stats().max, lv.stats().per_account], [100, 5]);
  lv.close();
});

test('a short owner token never authenticates', () => {
  const lv = createRealtime({ root: tmp, stateDir: state, ownerToken: 'short', env: {}, tenants: null, watch });
  const res = { code: 0, writeHead(c) { this.code = c; }, end() {} };
  lv.handle({ method: 'GET', headers: { authorization: 'Bearer short' } }, res, new URL('http://edge/live/events'));
  assert.equal(res.code, 401);
  lv.close();
});
