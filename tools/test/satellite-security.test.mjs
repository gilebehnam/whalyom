// Security review of the Node satellite: constant-time HMAC, replay protection (timestamp + nonce),
// strict mode, response signatures, body limits, path traversal (incl. symlinks and the .whalyom folder),
// CORS allow-list, rate limits (collect, leads, bad signatures, trusted proxy), honeypot, de-dupe,
// new tracker event types, and consented lead capture into a separate leads log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSatellite, normalizeEvent, safeEqualHex, sign, signV2, rateLimiter, seenCache, TRACKER_JS } from '../satellite/whalyom-satellite.mjs';
import { satellite, signRequestV2 } from '../lib/satellite-client.mjs';

const secret = crypto.randomBytes(32).toString('hex');
const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-sec-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-out-'));
const servers = [];
const start = (opts = {}) => new Promise((resolve) => {
  const s = createSatellite({ root: siteRoot, secret, ...opts });
  s.listen(0, '127.0.0.1', () => { servers.push(s); resolve(`http://127.0.0.1:${s.address().port}`); });
});
let base; let strictBase;
const signedFetch = (b, method, pq, body = '', { ts = Date.now(), nonce = crypto.randomBytes(16).toString('hex'), sig, key = secret } = {}) => fetch(b + pq, {
  method, body: body || undefined,
  headers: { 'x-whalyom-ts': String(ts), 'x-whalyom-nonce': nonce, 'x-whalyom-sig': sig ?? signRequestV2(key, ts, nonce, method, pq, body) },
});
const collect = (b, ev, headers = {}) => fetch(`${b}/collect`, { method: 'POST', body: typeof ev === 'string' ? ev : JSON.stringify(ev), headers });
const eventsOnDisk = () => fs.readFileSync(path.join(siteRoot, '.whalyom', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

before(async () => {
  fs.writeFileSync(path.join(siteRoot, 'index.html'), '<h1>Home</h1>');
  fs.writeFileSync(path.join(siteRoot, 'wp-config.php'), "<?php define('DB_PASSWORD','x');");
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside the root');
  base = await start({ origins: ['https://example.test', 'https://www.example.test'] });
  strictBase = await start({ strict: true, collectPerMinute: 3, trustProxy: true });
});
after(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(siteRoot, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('HMAC compare is constant-time and never throws on odd input', () => {
  const good = sign(secret, 1, 'GET', '/x', '');
  assert.equal(safeEqualHex(good, good), true);
  assert.equal(safeEqualHex(good, good.slice(0, -1) + (good.at(-1) === 'a' ? 'b' : 'a')), false);
  for (const bad of ['', 'zz', 'é'.repeat(64), good + '0', null, undefined, 42]) assert.equal(safeEqualHex(bad, good), false);
});

test('v2 signatures work, responses are signed, and a replayed request is refused', async () => {
  const h = await satellite(base, secret).health({ meta: true });
  assert.equal(h.ok, true); assert.equal(h.version, '1.1.0'); assert.equal(h._meta.version, 2); assert.equal(h._meta.response_signed, true);
  assert.ok(Math.abs(h.time - Date.now()) < 5000);
  const ts = Date.now(); const nonce = crypto.randomBytes(16).toString('hex');
  assert.equal((await signedFetch(base, 'GET', '/_whalyom/health', '', { ts, nonce })).status, 200);
  const again = await signedFetch(base, 'GET', '/_whalyom/health', '', { ts, nonce });
  assert.equal(again.status, 401); assert.equal((await again.json()).error, 'replayed request');
});

test('old timestamps, bad nonces, tampered bodies and wrong keys are refused', async () => {
  assert.equal((await signedFetch(base, 'GET', '/_whalyom/health', '', { ts: Date.now() - 10 * 60 * 1000 })).status, 401);
  assert.equal((await signedFetch(base, 'GET', '/_whalyom/health', '', { ts: Date.now() + 10 * 60 * 1000 })).status, 401);
  assert.equal((await signedFetch(base, 'GET', '/_whalyom/health', '', { nonce: 'short' })).status, 401);
  assert.equal((await signedFetch(base, 'GET', '/_whalyom/health', '', { key: 'y'.repeat(64) })).status, 401);
  const ts = Date.now(); const nonce = crypto.randomBytes(16).toString('hex');
  const sig = signV2(secret, ts, nonce, 'POST', '/_whalyom/apply', '{"path":"a.html","content":"x"}');
  assert.equal((await signedFetch(base, 'POST', '/_whalyom/apply', '{"path":"b.html","content":"x"}', { ts, nonce, sig })).status, 401, 'body is covered by the signature');
  assert.equal((await signedFetch(base, 'GET', '/_whalyom/files?path=index.html', '', { sig: signV2(secret, Date.now(), 'n'.repeat(32), 'GET', '/_whalyom/files?path=', '') })).status, 401, 'query is covered');
});

test('legacy v1 is accepted (and replay-protected) unless --strict', async () => {
  const ts = Date.now();
  const v1 = () => fetch(`${base}/_whalyom/health`, { headers: { 'x-whalyom-ts': String(ts), 'x-whalyom-sig': sign(secret, ts, 'GET', '/_whalyom/health', '') } });
  assert.equal((await v1()).status, 200);
  assert.equal((await v1()).status, 401, 'same v1 request twice = replay');
  const ts2 = Date.now();
  const r = await fetch(`${strictBase}/_whalyom/health`, { headers: { 'x-whalyom-ts': String(ts2), 'x-whalyom-sig': sign(secret, ts2, 'GET', '/_whalyom/health', '') } });
  assert.equal(r.status, 401); assert.deepEqual((await r.json()).sig_versions, [2]);
  assert.equal((await satellite(strictBase, secret).health()).strict, true);
});

test('the client rejects a response that is not signed by the site secret', async () => {
  const http = await import('node:http');
  const fake = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-whalyom-resp-sig': 'a'.repeat(64) }); res.end('{"ok":true}'); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  await assert.rejects(satellite(`http://127.0.0.1:${fake.address().port}`, secret).health(), /response signature mismatch/);
  await new Promise((r) => fake.close(r));
});

test('path traversal, blocked files, the .whalyom folder and escaping symlinks are refused', async () => {
  const s = satellite(base, secret);
  for (const p of ['../../etc/passwd', '..\\..\\windows\\win.ini', '/../../etc/hosts', 'wp-config.php', '.whalyom/audit.jsonl', '.whalyom/events.jsonl', 'index.html\0.txt', 'a/../../x']) {
    await assert.rejects(s.files(p), /not found or not allowed/, p);
  }
  const listing = await s.files('');
  assert.ok(!listing.entries.some((e) => ['wp-config.php', '.whalyom'].includes(e.name)));
  let linked = false;
  try { fs.symlinkSync(outside, path.join(siteRoot, 'escape'), 'junction'); linked = true; } catch { /* no symlink permission */ }
  if (linked) {
    await assert.rejects(s.files('escape/secret.txt'), /not found or not allowed/);
    assert.ok(!(await s.files('')).entries.some((e) => e.name === 'escape'), 'escaping link is hidden from listings');
    fs.rmSync(path.join(siteRoot, 'escape'), { recursive: true, force: true });
  }
});

test('writes cannot target blocked paths or the satellite data folder', async () => {
  const wbase = await start({ allowWrites: true });
  const s = satellite(wbase, secret);
  for (const p of ['.whalyom/audit.jsonl', '.env', '.htaccess', '../evil.html', '']) await assert.rejects(s.apply(p, 'x'), /not allowed|no content/, p);
  assert.equal((await s.apply('ok/page.html', '<p>ok</p>')).ok, true);
  const bad = await signedFetch(wbase, 'POST', '/_whalyom/apply', 'not json');
  assert.equal(bad.status, 400);
});

test('body size limits: /collect over 8 KB and signed bodies over --max-body get 413', async () => {
  const small = await start({ maxBody: 1000 });
  assert.equal((await collect(small, { type: 'pageview', path: '/', pad: 'x'.repeat(9000) })).status, 413);
  assert.equal((await signedFetch(small, 'POST', '/_whalyom/apply', JSON.stringify({ path: 'a', content: 'x'.repeat(5000) }))).status, 413);
});

test('CORS allow-list on /collect; the signed API sends no CORS header', async () => {
  const ok = await fetch(`${base}/collect`, { method: 'OPTIONS', headers: { origin: 'https://example.test' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://example.test');
  const evil = await fetch(`${base}/collect`, { method: 'OPTIONS', headers: { origin: 'https://evil.invalid' } });
  assert.equal(evil.status, 403); assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal((await collect(base, { type: 'pageview', path: '/' }, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await collect(base, { type: 'pageview', path: '/' }, { origin: 'https://www.example.test' })).status, 204);
  assert.equal((await fetch(`${base}/_whalyom/health`)).headers.get('access-control-allow-origin'), null);
});

test('rate limits: collect per client IP behind a trusted proxy, and repeated bad signatures', async () => {
  const hit = (ip) => collect(strictBase, { type: 'pageview', path: '/' }, { 'x-forwarded-for': `10.0.0.1, ${ip}` });
  for (let i = 0; i < 3; i++) assert.equal((await hit('203.0.113.5')).status, 204);
  assert.equal((await hit('203.0.113.5')).status, 429);
  assert.equal((await hit('203.0.113.6')).status, 204, 'another client is not affected');
  const bb = await start({ badSigPerMinute: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(`${bb}/_whalyom/health`)).status);
  assert.deepEqual(codes.slice(0, 3), [401, 401, 401]); assert.equal(codes.at(-1), 429);
  assert.equal((await signedFetch(bb, 'GET', '/_whalyom/health')).status, 429, 'locked out even with a valid signature');
  const rl = rateLimiter(2, 1000); assert.equal(rl('a', 0), false); assert.equal(rl('a', 1), false); assert.equal(rl('a', 2), true); assert.equal(rl('a', 5000), false);
  const seen = seenCache(1000); assert.equal(seen('n', 0), false); assert.equal(seen('n', 10), true); assert.equal(seen('n', 2000), false);
});

test('honeypot, de-dupe and the new event types', async () => {
  const before = fs.existsSync(path.join(siteRoot, '.whalyom', 'events.jsonl')) ? eventsOnDisk().length : 0;
  assert.equal((await collect(base, { type: 'lead', path: '/p', hp: 'i am a bot', email: 'x@example.test', consent: true })).status, 204);
  const eid = crypto.randomBytes(8).toString('hex');
  assert.equal((await collect(base, { type: 'pageview', path: '/dup', eid })).status, 204);
  assert.equal((await collect(base, { type: 'pageview', path: '/dup', eid })).status, 204);
  for (const ev of [
    { type: 'scroll', path: '/', depth: 75 }, { type: 'cta', path: '/', label: 'Start trial' }, { type: 'outbound', path: '/', href: 'https://partner.example/x?y=1' },
    { type: 'form_submit', path: '/', form: 'contact' }, { type: 'vitals', path: '/', lcp: 2100.4, cls: 0.0412, inp: 180 },
    { type: 'pageview', path: '/utm?gclid=1', ref: 'https://news.example/a?token=secret', utm: { source: 'google', medium: 'cpc', campaign: 'c', term: 'kw', content: 'ad1' } },
  ]) assert.equal((await collect(base, ev)).status, 204, ev.type);
  for (const bad of [{ type: 'scroll', depth: 300 }, { type: 'outbound', href: 'javascript:alert(1)' }, { type: 'vitals' }, { type: 'evil' }, [1, 2]]) assert.equal((await collect(base, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await collect(base, '{not json')).status, 400);
  const evs = eventsOnDisk().slice(before);
  assert.equal(evs.filter((e) => e.path === '/dup').length, 1, 'same eid stored once');
  assert.ok(!evs.some((e) => e.path === '/p'), 'honeypot lead dropped');
  assert.equal(evs.find((e) => e.type === 'outbound').href, 'partner.example');
  const v = evs.find((e) => e.type === 'vitals'); assert.equal(v.lcp, 2100); assert.equal(v.cls, 0.041); assert.equal(v.inp, 180);
  const pv = evs.find((e) => e.path === '/utm');
  assert.equal(pv.ref, 'https://news.example/a', 'referrer query stripped'); assert.equal(pv.utm.term, 'kw');
  assert.match(TRACKER_JS, /doNotTrack/); assert.match(TRACKER_JS, /globalPrivacyControl/); assert.ok(!/document\.cookie/.test(TRACKER_JS), 'tracker never touches cookies');
});

test('consented leads keep email/name/message in a separate leads log, never in events or health', async () => {
  const lbase = await start({ leadsPer10Min: 3 });
  const s = satellite(lbase, secret);
  const sinceEvents = (await s.events('')).until;
  assert.equal((await collect(lbase, { type: 'lead', path: '/landing', form: 'waitlist', eid: 'lead00000001', email: 'Ada@Example.TEST', name: 'Ada Lovelace', message: 'x'.repeat(5000), consent: true, utm: { source: 'reddit' } })).status, 204);
  assert.equal((await collect(lbase, { type: 'lead', path: '/landing', form: 'waitlist', eid: 'lead00000002', email: 'bob@example.test', name: 'Bob', consent: 'yes' })).status, 204);
  assert.equal((await collect(lbase, { type: 'lead', path: '/landing', form: 'waitlist', eid: 'lead00000003', email: 'not-an-email', name: 'Cy', consent: true })).status, 204);
  assert.equal((await collect(lbase, { type: 'lead', path: '/landing', eid: 'lead00000004', email: 'd@example.test', consent: true })).status, 429, 'lead rate limit');
  const leads = (await s.leads('')).leads.filter((l) => l.at > sinceEvents);
  assert.equal(leads.length, 2, 'only consented leads are logged');
  const ada = leads.find((l) => l.lead_id === 'lead00000001');
  assert.deepEqual(Object.keys(ada.contact).sort(), ['email', 'message', 'name']);
  assert.equal(ada.contact.email, 'ada@example.test'); assert.equal(ada.contact.message.length, 1000); assert.equal(ada.consent, true);
  const cy = leads.find((l) => l.lead_id === 'lead00000003'); assert.equal(cy.contact.email, undefined, 'invalid email dropped'); assert.equal(cy.contact.name, 'Cy');
  const evs = (await s.events(sinceEvents)).events;
  assert.equal(evs.filter((e) => e.type === 'lead').length, 3, 'every lead is counted');
  assert.ok(!JSON.stringify(evs).includes('example.test') && !JSON.stringify(evs).includes('Ada'), 'events carry no personal fields');
  assert.ok(evs.find((e) => e.eid === 'lead00000001').has_contact);
  const h = await s.health(); assert.ok(h.leads >= 2); assert.ok(!JSON.stringify(h).includes('@'));
  assert.equal((await fetch(`${lbase}/_whalyom/leads`)).status, 401, 'leads log needs a signature');
  assert.equal(normalizeEvent({ type: 'lead', email: 'a@b.test' }).event.contact, undefined, 'no consent → no contact');
  assert.equal(normalizeEvent({ type: 'lead', email: 'a@b.test', consent: true }).event.contact.email, 'a@b.test');
});

test('requireResponseSig rejects an unsigned 200 and never downgrades to v1 on a bare 401', async () => {
  const http = await import('node:http');
  const listen = (handler) => new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => { servers.push(s); resolve(`http://127.0.0.1:${s.address().port}`); });
  });
  // Stripped signature: a valid-looking JSON 200 with no x-whalyom-resp-sig.
  const stripped = await listen((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"events":[{"type":"lead"}],"until":"x"}'); });
  await assert.rejects(satellite(stripped, secret, { requireResponseSig: true }).events(''), /response is not signed/);
  // Downgrade attempt: 401 without sig_versions. Count requests and the v1 shape (no nonce header).
  let hits = 0; let v1 = 0;
  const bare401 = await listen((req, res) => { hits++; if (!req.headers['x-whalyom-nonce']) v1++; res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"bad signature"}'); });
  await assert.rejects(satellite(bare401, secret, { requireResponseSig: true }).events(''), (e) => e.status === 401);
  assert.equal(hits, 1, 'no v1 retry when response signing is required'); assert.equal(v1, 0);
  // Without the flag the legacy retry still happens (continuity for pre-1.1.0 satellites).
  hits = 0; v1 = 0;
  await assert.rejects(satellite(bare401, secret).events(''), (e) => e.status === 401);
  assert.equal(hits, 2); assert.equal(v1, 1);
});
