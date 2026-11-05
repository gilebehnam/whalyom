// Edge site-facing routes: POST /chat, the bandit client and beacons, the inbound reply webhook, and the
// mounted cloud modules (live feed, agency and client routes, Twilio voice webhooks).
// Everything runs against a temp root with fixture products: no network, nothing written to the repo.
// Run alone with: node --test tools/test/edge-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createEdge } from '../cloud/edge.mjs';
import { readInboxFiles } from '../inbox.mjs';
import { createTenantStore } from '../cloud/tenants.mjs';
import { twilioSignature } from '../connectors/voice.mjs';

const KEY = 'wy_testkey_123456789';
const HOOK = crypto.randomBytes(16).toString('hex'); // the test's inbound shared value, made per run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-edge-routes-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof s === 'string' ? s : JSON.stringify(s)); };
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function fixture(name) {
  const root = path.join(tmp, name);
  const P = (...p) => path.join(root, 'products', 'mugstudio', ...p);
  write(P('product.json'), { name: 'Mug Studio', domain: 'mugstudio.test', stage: 'live' });
  write(P('claims.md'), '# Claims\n\n| id | claim | status | source |\n|---|---|---|---|\n| C1 | Mug Studio ships handmade ceramic mugs worldwide. | verified | owner |\n| C2 | Every mug is dishwasher safe. | verified | owner |\n');
  write(P('profile.md'), '# Profile\n\nMug Studio is a small ceramic studio that makes handmade mugs.\n');
  write(P('experiments', 'bandit-live.json'), { experiments: [{ id: 'hero1', element: 'h1', page: '/', goal: { kind: 'click', selector: '.buy' }, weights: { control: 0.5, b: 0.5 }, arms: [{ id: 'control', variant: { type: 'none' } }, { id: 'b', variant: { type: 'text', value: 'Mugs made by hand' } }] }] });
  write(P('experiments', 'bandits.json'), { experiments: [{ id: 'old1', status: 'stopped' }, { id: 'draft1', status: 'draft' }] });
  write(path.join(root, 'products', 'other', 'product.json'), { name: 'Other', domain: 'other.test' });
  return { root, P };
}

test('chat: known site only, retrieval answer without an LLM, consent required for leads, no contact echoed', async () => {
  const { root, P } = fixture('chat');
  const { server } = createEdge({ root, installKey: KEY, onboard: () => { throw new Error('chat must never onboard'); }, allowDomains: ['mugstudio.test'] });
  const base = await listen(server);
  const chat = (body, origin = 'https://www.mugstudio.test') => fetch(`${base}/chat`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const pre = await fetch(`${base}/chat`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.equal((await chat({ site: 'nope', message: 'hi' })).status, 403, 'wrong site key');
    assert.equal((await chat({ site: KEY, message: 'hi' }, 'https://other.test')).status, 403, 'domain outside the allow-list');
    assert.equal((await chat({ site: KEY, message: 'hi' }, 'https://unknown-shop.test')).status, 403);
    assert.equal((await chat({ site: KEY, message: '' })).status, 400);
    // Over the body cap the edge answers 413 or drops the connection (readBody destroys the request).
    const big = await chat({ site: KEY, message: 'x'.repeat(9000) }).then((r) => r.status, () => 'closed');
    assert.ok(big === 413 || big === 'closed', 'body over the cap is refused');
    assert.equal((await chat({ site: KEY, message: 'x'.repeat(2500) })).status, 400, 'message over 2000 characters');

    const r1 = await chat({ site: KEY, session: 'sess-12345678', message: 'Are the mugs dishwasher safe?' });
    assert.equal(r1.status, 200);
    const a1 = await r1.json();
    assert.equal(a1.session, 'sess-12345678');
    assert.match(a1.answer, /dishwasher/i);
    assert.ok(a1.sources.length >= 1);
    assert.equal(a1.lead_saved, false);

    // Contact without consent: withheld, nothing saved, the address never comes back.
    const r2 = await (await chat({ site: KEY, session: 'sess-12345678', message: 'Do you ship worldwide? Reach me at jo@example.com', consent: 'yes', contact: { email: 'jo@example.com' } })).json();
    assert.equal(r2.consent_needed, true);
    assert.equal(r2.lead_saved, false);
    assert.ok(!JSON.stringify(r2).includes('jo@example.com'));
    assert.ok(!fs.existsSync(P('chat', 'leads.jsonl')), 'no lead without consent');

    // Explicit consent: the lead is stored under the product, still not echoed.
    const r3 = await (await chat({ site: KEY, session: 'sess-12345678', message: 'Do you ship worldwide?', consent: true, contact: { email: 'jo@example.com', name: 'Jo' } })).json();
    assert.equal(r3.lead_saved, true);
    assert.ok(!JSON.stringify(r3).includes('jo@example.com'));
    assert.equal(lines(P('chat', 'leads.jsonl'))[0].contact.email, 'jo@example.com');
    const transcript = fs.readFileSync(P('chat', 'transcripts', 'sess-12345678.jsonl'), 'utf8');
    assert.ok(!transcript.includes('jo@example.com'), 'transcripts are redacted');
    assert.ok(!fs.existsSync(path.join(root, 'state')), 'nothing written to state/');
  } finally { server.close(); }
});

test('chat: per-IP and per-session rate limits', async () => {
  const { root } = fixture('chat-limits');
  const { server } = createEdge({ root, installKey: KEY, chatPerMinute: 3, chatPerSessionHour: 100 });
  const base = await listen(server);
  try {
    const send = () => fetch(`${base}/chat`, { method: 'POST', headers: { origin: 'https://mugstudio.test' }, body: JSON.stringify({ site: KEY, message: 'mugs?' }) });
    for (let i = 0; i < 3; i++) assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 429);
  } finally { server.close(); }
  const s2 = createEdge({ root, installKey: KEY, chatPerMinute: 100, chatPerSessionHour: 2 }).server;
  const base2 = await listen(s2);
  try {
    const send = (session) => fetch(`${base2}/chat`, { method: 'POST', headers: { origin: 'https://mugstudio.test' }, body: JSON.stringify({ site: KEY, session, message: 'mugs?' }) });
    assert.equal((await send('sess-aaaaaaaa')).status, 200);
    assert.equal((await send('sess-aaaaaaaa')).status, 200);
    assert.equal((await send('sess-aaaaaaaa')).status, 429);
    assert.equal((await send('sess-bbbbbbbb')).status, 200, 'another session is not affected');
  } finally { s2.close(); }
});

test('bandit: client served per site, beacons hashed and deduped, assign is deterministic, GPC records nothing', async () => {
  const { root, P } = fixture('bandit');
  const { server } = createEdge({ root, installKey: KEY, edgeUrl: 'https://edge.example.com' });
  const base = await listen(server);
  const post = (route, body, headers = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { origin: 'https://mugstudio.test', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const events = () => lines(P('experiments', 'bandit-events.jsonl'));
  try {
    const js = await fetch(`${base}/bandit.js?site=${KEY}&host=mugstudio.test`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    const code = await js.text();
    assert.match(code, /Whalyom bandit/);
    assert.match(code, /hero1/);
    assert.match(code, /https:\/\/edge\.example\.com/);
    const alias = await (await fetch(`${base}/whalyom-bandit.js?site=${KEY}&host=mugstudio.test`)).text();
    assert.equal(alias, code);
    const inert = await (await fetch(`${base}/bandit.js?site=wrong&host=mugstudio.test`)).text();
    assert.doesNotMatch(inert, /hero1/);
    assert.match(inert, /"e":""/, 'no endpoint for an unknown key');
    assert.doesNotMatch(await (await fetch(`${base}/bandit.js?site=${KEY}&host=nowhere.test`)).text(), /hero1/);

    assert.equal((await fetch(`${base}/bandit`, { method: 'OPTIONS' })).status, 204);
    assert.equal((await post('/bandit', { site: 'nope', kind: 'exposure', exp: 'hero1', arm: 'b', vid: 'visitor-0001' })).status, 403);
    assert.equal((await post('/bandit', { site: KEY, kind: 'exposure', exp: 'hero1', arm: 'b', vid: 'visitor-0001' }, { origin: 'https://unknown-shop.test' })).status, 404, 'unknown site is never onboarded');
    assert.equal((await post('/bandit', { site: KEY, kind: 'exposure', exp: 'hero1', arm: 'b', vid: 'visitor-0001' })).status, 204);
    assert.equal((await post('/bandit', { site: KEY, kind: 'exposure', exp: 'hero1', arm: 'b', vid: 'visitor-0001' })).status, 204, 'duplicate accepted');
    assert.equal(events().length, 1, 'duplicate exposure not written twice');
    assert.equal((await post('/bandit', { site: KEY, kind: 'exposure', exp: 'hero1', arm: 'zzz', vid: 'visitor-0001' })).status, 400, 'unknown arm');
    assert.equal((await post('/bandit', { site: KEY, kind: 'exposure', exp: 'draft1', arm: 'b', vid: 'visitor-0001' })).status, 400, 'a draft is not live');
    assert.equal((await post('/bandit', { site: KEY, kind: 'click', exp: 'hero1', vid: 'visitor-0001' })).status, 400);

    assert.equal((await post('/bandit/convert', { site: KEY, exp: 'hero1', vid: 'visitor-0001', value: 25 })).status, 204);
    assert.equal((await post('/bandit/convert', { site: KEY, exp: 'old1', vid: 'visitor-0001' })).status, 204);
    assert.equal((await post('/bandit/convert', { site: KEY, exp: 'draft1', vid: 'visitor-0002' })).status, 204);
    const ev = events();
    assert.deepEqual(ev.map((e) => [e.kind, e.exp]), [['exposure', 'hero1'], ['conversion', 'hero1'], ['conversion', 'old1']], 'draft conversions dropped');
    assert.equal(ev[1].value, 25);
    assert.ok(ev.every((e) => /^[0-9a-f]{16}$/.test(e.vid)), 'visitor ids hashed');
    assert.ok(!JSON.stringify(ev).includes('visitor-0001'));

    const a1 = await (await post('/bandit/assign', { site: KEY, exp: 'hero1', vid: 'visitor-0003' })).json();
    const a2 = await (await post('/bandit/assign', { site: KEY, exp: 'hero1', vid: 'visitor-0003' })).json();
    assert.ok(['control', 'b'].includes(a1.arm));
    assert.deepEqual(a1, a2, 'same visitor, same arm');
    assert.equal(events().filter((e) => e.kind === 'exposure').length, 2, 'assign records one exposure');
    assert.equal((await post('/bandit/assign', { site: KEY, exp: 'nope', vid: 'visitor-0003' })).status, 404);
    assert.equal((await post('/bandit/assign', { site: KEY, exp: 'hero1', vid: 'x' })).status, 400);

    const before = events().length;
    const g = await (await post('/bandit/assign', { site: KEY, exp: 'hero1', vid: 'visitor-0009' }, { 'sec-gpc': '1' })).json();
    assert.equal(g.arm, 'control', 'GPC gets the original page');
    assert.equal((await post('/bandit', { site: KEY, kind: 'exposure', exp: 'hero1', arm: 'b', vid: 'visitor-0010' }, { dnt: '1' })).status, 204);
    assert.equal(events().length, before, 'nothing recorded under GPC or DNT');
  } finally { server.close(); }
});

test('inbound: shared secret or HMAC, known products only, files land in inbox/ for tools/inbox.mjs', async () => {
  const { root, P } = fixture('inbound');
  const reply = JSON.stringify({ from: 'jo@example.com', subject: 'Re: mugs', text: 'Yes, interested, send me pricing.', at: '2026-11-04T10:00:00Z' });
  const json = { authorization: `Bearer ${HOOK}`, 'content-type': 'application/json' };
  const off = createEdge({ root, installKey: KEY, env: {} }).server;
  const offBase = await listen(off);
  try {
    assert.equal((await fetch(`${offBase}/inbound/mugstudio`, { method: 'POST', headers: json, body: reply })).status, 503, 'off without OM_INBOUND_SECRET');
  } finally { off.close(); }

  const { server } = createEdge({ root, installKey: KEY, env: { OM_INBOUND_SECRET: HOOK }, allowDomains: ['mugstudio.test'] });
  const base = await listen(server);
  const inbound = (slug, body, headers) => fetch(`${base}/inbound/${slug}`, { method: 'POST', headers, body });
  try {
    assert.equal((await fetch(`${base}/inbound/mugstudio`)).status, 405);
    assert.equal((await inbound('mugstudio', reply, { 'content-type': 'application/json' })).status, 401, 'no shared value');
    assert.equal((await inbound('mugstudio', reply, { ...json, authorization: `Bearer ${'0'.repeat(32)}` })).status, 401, 'wrong shared value');
    assert.equal((await inbound('mugstudio', reply, { 'x-whalyom-signature': `sha256=${'0'.repeat(64)}`, 'content-type': 'application/json' })).status, 401, 'bad HMAC');
    assert.equal((await inbound('nope', reply, json)).status, 404, 'unknown product');
    assert.equal((await inbound('_template', reply, json)).status, 404);
    assert.equal((await inbound('..', reply, json)).status, 404);
    assert.equal((await inbound('other', reply, json)).status, 403, 'domain outside the allow-list');
    assert.equal((await inbound('mugstudio', '{bad', json)).status, 400);
    assert.equal((await inbound('mugstudio', 'x', { ...json, 'content-type': 'image/png' })).status, 415);

    const ok = await inbound('mugstudio', reply, json);
    assert.equal(ok.status, 202);
    const body = await ok.json();
    assert.match(body.file, /^inbox\/[0-9TZ]+-[0-9a-f]{8}\.json$/);
    assert.ok(!JSON.stringify(body).includes('jo@example.com'));

    const eml = 'From: Jo <jo@example.com>\r\nSubject: Re: mugs\r\nDate: Wed, 04 Nov 2026 10:00:00 +0000\r\n\r\nPlease unsubscribe me.\r\n';
    const sig = `sha256=${crypto.createHmac('sha256', HOOK).update(eml).digest('hex')}`;
    assert.equal((await inbound('mugstudio', eml, { 'x-whalyom-signature': sig, 'content-type': 'message/rfc822' })).status, 202, 'HMAC accepted');

    const files = fs.readdirSync(P('inbox'));
    assert.equal(files.length, 2);
    assert.ok(files.every((f) => !f.startsWith('_')), 'temp names renamed');
    const read = readInboxFiles(P('inbox'), '2026-11-04T12:00:00Z');
    assert.equal(read.length, 2);
    assert.ok(read.every((x) => x.replies?.length === 1), 'tools/inbox.mjs reads both files');
    assert.ok(!fs.existsSync(path.join(root, 'state')), 'nothing written to state/');
  } finally { server.close(); }
});

// ---- mounted cloud modules: realtime feed, agency routes, voice webhooks ----
const OWNER_TOKEN = crypto.randomBytes(16).toString('hex');
const fakeWorkspace = ({ slug, name, domain, productsDir }) => {
  write(path.join(productsDir, slug, 'product.json'), { slug, name, domain, budget: { mode: 'paid', monthly_cap: 500, daily_cap: 20 } });
  write(path.join(productsDir, slug, 'approvals.json'), [{ id: 'a1', type: 'publish', title: 'Post one', status: 'pending' }, { id: 'a2', type: 'cap-change', title: 'Raise cap', status: 'pending' }]);
};
const tenantStoreFor = (root) => createTenantStore({ dir: path.join(root, 'tenants'), productsDir: path.join(root, 'products'), createWorkspace: fakeWorkspace });
const auth = (k) => ({ authorization: `Bearer ${k}` });
// Reads an SSE stream until the wanted text arrives (or a timeout), then drops the connection.
const sseUntil = (url, headers, want, ms = 3000) => new Promise((resolve, reject) => {
  let buf = '';
  const req = http.get(url, { headers }, (res) => {
    const done = () => { clearTimeout(t); req.destroy(); resolve({ status: res.statusCode, type: res.headers['content-type'], text: buf }); };
    const t = setTimeout(done, ms);
    res.setEncoding('utf8');
    res.on('data', (c) => { buf += c; if (buf.includes(want)) done(); });
    res.on('end', done);
  });
  req.on('error', (e) => (buf ? resolve({ text: buf }) : reject(e)));
});
const stop = (server) => new Promise((r) => { server.close(r); server.closeAllConnections?.(); });

test('live feed: owner, tenant and agency-client keys, scoped rows, owner-only docs, per-IP rate limit, SSE', async () => {
  const { root } = fixture('live');
  const tenants = tenantStoreFor(root);
  const ag = tenants.createTenant({ name: 'Blue Agency', email: 'boss@agency.test', plan: 'agency' });
  const eventsFile = path.join(root, 'state', 'live-events.json');
  write(eventsFile, { updated_at: 'x', events: [
    { product: 'mugstudio', text: 'mug row for jo@example.com', email: 'jo@example.com' },
    { product: 'other', text: 'other row' },
  ] });
  write(path.join(root, 'state', 'live-integrations.json'), { updated_at: 'x', integrations: [{ name: 'stripe', configured: true }] });
  const { server, live } = createEdge({ root, installKey: KEY, tenants, env: { WHALYOM_OWNER_TOKEN: OWNER_TOKEN }, livePerMinute: 100, tenantCallsPerMinute: 100 });
  const base = await listen(server);
  try {
    assert.equal((await fetch(`${base}/live/events`, { method: 'OPTIONS' })).status, 204);
    assert.equal((await fetch(`${base}/live/events`)).status, 401, 'no token');
    assert.equal((await fetch(`${base}/live/events`, { headers: auth('wyk_t0123456789_' + '0'.repeat(48)) })).status, 401, 'unknown tenant key');
    const owner = await (await fetch(`${base}/live/events`, { headers: auth(OWNER_TOKEN) })).json();
    assert.equal(owner.data.events.length, 2, 'owner sees every product');
    assert.ok(!JSON.stringify(owner).includes('jo@example.com'), 'personal data scrubbed even for the owner');
    assert.equal((await fetch(`${base}/live/integrations?token=${OWNER_TOKEN}`)).status, 200);

    // Agency client: its own principal, only its own products.
    const agency = await (await fetch(`${base}/agency/clients`, { method: 'POST', headers: { ...auth(ag.apiKey), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme Shoes' }) })).json();
    const cid = agency.client.id;
    const prod = await (await fetch(`${base}/agency/clients/${cid}/products`, { method: 'POST', headers: auth(ag.apiKey), body: JSON.stringify({ name: 'Acme', domain: 'acme-shoes.com' }) })).json();
    const evs = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
    evs.events.push({ product: prod.slug, text: 'acme row' });
    write(eventsFile, evs);
    const tview = await (await fetch(`${base}/live/events`, { headers: auth(ag.apiKey) })).json();
    assert.deepEqual(tview.data.events.map((e) => e.product), [prod.slug], 'tenant sees only its products');
    assert.equal((await fetch(`${base}/live/integrations`, { headers: auth(ag.apiKey) })).status, 403, 'owner-only doc');
    const cview = await (await fetch(`${base}/live/events`, { headers: auth(agency.client_key) })).json();
    assert.deepEqual(cview.data.events.map((e) => e.product), [prod.slug], 'client sees only its products');
    await fetch(`${base}/agency/clients/${cid}/disable`, { method: 'POST', headers: auth(ag.apiKey) });
    assert.equal((await fetch(`${base}/live/events`, { headers: auth(agency.client_key) })).status, 401, 'disabled client key refused');

    const s = await sseUntil(`${base}/live/stream?docs=events`, auth(OWNER_TOKEN), '"path":"live/events"');
    assert.equal(s.status, 200);
    assert.match(s.type, /text\/event-stream/);
    assert.match(s.text, /retry: 5000/);
    assert.match(s.text, /event: doc/);
    assert.ok(!s.text.includes(OWNER_TOKEN), 'token never echoed');
  } finally { await stop(server); }
  assert.equal(live.stats().clients, 0, 'streams ended when the edge closed');
  assert.equal(live.stats().watching, false, 'watcher stopped');

  const lim = createEdge({ root, installKey: KEY, tenants, env: { WHALYOM_OWNER_TOKEN: OWNER_TOKEN }, livePerMinute: 2 }).server;
  const lb = await listen(lim);
  try {
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${lb}/live/events`, { headers: auth(OWNER_TOKEN) })).status, 200);
    assert.equal((await fetch(`${lb}/live/events`, { headers: auth(OWNER_TOKEN) })).status, 429);
  } finally { await stop(lim); }
});

test('agency routes: tenant key vs client key, decisions queued (never applied), public branding, limits', async () => {
  const { root } = fixture('agency');
  const tenants = tenantStoreFor(root);
  const ag = tenants.createTenant({ name: 'Blue Agency', email: 'boss@agency.test', plan: 'agency' });
  const solo = tenants.createTenant({ name: 'Solo', email: 'solo@x.test', plan: 'growth' });
  const { server } = createEdge({ root, installKey: KEY, tenants, tenantCallsPerMinute: 100 });
  const base = await listen(server);
  const call = (p, { method = 'GET', key, body } = {}) => fetch(`${base}${p}`, { method, headers: { ...(key ? auth(key) : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  try {
    const pre = await fetch(`${base}/agency/clients`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
    assert.equal((await call('/agency')).status, 401);
    assert.equal((await call('/agency', { key: solo.apiKey })).status, 403, 'not on the Agency plan');
    assert.equal((await call('/agency/clients', { method: 'POST', key: ag.apiKey, body: '{bad' })).status, 400);

    const made = await call('/agency/clients', { method: 'POST', key: ag.apiKey, body: { name: 'Acme Shoes', max_products: 1 } });
    assert.equal(made.status, 201);
    const { client, client_key } = await made.json();
    assert.match(client_key, /^wyc_/);
    const files = fs.readdirSync(path.join(root, 'tenants'), { recursive: true }).map((f) => path.join(root, 'tenants', String(f))).filter((f) => fs.statSync(f).isFile());
    assert.ok(!files.some((f) => fs.readFileSync(f, 'utf8').includes(client_key)), 'client key stored only as a hash');
    assert.equal((await call('/agency', { key: client_key })).status, 401, 'a client key is not an agency key');
    assert.equal((await call('/client', { key: ag.apiKey })).status, 401, 'an agency key is not a client key');

    const p = await (await call(`/agency/clients/${client.id}/products`, { method: 'POST', key: ag.apiKey, body: { name: 'Acme', domain: 'acme-shoes.com' } })).json();
    assert.ok(p.slug);
    const product = JSON.parse(fs.readFileSync(path.join(root, 'products', p.slug, 'product.json'), 'utf8'));
    assert.equal(product.client, client.id);
    assert.deepEqual([product.budget.mode, product.budget.monthly_cap, product.budget.daily_cap], ['free', 0, 0], 'client without paid modes gets zero caps');
    assert.equal((await call(`/agency/clients/${client.id}/products`, { method: 'POST', key: ag.apiKey, body: { name: 'Two', domain: 'acme-two.com' } })).status, 403, 'client product limit');

    const dash = await (await call('/client', { key: client_key })).json();
    assert.deepEqual(dash.products.map((x) => x.slug), [p.slug]);
    assert.equal(dash.read_only, true);
    assert.equal((await call('/client/decisions', { method: 'POST', key: client_key, body: { product: 'mugstudio', approval_id: 'a1', decision: 'approve' } })).status, 403, 'not a product of the client');
    assert.equal((await call('/client/decisions', { method: 'POST', key: client_key, body: { product: p.slug, approval_id: 'a2', decision: 'approve' } })).status, 403, 'owner-only type');
    const q = await call('/client/decisions', { method: 'POST', key: client_key, body: { product: p.slug, approval_id: 'a1', decision: 'approve', activate: true } });
    assert.equal(q.status, 202);
    assert.ok(!('activate' in (await q.json()).queued), 'activate dropped');
    const approvals = JSON.parse(fs.readFileSync(path.join(root, 'products', p.slug, 'approvals.json'), 'utf8'));
    assert.equal(approvals.find((x) => x.id === 'a1').status, 'pending', 'approvals.json is never written by a client decision');

    assert.equal((await call('/branding?host=brand.blue-agency.com')).status, 404);
    assert.equal((await call('/agency/branding', { method: 'POST', key: ag.apiKey, body: { name: 'Blue', primary_color: 'red' } })).status, 400, 'bad colour');
    assert.equal((await call('/agency/branding', { method: 'PUT', key: ag.apiKey, body: { name: 'Blue', primary_color: '#1a2b3c', custom_domain: 'brand.blue-agency.com' } })).status, 200);
    const pub = await call('/branding?host=brand.blue-agency.com');
    assert.equal(pub.status, 200);
    const pb = await pub.json();
    assert.equal(pb.branding.primary_color, '#1a2b3c');
    assert.ok(!JSON.stringify(pb).includes('boss@agency.test'));
    assert.equal((await call('/agency/branding/public?host=brand.blue-agency.com')).status, 200);
  } finally { await stop(server); }

  const lim = createEdge({ root, installKey: KEY, tenants, tenantCallsPerMinute: 2 }).server;
  const lb = await listen(lim);
  try {
    assert.notEqual((await fetch(`${lb}/branding?host=x.com`)).status, 429);
    assert.notEqual((await fetch(`${lb}/client`)).status, 429);
    assert.equal((await fetch(`${lb}/agency`)).status, 429, 'shared per-IP tenant limit');
  } finally { await stop(lim); }
});

test('voice webhook: configured only, signature checked on the public URL, known products, nothing written on 403', async () => {
  const { root, P } = fixture('voice');
  const venv = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: crypto.randomBytes(16).toString('hex'), TWILIO_VOICE_FROM: '+15005550006', TWILIO_VOICE_WEBHOOK_BASE: 'https://edge.example/voice/mugstudio' };
  const off = createEdge({ root, installKey: KEY, env: {} }).server;
  const ob = await listen(off);
  try { assert.equal((await fetch(`${ob}/voice/mugstudio/inbound`, { method: 'POST', body: 'x=1' })).status, 503, 'off without Twilio settings'); } finally { await stop(off); }

  const { server } = createEdge({ root, installKey: KEY, env: venv, voicePerMinute: 100 });
  const base = await listen(server);
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const signedPost = (route, params, slug = 'mugstudio') => {
    const p = { AccountSid: venv.TWILIO_ACCOUNT_SID, ...params };
    const sig = twilioSignature(venv.TWILIO_AUTH_TOKEN, `https://edge.example/voice/${slug}/${route}`, p);
    return fetch(`${base}/voice/${slug}/${route}`, { method: 'POST', headers: { ...form, 'x-twilio-signature': sig }, body: new URLSearchParams(p).toString() });
  };
  const call = { CallSid: 'CA1', From: '+442071234567', To: venv.TWILIO_VOICE_FROM, Direction: 'inbound' };
  try {
    assert.equal((await fetch(`${base}/voice/mugstudio/inbound`)).status, 405);
    assert.equal((await fetch(`${base}/voice/mugstudio/other`, { method: 'POST' })).status, 404, 'unknown voice route');
    assert.equal((await signedPost('inbound', call, 'nope')).status, 404, 'unknown product');
    assert.equal((await signedPost('inbound', call, '_template')).status, 404);
    const body = new URLSearchParams({ AccountSid: venv.TWILIO_ACCOUNT_SID, ...call }).toString();
    assert.equal((await fetch(`${base}/voice/mugstudio/inbound`, { method: 'POST', headers: { ...form, 'x-twilio-signature': 'bm9wZQ==' }, body })).status, 403, 'invalid signature');
    assert.equal((await fetch(`${base}/voice/mugstudio/inbound`, { method: 'POST', headers: form, body })).status, 403, 'missing signature');
    // Signed for the address the request reached: refused, the edge rebuilds the URL on TWILIO_VOICE_WEBHOOK_BASE.
    const p = { AccountSid: venv.TWILIO_ACCOUNT_SID, ...call };
    assert.equal((await fetch(`${base}/voice/mugstudio/inbound`, { method: 'POST', headers: { ...form, 'x-twilio-signature': twilioSignature(venv.TWILIO_AUTH_TOKEN, `${base}/voice/mugstudio/inbound`, p) }, body })).status, 403, 'Host header is not trusted');
    assert.equal((await signedPost('inbound', { ...call, AccountSid: 'AC' + 'b'.repeat(32) })).status, 403, 'another Twilio account');
    assert.ok(!fs.existsSync(P('voice')) && !fs.existsSync(P('leads')), 'nothing written on 403');

    const ok = await signedPost('inbound', call);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /xml/);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.match(await ok.text(), /<Response>/);
    assert.ok(fs.readdirSync(P('leads')).some((f) => /^voice-[0-9a-f]{12}\.json$/.test(f)), 'a new caller becomes a lead under the product');
    assert.ok(!fs.existsSync(path.join(root, 'state')), 'nothing written to state/');
  } finally { await stop(server); }

  const lim = createEdge({ root, installKey: KEY, env: venv, voicePerMinute: 1 }).server;
  const lb = await listen(lim);
  try {
    await fetch(`${lb}/voice/mugstudio/status`, { method: 'POST', body: 'x=1' });
    assert.equal((await fetch(`${lb}/voice/mugstudio/status`, { method: 'POST', body: 'x=1' })).status, 429);
  } finally { await stop(lim); }
});
