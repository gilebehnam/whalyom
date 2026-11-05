// Install packages per stack (attach --stack), stack auto-detection, the edge core (Cloudflare Worker,
// Next.js route, Netlify edge function run in-process), the WordPress plugin (PHP CLI harness when php is
// installed), tracker copies, `attach --verify` into state/live-sites.json, and consented leads end to end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSatellite, normalizeEvent, TRACKER_JS } from '../satellite/whalyom-satellite.mjs';
import { STACKS, detectStack, nginxSnippet, siteVars, buildPackage } from '../satellite/packages.mjs';
import { TRACKER_COPIES } from '../satellite/sync-tracker.mjs';
import * as core from '../../integrations/common/whalyom-core.mjs';
import { satellite, signRequestV2, secretEnvName } from '../lib/satellite-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zzstk${process.pid}`;
const domain = `${slug}.test`;
const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-stk-'));
const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-repo-'));
// Secrets go to a temp file (OM_ENV_FILE) for every spawned tool, never to the repo's real .env.
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-env-'));
const envFile = path.join(envDir, '.env');
const liveFile = path.join(root, 'state', 'live-sites.json');
const pkgDir = path.join(root, 'sites', slug);
let secret; let server; let base; let attachOut;
// Async on purpose: the satellite under test runs in this process, so a blocking spawnSync would deadlock it.
const node = (script, args = [], { ok = true } = {}) => new Promise((resolve, reject) => {
  const c = spawn(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, env: { ...process.env, OM_ENV_FILE: envFile, ...(secret ? { [secretEnvName(slug)]: secret } : {}) } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('error', reject);
  c.on('close', (status) => { try { if (ok) assert.equal(status, 0, stderr || stdout); resolve({ status, stdout, stderr }); } catch (e) { reject(e); } });
});
const php = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;
const runPhp = (job) => { const r = spawnSync('php', [path.join(root, 'integrations', 'wordpress', 'tests', 'harness.php')], { input: JSON.stringify(job), encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr || r.stdout); return JSON.parse(r.stdout); };
const FIXTURES = [
  { type: 'pageview', path: '/a?b=1#c', ref: 'https://x.example/p?q=1', utm: { source: 'reddit', medium: 'social', campaign: 'launch', term: 't', content: '' }, eid: 'abcdef123456', site: 's1' },
  { type: 'lead', path: '/l', form: 'trial', email: 'Ada@Example.test', name: '  Ada  ', company: 'ACME', phone: '+1 (555) 010-9999', message: 'hi', consent: true, value: 5 },
  { type: 'lead', path: '/l', email: 'no-consent@example.test', name: 'X' },
  { type: 'lead', path: '/l', email: 'bad-email', name: 'Y', consent: true, fast: 1 },
  { type: 'conversion', path: '/thanks', value: 19.5 }, { type: 'conversion', value: -3 }, { type: 'conversion', value: true },
  { type: 'scroll', depth: 49.6 }, { type: 'scroll', depth: 101 }, { type: 'cta', label: 'Start now' },
  { type: 'outbound', href: 'https://Partner.Example:8443/x' }, { type: 'outbound', href: 'javascript:alert(1)' },
  { type: 'vitals', lcp: 2500.6, cls: 0.12345, inp: 99.5 }, { type: 'vitals' }, { type: 'form_submit', form: 'contact' },
  { type: 'pageview', hp: 'bot' }, { type: 'nope' }, { type: 'pageview', path: 'x\u0000y', utm: { source: { evil: 1 } } },
];
const strip = (r) => { if (r.event) { const { at, ...e } = r.event; return { event: e }; } return r; };

before(async () => {
  fs.writeFileSync(path.join(siteRoot, 'index.html'), '<h1>Home</h1>');
  fs.writeFileSync(path.join(siteRoot, 'robots.txt'), 'User-agent: *\nSitemap: /sitemap.xml\n');
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
  attachOut = JSON.parse((await node('attach.mjs', [domain, '--name', 'Stacks Test', '--stack', 'all', '--no-embed-secret'])).stdout);
  secret = fs.readFileSync(envFile, 'utf8').match(new RegExp(`${secretEnvName(slug)}=([a-f0-9]+)`))[1];
  await new Promise((resolve) => {
    server = createSatellite({ root: siteRoot, secret, strict: true, origins: [] });
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(path.join(root, 'products', slug), { recursive: true, force: true });
  fs.rmSync(pkgDir, { recursive: true, force: true });
  for (const d of [siteRoot, repoDir, envDir]) fs.rmSync(d, { recursive: true, force: true });
  // Remove only this test's entries (other test files may run at the same time and share this file).
  try { const live = JSON.parse(fs.readFileSync(liveFile, 'utf8')); live.sites = (live.sites ?? []).filter((x) => x.product !== slug); fs.writeFileSync(liveFile, JSON.stringify(live, null, 2)); } catch { /* none */ }
});

test('attach --stack all writes a package with INSTALL.md per stack, and no package contains the secret', () => {
  assert.deepEqual(attachOut.packages.map((p) => p.stack).sort(), [...STACKS].sort());
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const stack of STACKS) {
    const files = walk(path.join(pkgDir, stack));
    assert.ok(files.some((f) => f.endsWith('INSTALL.md')), `${stack} has INSTALL.md`);
    for (const f of files) assert.ok(!fs.readFileSync(f).includes(secret), `${path.relative(pkgDir, f)} must not contain the secret`);
  }
  assert.ok(!fs.readFileSync(path.join(pkgDir, 'install-satellite.sh'), 'utf8').includes(secret), '--no-embed-secret keeps it out of the legacy installer');
  assert.ok(!JSON.stringify(attachOut).includes(secret), 'attach never prints the secret');
  assert.match(fs.readFileSync(path.join(pkgDir, 'docker', '.env.example'), 'utf8'), /__WHALYOM_SECRET__/);
  const conn = JSON.parse(fs.readFileSync(path.join(root, 'products', slug, 'connection.json'), 'utf8'));
  assert.equal(conn.prefix, '/_whalyom'); assert.deepEqual(conn.packages.sort(), [...STACKS].sort());
});

test('the shell installer verifies a checksum, hardens systemd, re-runs safely and uninstalls', () => {
  const sh = fs.readFileSync(path.join(pkgDir, 'node', 'install-satellite.sh'), 'utf8');
  for (const re of [/EXPECTED_SHA256='[0-9a-f]{64}'/, /Checksum mismatch/, /NoNewPrivileges=true/, /ProtectSystem=strict/, /ReadWritePaths=/, /--uninstall/, /--purge/, /systemctl restart/, /--strict/, /--trust-proxy/, /--origins/]) assert.match(sh, re);
  const b64 = sh.split("<<'WHALYOM_B64'\n")[1].split('\nWHALYOM_B64')[0].replace(/\s+/g, '');
  const src = Buffer.from(b64, 'base64');
  assert.equal(crypto.createHash('sha256').update(src).digest('hex'), sh.match(/EXPECTED_SHA256='([0-9a-f]{64})'/)[1]);
  assert.equal(src.toString(), fs.readFileSync(path.join(root, 'tools', 'satellite', 'whalyom-satellite.mjs'), 'utf8'));
  const bash = spawnSync('bash', ['-n', path.join(pkgDir, 'node', 'install-satellite.sh')], { encoding: 'utf8' });
  if (bash.error) return; // no bash on this machine
  assert.equal(bash.status, 0, bash.stderr);
  const df = fs.readFileSync(path.join(pkgDir, 'docker', 'Dockerfile'), 'utf8');
  assert.match(df, /sha256sum -c/); assert.match(df, /USER node/);
  assert.match(fs.readFileSync(path.join(pkgDir, 'docker', 'docker-compose.yml'), 'utf8'), /127\.0\.0\.1:4610:4610/);
});

test('the WordPress zip holds the plugin; snippet and GTM embed the current tracker', () => {
  const z = fs.readFileSync(path.join(pkgDir, 'wordpress', 'whalyom.zip'));
  assert.equal(z.readUInt32LE(0), 0x04034b50); assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  for (const n of ['whalyom/whalyom.php', 'whalyom/uninstall.php', 'whalyom/assets/whalyom.js']) assert.ok(z.includes(Buffer.from(n)), n);
  assert.ok(fs.readFileSync(path.join(pkgDir, 'gtm', 'gtm-custom-html.html'), 'utf8').includes(TRACKER_JS));
  assert.ok(fs.readFileSync(path.join(pkgDir, 'snippet', 'inline.html'), 'utf8').includes(TRACKER_JS));
  assert.match(fs.readFileSync(path.join(pkgDir, 'snippet', 'embed.html'), 'utf8'), /data-endpoint="https:\/\/.+\/collect"/);
  for (const rel of TRACKER_COPIES) assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), TRACKER_JS, `${rel} drifted: run node tools/satellite/sync-tracker.mjs`);
  assert.doesNotThrow(() => new Function(TRACKER_JS));
  assert.ok(!/=>|\blet\b|\bconst\b|`/.test(TRACKER_JS.replace(/\/\*[\s\S]*?\*\//, '')), 'tracker stays ES5 for GTM');
});

test('stack auto-detection from a linked repo', async () => {
  assert.equal(detectStack(repoDir).stack, 'nextjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-det-'));
  const cases = [['wp-config.php', 'wordpress'], ['wrangler.toml', 'cloudflare'], ['netlify.toml', 'netlify'], ['Dockerfile', 'docker']];
  for (const [file, want] of cases) { const d = fs.mkdtempSync(path.join(tmp, 'c')); fs.writeFileSync(path.join(d, file), ''); assert.equal(detectStack(d).stack, want, file); }
  assert.equal(detectStack(tmp, 'hugo').stack, 'snippet');
  assert.equal(detectStack(null).stack, 'node');
  fs.rmSync(tmp, { recursive: true, force: true });
  const out = JSON.parse((await node('attach.mjs', [slug, '--repo', repoDir])).stdout);
  assert.equal(out.connection.detected_stack, 'nextjs'); assert.equal(out.connection.prefix, '/api/whalyom');
  assert.ok(fs.existsSync(path.join(pkgDir, 'nextjs', 'app', 'api', 'whalyom', '[op]', 'route.js')));
  await node('attach.mjs', [slug, '--stack', 'node']); // back to the satellite for the verify test
});

test('every normaliser (Node satellite, edge core, WordPress) gives the same result', async () => {
  const want = FIXTURES.map((f) => strip(normalizeEvent(f)));
  assert.deepEqual(FIXTURES.map((f) => strip(core.normalizeEvent(f))), want);
  assert.equal(want[1].event.contact.email, 'ada@example.test'); assert.equal(want[2].event.contact, undefined);
  if (!php) return;
  assert.deepEqual(runPhp({ op: 'normalize', events: FIXTURES }), want);
});

const signed = async (handle, url, sec, { nonce = crypto.randomBytes(16).toString('hex'), ts = Date.now() } = {}) => {
  const u = new URL(url);
  const sig = signRequestV2(sec, ts, nonce, 'GET', u.pathname + u.search, '');
  return handle(new Request(url, { headers: { 'x-whalyom-ts': String(ts), 'x-whalyom-nonce': nonce, 'x-whalyom-sig': sig } }));
};
const fakeKv = () => { const m = new Map(); return { async get(k, t) { const v = m.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async list({ prefix = '', cursor } = {}) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })); return { keys, list_complete: true }; } }; };

test('Cloudflare Worker package: collect into KV, signed health/events, replay refused, origins enforced', async () => {
  const worker = (await import(pathToFileURL(path.join(pkgDir, 'cloudflare', 'worker.mjs')).href)).default;
  const env = { WHALYOM_SECRET: secret, WHALYOM_KV: fakeKv(), WHALYOM_ORIGINS: `https://${domain}` };
  const call = (req) => worker.fetch(req, env);
  const js = await call(new Request(`https://${domain}/whalyom.js`)); assert.equal(js.status, 200); assert.equal(await js.text(), TRACKER_JS);
  const post = (b, origin = `https://${domain}`) => call(new Request(`https://${domain}/collect`, { method: 'POST', body: JSON.stringify(b), headers: { origin, 'cf-connecting-ip': '198.51.100.7' } }));
  assert.equal((await post({ type: 'pageview', path: '/', eid: 'cfevent00001' })).status, 204);
  assert.equal((await post({ type: 'pageview', path: '/', eid: 'cfevent00001' })).status, 204);
  assert.equal((await post({ type: 'pageview', path: '/' }, 'https://evil.invalid')).status, 403);
  const handle = (r) => worker.fetch(r, env);
  const nonce = crypto.randomBytes(16).toString('hex');
  const h = await signed(handle, `https://${domain}/_whalyom/health`, secret, { nonce });
  assert.equal(h.status, 200); const body = await h.text();
  assert.equal(h.headers.get('x-whalyom-resp-sig'), crypto.createHmac('sha256', secret).update(`resp\n${nonce}\n200\n${body}`).digest('hex'));
  assert.equal(JSON.parse(body).events, 1, 'duplicate eid stored once');
  assert.equal((await signed(handle, `https://${domain}/_whalyom/health`, secret, { nonce })).status, 401, 'replay');
  assert.equal((await signed(handle, `https://${domain}/_whalyom/health`, 'z'.repeat(64))).status, 401);
  const ev = await (await signed(handle, `https://${domain}/_whalyom/events?since=`, secret)).json();
  assert.equal(ev.events.length, 1);
});

test('Next.js route and Netlify edge packages answer the hub client through a real HTTP server', async () => {
  process.env.WHALYOM_SECRET = secret; process.env.WHALYOM_ORIGINS = `https://${domain}`;
  const route = await import(pathToFileURL(path.join(pkgDir, 'nextjs', 'app', 'api', 'whalyom', '[op]', 'route.js')).href);
  const netlify = (await import(pathToFileURL(path.join(pkgDir, 'netlify', 'netlify', 'edge-functions', 'whalyom', 'index.js')).href)).default;
  const http = await import('node:http');
  const serve = (fn) => new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await fn(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const nextSrv = await serve((r) => route[r.method](r));
  const netSrv = await serve(netlify);
  try {
    const nb = `http://127.0.0.1:${nextSrv.address().port}`;
    assert.equal((await fetch(`${nb}/api/whalyom/collect`, { method: 'POST', body: JSON.stringify({ type: 'lead', path: '/', email: 'n@example.test', consent: true }) })).status, 204);
    const nh = await satellite(nb, secret, { prefix: '/api/whalyom', requireResponseSig: true }).health();
    assert.equal(nh.kind, 'nextjs'); assert.equal(nh.events, 1); assert.equal(nh.writes, false);
    const netb = `http://127.0.0.1:${netSrv.address().port}`;
    assert.equal((await fetch(`${netb}/collect`, { method: 'POST', body: JSON.stringify({ type: 'cta', path: '/', label: 'Go' }) })).status, 204);
    const s = satellite(netb, secret, { requireResponseSig: true });
    assert.equal((await s.health()).kind, 'netlify-edge');
    assert.equal((await s.events('')).events[0].label, 'Go');
    await assert.rejects(s.apply('x.html', 'x'), /read-only|not found/);
  } finally {
    await Promise.all([nextSrv, netSrv].map((x) => new Promise((r) => x.close(r))));
    delete process.env.WHALYOM_SECRET; delete process.env.WHALYOM_ORIGINS;
  }
});

test('WordPress plugin: signature checks (PHP harness)', { skip: !php && 'php not installed' }, () => {
  const ts = Date.now(); const nonce = crypto.randomBytes(16).toString('hex'); const uri = '/wp-json/whalyom/v1/health';
  const h = (o = {}) => ({ 'x-whalyom-ts': String(o.ts ?? ts), 'x-whalyom-nonce': o.nonce ?? nonce, 'x-whalyom-sig': o.sig ?? signRequestV2(o.key ?? secret, o.ts ?? ts, o.nonce ?? nonce, 'GET', o.uri ?? uri, '') });
  const out = runPhp({ op: 'signature', secret, cases: [
    { method: 'GET', uri, headers: h(), body: '' },
    { method: 'GET', uri, headers: h(), body: '' },
    { method: 'GET', uri, headers: h({ nonce: 'b'.repeat(32), key: 'q'.repeat(64) }), body: '' },
    { method: 'GET', uri, headers: h({ nonce: 'c'.repeat(32), ts: ts - 600000 }), body: '' },
    { method: 'GET', uri: `${uri}?x=1`, headers: h({ nonce: 'd'.repeat(32) }), body: '' },
  ] });
  assert.deepEqual(out, ['ok', 'replayed request', 'bad signature', 'bad signature', 'bad signature']);
  const c = runPhp({ op: 'collect', home: 'https://example.test', requests: [
    { origin: 'https://example.test', body: JSON.stringify({ type: 'pageview', path: '/', eid: 'wpevent00001' }) },
    { origin: 'https://example.test', body: JSON.stringify({ type: 'pageview', path: '/', eid: 'wpevent00001' }) },
    { origin: 'https://evil.invalid', body: JSON.stringify({ type: 'pageview', path: '/' }) },
    { body: JSON.stringify({ type: 'lead', hp: 'x' }) }, { body: 'x'.repeat(9000) }, { body: '{bad' },
  ] });
  assert.deepEqual(c, { statuses: [204, 204, 403, 204, 413, 400], stored: 1 });
});

test('attach --verify checks the endpoint and writes the result to state/live-sites.json', async () => {
  await node('attach.mjs', [slug, '--satellite', base]);
  const r = await node('attach.mjs', [slug, '--verify', base], { ok: false });
  const out = JSON.parse(r.stdout);
  const byName = Object.fromEntries(out.verify.checks.map((l) => [l.split(' ').filter(Boolean)[1].replace(/:$/, ''), l.split(' ')[0]]));
  for (const k of ['health_signature', 'response_signature', 'clock_skew', 'version', 'signature_enforced', 'tracker']) assert.equal(byName[k], 'pass', `${k}: ${out.verify.checks.join('\n')}`);
  assert.equal(byName.tls, 'skip'); assert.equal(byName.cors, 'warn', 'no origin allow-list set → warn');
  assert.equal(byName.llms_txt, 'warn'); assert.equal(byName.robots_txt, 'warn', 'the satellite is not the web server: robots.txt lives on the site');
  assert.equal(r.status, 0, 'warnings do not fail the verify');
  const live = JSON.parse(fs.readFileSync(liveFile, 'utf8')).sites.find((s) => s.product === slug);
  assert.equal(live.state, 'connected'); assert.equal(live.verification.status, 'warn'); assert.ok(live.verification.score > 50);
  const bad = JSON.parse((await node('attach.mjs', [slug, '--verify', 'http://127.0.0.1:1'], { ok: false })).stdout);
  assert.equal(bad.verify.status, 'fail');
});

test('a consented lead from a landing page reaches products/<slug>/leads.jsonl with its fields; others stay anonymous', async () => {
  await node('attach.mjs', [slug, '--satellite', base, '--verify', base], { ok: false });
  const post = (b) => fetch(`${base}/collect`, { method: 'POST', body: JSON.stringify(b) });
  assert.equal((await post({ type: 'lead', path: '/lp', form: 'waitlist', eid: 'lpl000000001', email: 'grace@example.test', name: 'Grace', message: 'Hello', consent: true, utm: { source: 'linkedin' } })).status, 204);
  assert.equal((await post({ type: 'lead', path: '/lp', form: 'waitlist', eid: 'lpl000000002', email: 'nobody@example.test', name: 'No' })).status, 204);
  await node('sync-sites.mjs', ['--only', slug]);
  const leads = fs.readFileSync(path.join(root, 'products', slug, 'leads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const g = leads.find((l) => l.lead_id === 'lpl000000001');
  assert.deepEqual(g.contact, { email: 'grace@example.test', name: 'Grace', message: 'Hello' }); assert.equal(g.consent, true); assert.equal(g.channel, 'linkedin');
  const n = leads.find((l) => l.form === 'waitlist' && l.lead_id === 'lpl000000002');
  assert.ok(n && !n.contact, 'lead without consent is counted, no personal fields');
  await node('sync-sites.mjs', ['--only', slug]);
  assert.equal(fs.readFileSync(path.join(root, 'products', slug, 'leads.jsonl'), 'utf8').trim().split('\n').length, leads.length, 'second sync adds nothing');
  const sat = satellite(base, secret);
  assert.ok(!JSON.stringify(await sat.events('')).includes('grace@'), 'events API never carries the email');
});

test('reverse-proxy snippets route the booster endpoints (/boosters, /whalyom-boost.js) as well as the tracker routes', () => {
  const v = siteVars({ slug: 'proxy-routes', domain: 'example.test', secretEnv: 'WHALYOM_SECRET_PROXY_ROUTES' });
  const conf = nginxSnippet(v);
  const m = conf.match(/location ~ (\S+) \{/);
  assert.ok(m, 'nginx snippet has a regex location');
  const re = new RegExp(m[1]);
  for (const p of ['/boosters', '/whalyom-boost.js', '/whalyom.js', '/collect', '/_whalyom/health']) assert.ok(re.test(p), `nginx routes ${p}`);
  for (const p of ['/', '/index.html', '/boosters-old', '/whalyom-boost.json', '/collected']) assert.ok(!re.test(p), `nginx leaves ${p} to the site`);
  for (const stack of ['node', 'docker']) assert.equal(buildPackage(stack, v).files['nginx-snippet.conf'], conf);
  const caddy = buildPackage('node', v).files['Caddyfile.snippet'].split('\n').find((l) => l.startsWith('@whalyom path'));
  const paths = caddy.split(/\s+/).slice(2);
  for (const p of ['/_whalyom/*', '/collect', '/whalyom.js', '/whalyom-boost.js', '/boosters']) assert.ok(paths.includes(p), `Caddy routes ${p}`);
});
